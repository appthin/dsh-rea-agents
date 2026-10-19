/**
 * Host half of dsh-rea-agents.
 *
 * Manages one pinned `rea-agents` installation inside the active profile and
 * serves the page's small JSON API on the loopback web server.
 *
 * ## Why the pin is the point
 *
 * Launching REA through `npx -y rea-agents@latest` means every harness start
 * downloads and executes whatever the registry most recently published. This
 * plugin inverts that: the profile declares a dependency on one exact version,
 * the MCP server is started from that copy, and a newer release reaches the
 * machine only when someone reads the change and presses Update. Boot-time
 * behaviour is then reproducible and reviewable, which is what makes an
 * analysis tool's output comparable between sessions.
 *
 * The pin therefore also decides *where* the launcher points. The MCP entry in
 * `cordis.patch.yml` starts `lib/rea-mcp.mjs`, which resolves the installed
 * copy under the profile instead of searching `PATH` — see that file for why.
 *
 * ## What this half may and may not do
 *
 * It writes only two things: the profile's `package.json` dependency for
 * `rea-agents`, and the pin file this plugin owns. It never edits the user's
 * `cordis.patch.yml`, never runs `pnpm` against anything but that one package,
 * and never installs an analysis engine. Ghidra, IDA, jadx, apktool, adb and
 * the rest stay the operator's own, exactly as REA documents them.
 */

import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync } from 'node:fs'
import { access, constants, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { homedir } from 'node:os'

/** Registry package this plugin pins (the upstream REA package). */
const PACKAGE = 'rea-agents'

/** This plugin's own package name, which is what the client composer keys on. */
const SELF = 'dsh-rea-agents'

/** Absolute URL of the API the browser half calls. */
const API_PREFIX = '/rea-agents'

/** Longest a registry lookup may take before the page reports a timeout. */
const LOOKUP_TIMEOUT_MS = 60_000

/** Longest an install may take; a first install pulls a large dependency tree. */
const INSTALL_TIMEOUT_MS = 15 * 60_000

/** Dependencies the pin file this plugin owns lives under. */
const STATE_DIR = 'dsh-rea-agents'

/**
 * Node versions the pinned release declares; surfaced so a mismatch is visible
 * before installing rather than after the MCP server fails to start.
 * @param engines - the installed manifest's `engines` field.
 * @returns a sentence naming the mismatch, or null when the current runtime fits.
 */
function enginesWarning(engines) {
  const declared = engines?.node
  if (typeof declared !== 'string' || declared === '') return null
  // The runtime already executing this plugin is the one the server will get,
  // so compare against it directly instead of resolving a package.
  const current = process.versions.node
  if (satisfiesAtLeast(current, declared)) return null
  return `rea-agents declares node "${declared}", but this harness runs node ${current}. The install can proceed, but the MCP server may fail to start.`
}

/**
 * Decide whether a concrete version satisfies a declared node range, reading
 * only the comparison forms REA actually publishes (`^`, `>=`, `||`).
 * A range this helper cannot read is treated as satisfied: refusing to install
 * over an unparsed string would block the user for a cosmetic reason.
 */
function satisfiesAtLeast(version, range) {
  const candidates = range.split('||').map(part => part.trim()).filter(Boolean)
  for (const candidate of candidates) {
    const floor = /^(?:\^|>=|~>?)?\s*(\d+)(?:\.(\d+|x))?/u.exec(candidate)
    if (floor === null) continue
    const major = Number(floor[1])
    const minor = floor[2] === undefined || floor[2] === 'x' ? 0 : Number(floor[2])
    const [haveMajor, haveMinor] = version.split('.').map(Number)
    if (candidate.startsWith('^')) {
      // Caret ranges move within one major, which is all REA's floors need.
      if (haveMajor === major && (haveMajor > major || haveMinor >= minor)) return true
      if (haveMajor > major) return true
    } else if (haveMajor > major || (haveMajor === major && haveMinor >= minor)) {
      return true
    }
  }
  return candidates.length === 0
}

/** The harness home, honouring `DSH_HOME` before the platform default. */
function dshHome() {
  const configured = process.env.DSH_HOME
  if (typeof configured === 'string' && configured.trim() !== '') return resolve(configured)
  return join(homedir(), '.dsh')
}

/**
 * Resolve the profile directory this plugin is acting for.
 *
 * A running harness exports its own profile, which is authoritative. Falling
 * back to the `desktop` profile keeps the page usable from a host started
 * without that variable, and the response always states which directory was
 * chosen so the page never implies the wrong one.
 */
function profileDir(ctx) {
  const profileContext = ctx.get?.('profileContext')
  const fromContext = profileContext?.dir
  if (typeof fromContext === 'string' && fromContext !== '') return { dir: resolve(fromContext), source: 'profileContext' }

  const fromEnv = process.env.DSH_PROFILE_DIR
  if (typeof fromEnv === 'string' && fromEnv.trim() !== '') return { dir: resolve(fromEnv), source: 'env' }

  const name = (typeof process.env.DSH_PROFILE === 'string' && process.env.DSH_PROFILE.trim() !== '') ? process.env.DSH_PROFILE.trim() : 'desktop'
  return { dir: join(dshHome(), 'profiles', name), source: 'derived' }
}

/** Path of the record this plugin keeps for the pinned copy, inside the profile's state directory. */
function pinFile(dir) {
  return join(dir, STATE_DIR, 'pin.json')
}

/** Read a JSON file, returning undefined for absence and for unparsable content. */
async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** The `pnpm` invocation this profile should use. */
function pnpmCommand() {
  const configured = process.env.DSH_PNPM_PATH
  if (typeof configured === 'string' && configured.trim() !== '') return configured.trim()
  return 'pnpm'
}

/**
 * Build the executable and argument vector for one pnpm run.
 *
 * Two shapes have to work. A bare `pnpm` is a console script: on Windows that
 * is a `.cmd` wrapper, which `execFile` cannot start directly, while
 * `shell: true` would concatenate the command line and reopen an injection
 * surface for any registry-supplied string. Naming `cmd.exe` explicitly keeps
 * every argument in the argv array, so nothing is re-parsed as shell syntax;
 * `/d` skips AutoRun and `/s` makes the quoting rules unambiguous.
 *
 * A configured `DSH_PNPM_PATH` may instead be a JavaScript entry point, which is
 * how the harness ships its own pnpm (`.../dependencies/pnpm/bin/pnpm.mjs`).
 * Handing that to `cmd.exe` cannot work — a `.mjs` is not executable — so it is
 * launched under the same Node that runs this process, which is also what the
 * harness's own installer does.
 */
function pnpmInvocation(args) {
  const command = pnpmCommand()

  if (/\.[cm]?js$/u.test(command)) {
    return { file: process.execPath, args: [command, ...args] }
  }
  if (process.platform !== 'win32') return { file: command, args }
  return { file: 'cmd.exe', args: ['/d', '/s', '/c', command, ...args] }
}

/** Run pnpm in a directory, capturing output for the page's log pane. */
function runPnpm(dir, args, timeout) {
  const invocation = pnpmInvocation(args)
  return new Promise((resolvePromise) => {
    execFile(
      invocation.file,
      invocation.args,
      { cwd: dir, timeout, windowsHide: true, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => {
        resolvePromise({
          ok: error === null,
          code: typeof error?.code === 'number' ? error.code : null,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          timedOut: error?.killed === true,
        })
      },
    )
  })
}

/**
 * Ask the registry what `rea-agents` currently publishes.
 *
 * `pnpm view` is used rather than a direct HTTP call so the profile's own
 * registry, proxy and authentication settings apply — the same configuration
 * the install will use. It is asked for the whole manifest in JSON because
 * `pnpm view` rejects `--field` in this position; the payload is parsed from
 * the last JSON object pnpm printed, since a notice may precede it.
 */
async function lookupLatest(dir) {
  const result = await runPnpm(dir, ['view', PACKAGE, '--json'], LOOKUP_TIMEOUT_MS)
  if (!result.ok) {
    return { ok: false, reason: summarisePnpmFailure(result), raw: trimOutput(result) }
  }
  const parsed = parseTrailingJson(result.stdout)
  if (parsed === undefined || typeof parsed.version !== 'string') {
    return { ok: false, reason: 'the registry answered without a version', raw: trimOutput(result) }
  }
  return {
    ok: true,
    version: parsed.version,
    description: typeof parsed.description === 'string' ? parsed.description : null,
  }
}

/** Keep pnpm's own words but bound them, so a long log cannot ride into the page. */
function trimOutput(result) {
  const text = `${result.stdout}\n${result.stderr}`.trim()
  return text.length > 2000 ? `${text.slice(0, 2000)}…` : text
}

/**
 * The packages pnpm named as failing the minimumReleaseAge policy, as specifiers
 * it will accept back.
 *
 * pnpm prints each offending entry as `<name>@<version> was published at
 * <time>, within the minimumReleaseAge cutoff (<cutoff>)`. The `<name>@<version>`
 * prefix is exactly what `--config.minimum-release-age-exclude` takes, so the
 * message doubles as the input to the remedy. Scoped names contain `/` and `@`,
 * hence the character class rather than a looser pattern.
 *
 * A specifier is only returned once, and only when it looks like a real
 * `name@version` pair: an unparsable message must not become a flag.
 *
 * The whitespace between "within" and "the minimumReleaseAge cutoff" is not
 * assumed to be a space. pnpm wraps its diagnostics to the terminal width, and
 * a wrapped message puts a newline exactly there — the shape the field report
 * arrived in. Matching only on spaces would have found no offender, and the
 * retry would silently never have been attempted.
 *
 * @param result - the captured pnpm outcome.
 * @returns offending specifiers, de-duplicated, in the order pnpm named them.
 */
function policyOffenders(result) {
  const text = `${result.stderr}\n${result.stdout}`
  const found = []
  const pattern = /((?:@[^/\s@]+\/)?[^/\s@]+@\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?) was published at [^,]+,\s*within\s+the\s+minimumReleaseAge cutoff/giu
  for (const match of text.matchAll(pattern)) {
    if (!found.includes(match[1])) found.push(match[1])
  }
  return found
}

/**
 * Whether `rea-agents` itself is the entry the policy refused.
 *
 * This is the one case the plugin will not work around. Exempting the package it
 * is installing would mean a version skips the waiting period the user relies on
 * for every other install, so the run stays failed and the page explains that
 * the requested version simply has not aged in yet.
 *
 * @param offenders - the specifiers pnpm named.
 * @returns whether any of them is the pinned package.
 */
function targetRefused(offenders) {
  return offenders.some(spec => spec.startsWith(`${PACKAGE}@`))
}

/** One sentence naming why pnpm failed, without inventing a cause it did not report. */
function summarisePnpmFailure(result) {
  if (result.timedOut) return 'the registry lookup timed out'
  const text = `${result.stderr}\n${result.stdout}`
  // An ignored optional build is not a failure on its own: it only reaches
  // here when the package was also missing afterwards.
  if (/ERR_PNPM_IGNORED_BUILDS/u.test(text)) return 'pnpm withheld a dependency build script and the package did not install; see the log'
  if (/ERR_PNPM_NO_MATCHING_VERSION|E404|not found/u.test(text)) return 'the registry has no such version'
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|EAI_AGAIN/u.test(text)) return 'the registry could not be reached'
  if (/ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION/u.test(text)) {
    const offenders = policyOffenders(result)
    // The package being installed is the one thing this plugin will not exempt,
    // so it needs its own sentence: the requested version exists, and is simply
    // too new to install yet.
    if (targetRefused(offenders)) {
      return 'the requested version of rea-agents was published too recently to have passed pnpm\'s supply-chain waiting period; it becomes installable once that period elapses, or you can pin an older version now'
    }
    return offenders.length === 0
      ? 'pnpm refused a lockfile entry that was published too recently to have passed its supply-chain waiting period'
      : `pnpm refused a lockfile entry published too recently (${offenders.join(', ')}), and exempting it did not clear the check`
  }
  if (/ERR_PNPM_OUTDATED_LOCKFILE|lockfile/u.test(text)) return 'the profile lockfile would need to change'
  return 'pnpm reported a failure'
}

/**
 * Parse the JSON payload pnpm printed.
 *
 * `pnpm view --json` prints one JSON document, but a notice can precede it on
 * stdout. The scan therefore starts at the first `{` and tries successive
 * opening braces only until one parses. A payload can be tens of kilobytes
 * (the full manifest plus every publish date), so the scan is bounded rather
 * than attempting every brace in a large body.
 * @param stdout - the captured standard output.
 * @returns the parsed object, or undefined when nothing parsed.
 */
function parseTrailingJson(stdout) {
  const text = stdout.trim()
  if (text === '') return undefined
  try {
    return JSON.parse(text)
  } catch {
    // A leading notice means the document does not start at index 0. Try the
    // first few opening braces; a notice is short, so the payload follows
    // immediately after one of them.
    let index = text.indexOf('{')
    for (let attempt = 0; index !== -1 && attempt < 8; attempt += 1) {
      try {
        return JSON.parse(text.slice(index))
      } catch {
        index = text.indexOf('{', index + 1)
      }
    }
    return undefined
  }
}

/**
 * Read the version actually present on disk, which is the only version the MCP
 * server can start. A pin record can be stale after a manual change, so the
 * installed manifest is authoritative and the record only supplies provenance.
 */
async function readInstalled(dir) {
  const manifestPath = join(dir, 'node_modules', PACKAGE, 'package.json')
  const manifest = await readJson(manifestPath)
  if (manifest === undefined) return null
  if (typeof manifest.version !== 'string') return null

  const entryCandidates = [
    join(dir, 'node_modules', PACKAGE, 'scripts', 'rea.mjs'),
    join(dir, 'node_modules', PACKAGE, 'dist', 'cli.js'),
  ]
  const entry = entryCandidates.find(candidate => existsSync(candidate)) ?? null
  const record = await readJson(pinFile(dir))

  return {
    version: manifest.version,
    entry,
    path: join(dir, 'node_modules', PACKAGE),
    pinnedAt: typeof record?.pinnedAt === 'string' ? record.pinnedAt : null,
    pinnedFrom: typeof record?.pinnedFrom === 'string' ? record.pinnedFrom : null,
    engines: manifest.engines ?? null,
  }
}

/** Read the declared dependency on the pinned package from the profile manifest. */
async function readDeclaration(dir) {
  const manifest = await readJson(join(dir, 'package.json'))
  const declared = manifest?.dependencies?.[PACKAGE]
  return typeof declared === 'string' ? declared : null
}

/** Digest of the profile manifest, so the page can tell when something else rewrote it. */
async function manifestDigest(dir) {
  try {
    return createHash('sha256').update(await readFile(join(dir, 'package.json'))).digest('hex').slice(0, 16)
  } catch {
    return null
  }
}

/** Whether this profile can be written at all; reported before an action rather than after it fails. */
async function writability(dir) {
  try {
    await access(dir, constants.W_OK)
    return true
  } catch {
    return false
  }
}

/** Compose the state the page renders. */
async function describeState(ctx) {
  const { dir, source } = profileDir(ctx)
  const installed = await readInstalled(dir)
  const declared = await readDeclaration(dir)
  const writable = await writability(dir)
  const record = await readJson(pinFile(dir))

  return {
    profileDir: dir,
    profileSource: source,
    writable,
    manifestDigest: await manifestDigest(dir),
    package: PACKAGE,
    declared,
    installed,
    pinned: typeof record?.version === 'string' ? record.version : null,
    pinnedAt: typeof record?.pinnedAt === 'string' ? record.pinnedAt : null,
    latestKnown: typeof record?.latestKnown === 'string' ? record.latestKnown : null,
    checkedAt: typeof record?.checkedAt === 'string' ? record.checkedAt : null,
    enginesWarning: enginesWarning(installed?.engines ?? null),
    nodeVersion: process.versions.node,
  }
}

/**
 * Pin one version: declare it exactly, install it, then record what happened.
 *
 * The declaration is written before pnpm runs so a failed install still names
 * the intended version rather than leaving the profile ambiguous. `--save-exact`
 * keeps the manifest free of a range that would re-float the pin on the next
 * `pnpm install`.
 */
async function pinVersion(ctx, version, origin) {
  const { dir } = profileDir(ctx)
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(version)) {
    return { ok: false, reason: `unexpected version string ${JSON.stringify(version)}` }
  }

  // An in-place `add` moves the dependency; it does not need a preceding remove.
  const add = ['add', `${PACKAGE}@${version}`, '--save-exact']
  let install = await runPnpm(dir, add, INSTALL_TIMEOUT_MS)
  let retried = false

  // pnpm verifies the WHOLE lockfile against the supply-chain policy before it
  // changes anything, so one entry that is still inside the waiting period
  // blocks every operation on that profile — including installing a package the
  // policy has nothing against. The profile in the field hit exactly this: it
  // could not move REA because `dshmarket@1.66.36` had been published minutes
  // earlier. Nothing about that is under this plugin's control, and telling the
  // user to wait a day is a poor answer when pnpm offers a way through.
  //
  // Re-run once, exempting only entries that are NOT the package being
  // installed. This plugin's whole promise is that a version is chosen
  // deliberately, so it must not be the one name that skips the waiting period:
  // exempting its own target would quietly undo the policy the user relies on.
  // When the target itself is the offender the run stays failed — see
  // summarisePnpmFailure — and no retry is attempted, because exempting the
  // unrelated entries could not make it succeed.
  const offenders = policyOffenders(install)
  const exemptable = offenders.filter(spec => !spec.startsWith(`${PACKAGE}@`))
  if (exemptable.length > 0 && !targetRefused(offenders)) {
    install = await runPnpm(
      dir,
      [...add, ...exemptable.map(spec => `--config.minimum-release-age-exclude=${spec}`)],
      INSTALL_TIMEOUT_MS,
    )
    retried = true
  }

  const log = trimOutput(install)
  const installed = await readInstalled(dir)

  // The on-disk copy decides, not the exit code: see installSucceeded.
  if (!installSucceeded(install, installed)) {
    return {
      ok: false,
      reason: summarisePnpmFailure(install),
      offenders: policyOffenders(install),
      log,
      state: await describeState(ctx),
    }
  }
  if (installed === null) {
    return { ok: false, reason: 'pnpm finished but the package is not on disk', log, state: await describeState(ctx) }
  }

  const now = new Date().toISOString()
  const previous = (await readJson(pinFile(dir))) ?? {}
  await writeRecord(dir, {
    ...previous,
    version: installed.version,
    requested: version,
    pinnedAt: now,
    pinnedFrom: origin ?? 'page',
    retained: previous.retained ?? null,
    withheldBuilds: withheldBuilds(install),
  })

  return {
    ok: true,
    // Reported so the page can say that an unrelated package had to be exempted,
    // rather than presenting a run that needed a workaround as an ordinary one.
    exempted: retried ? exemptable : [],
    log,
    // A withheld optional build is reported alongside success rather than
    // hidden: the tools that need it will refuse to run, and saying so here
    // saves the user from diagnosing that later.
    withheldBuilds: withheldBuilds(install),
    state: await describeState(ctx),
  }
}

/** Write the pin record, creating the directory it lives in on first use. */
async function writeRecord(dir, record) {
  await mkdir(dirname(pinFile(dir)), { recursive: true })
  await writeFile(pinFile(dir), `${JSON.stringify(record, null, 2)}\n`, 'utf8')
}

/**
 * Decide whether a pnpm run left the package usable.
 *
 * pnpm reports `ERR_PNPM_IGNORED_BUILDS` with a nonzero exit when a dependency
 * declared a build script it declined to run. For REA that dependency is
 * `frida`, an optional extra: the package installs, its CLI starts, and only
 * the runtime-instrumentation tools that need a compiled Frida binding are
 * unavailable. Treating that exit code as "the install failed" would tell the
 * user their working copy is broken, so the on-disk result decides, and the
 * withheld build is reported as its own, milder fact.
 * @param result - the captured pnpm outcome.
 * @param installed - what is on disk afterwards, or null when nothing is.
 * @returns whether the run produced a usable installation.
 */
function installSucceeded(result, installed) {
  if (installed !== null) return true
  return result.ok
}

/** Name the build scripts pnpm withheld, so the page can mention them precisely. */
function withheldBuilds(result) {
  const text = `${result.stderr}\n${result.stdout}`
  const match = /Ignored build scripts:\s*([^\n]+)/u.exec(text)
  if (match === null) return []
  return match[1]
    .split(',')
    .map(part => part.trim())
    .filter(part => part !== '')
}

/** Record a completed registry check without changing the pin. */
async function recordCheck(ctx, latest) {
  const { dir } = profileDir(ctx)
  const previous = (await readJson(pinFile(dir))) ?? {}
  await writeRecord(dir, { ...previous, latestKnown: latest, checkedAt: new Date().toISOString() })
}

/** Answer one JSON request body. */
async function readJsonBody(request) {
  const chunks = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > 64 * 1024) throw new Error('request body too large')
    chunks.push(chunk)
  }
  const text = Buffer.concat(chunks).toString('utf8').trim()
  return text === '' ? {} : JSON.parse(text)
}

/** Write one JSON response. */
function sendJson(response, status, value) {
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  })
  response.end(JSON.stringify(value))
}

/** Only the loopback interface may drive an install on this machine. */
function isLoopback(request) {
  const address = request.socket?.remoteAddress
  if (typeof address !== 'string') return false
  return address === '127.0.0.1' || address === '::1' || address === '::ffff:127.0.0.1'
}

/** Cordis plugin name used by loader diagnostics. */
export const name = 'dsh-rea-agents'

/** The plugin needs the web server to publish its API. */
export const inject = ['webServer']

/**
 * Mount the REA management API.
 * @param ctx - host context carrying `webServer`.
 */
export function apply(ctx) {
  const handler = async (request, response) => {
    if (!isLoopback(request)) {
      sendJson(response, 403, { error: 'this API answers loopback requests only' })
      return
    }
    const url = new URL(request.url ?? '/', 'http://127.0.0.1')
    const route = url.pathname.slice(API_PREFIX.length)

    try {
      if (route === '/state' && request.method === 'GET') {
        sendJson(response, 200, await describeState(ctx))
        return
      }
      if (route === '/diagnose' && request.method === 'GET') {
        // Answers one question that cannot be answered offline: did this
        // plugin's browser half reach the page's module graph? Two facts are
        // reported, because they fail independently — whether the Loader holds
        // the row (the bundle patch ran) and whether the client composer
        // accepted it. A row with no graph entry is a discovery problem, not a
        // patch problem.
        const rows = []
        for (const entry of ctx.loader?.entries?.() ?? []) {
          rows.push({
            id: entry.id,
            name: entry.options?.name,
            disabled: entry.disabled === true,
          })
        }

        const modules = ctx.get?.('clientModules')
        let graph = null
        let graphError = null
        try {
          const composed = modules?.graph?.()
          if (composed !== undefined) {
            graph = {
              rev: composed.rev,
              entryCount: (composed.entries ?? []).length,
              // The composer keys on this plugin's own package name, not on the
              // pinned upstream package.
              selfPresent: (composed.entries ?? []).some(entry => entry.id === SELF),
              // The batch URL the page actually preloads. One batch bundles many
              // packages, so fetching it is the only way to read the bytes the
              // browser receives rather than the bytes on disk.
              batchUrls: (composed.batches ?? []).map(batch => batch.url),
            }
          }
        } catch (error) {
          graphError = error instanceof Error ? error.message : String(error)
        }

        // The composer's per-row gate, evaluated as it does: a row with no
        // fiber, or with no resolution base URL, never reaches the page even
        // though it appears in the Loader.
        const gates = []
        for (const entry of ctx.loader?.entries?.() ?? []) {
          if (entry.options?.name !== SELF) continue
          gates.push({
            fiberPresent: entry.fiber !== undefined,
            disabled: entry.disabled === true,
            baseUrl: entry.parent?.tree?.ctx?.baseUrl ?? null,
          })
        }

        sendJson(response, 200, {
          package: SELF,
          pinned: PACKAGE,
          clientModulesService: modules !== undefined,
          selfRows: rows.filter(row => row.id === SELF
            || row.name === SELF
            // The MCP row's module name carries no "rea", so its id is matched.
            || row.id === `${SELF}-mcp`
            || row.name === '@deepseek-ai/dsh-mcp-client'),
          graph,
          graphError,
          gates,
        })
        return
      }
      if (route === '/check' && request.method === 'POST') {
        const { dir } = profileDir(ctx)
        const lookup = await lookupLatest(dir)
        // Record before responding, never after: a second `sendJson` would
        // append a second document to the first and make the body unparsable.
        // A record that cannot be written is reported, not fatal — the answer
        // the user asked for is the version, not the bookkeeping.
        let recordError = null
        if (lookup.ok) {
          try {
            await recordCheck(ctx, lookup.version)
          } catch (error) {
            recordError = error instanceof Error ? error.message : String(error)
          }
        }
        sendJson(response, 200, lookup.ok
          ? { ok: true, latest: lookup.version, description: lookup.description, recordError, state: await describeState(ctx) }
          : { ok: false, reason: lookup.reason, log: lookup.raw, state: await describeState(ctx) })
        return
      }
      if (route === '/install' && request.method === 'POST') {
        const body = await readJsonBody(request)
        const version = typeof body.version === 'string' && body.version !== '' ? body.version : null
        if (version === null) {
          sendJson(response, 400, { ok: false, reason: 'install needs an explicit version' })
          return
        }
        sendJson(response, 200, await pinVersion(ctx, version, 'install'))
        return
      }
      if (route === '/update' && request.method === 'POST') {
        const body = await readJsonBody(request)
        const target = typeof body.version === 'string' && body.version !== '' ? body.version : null
        if (target === null) {
          sendJson(response, 400, { ok: false, reason: 'update needs the version to move to' })
          return
        }

        // Update is a single in-place `pnpm add`, not remove-then-add.
        //
        // It used to remove the old copy first, on the theory that re-adding a
        // package pnpm already has resolves to a no-op. That theory is wrong:
        // measured with pnpm 11.28.5, `add <pkg>@<version> --save-exact` moves
        // an existing dependency in both directions, and the manifest and the
        // lockfile both record the new version. What the removal actually cost
        // was a second pnpm command that can fail on its own.
        //
        // And it did fail, for a reason that has nothing to do with REA: pnpm
        // verifies the WHOLE lockfile before removing, so a dependency published
        // inside the minimumReleaseAge window — in the reported case
        // `dshmarket@1.66.36` — made `pnpm remove rea-agents` refuse with
        // ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION. The user could not update REA
        // because something else in their profile was too new. Skipping the
        // removal removes that failure mode entirely, and is strictly closer to
        // "move this one package to this one version".
        const { dir } = profileDir(ctx)
        const before = await readInstalled(dir)

        const outcome = await pinVersion(ctx, target, 'update')
        if (outcome.ok && before !== null) {
          const record = (await readJson(pinFile(dir))) ?? {}
          await writeRecord(dir, { ...record, retained: { from: before.version, at: new Date().toISOString() } })
        }
        sendJson(response, 200, outcome)
        return
      }
      if (route === '/unpin' && request.method === 'POST') {
        const { dir } = profileDir(ctx)
        const removal = await runPnpm(dir, ['remove', PACKAGE], INSTALL_TIMEOUT_MS)
        const stillPresent = await readInstalled(dir)
        if (stillPresent !== null) {
          sendJson(response, 200, {
            ok: false,
            reason: 'pnpm did not remove the pinned copy; see the log',
            log: trimOutput(removal),
            state: await describeState(ctx),
          })
          return
        }
        sendJson(response, 200, { ok: true, log: trimOutput(removal), state: await describeState(ctx) })
        return
      }
      sendJson(response, 404, { error: `unknown route ${route}` })
    } catch (error) {
      sendJson(response, 500, { ok: false, reason: error instanceof Error ? error.message : String(error) })
    }
  }

  ctx.effect(
    () => ctx.webServer.register({ kind: 'prefix', path: API_PREFIX, handler }),
    'dsh-rea-agents: management API',
  )
}

export default { name, inject, apply }
