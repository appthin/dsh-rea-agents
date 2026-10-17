/**
 * Tests for dsh-rea-agents.
 *
 * The host half is exercised through its exported plugin shape and through the
 * HTTP handler it registers, with `webServer.register` captured instead of a
 * real server. No network, no pnpm and no package installation happen here:
 * the suite covers the decisions this plugin makes — which profile it targets,
 * how it reads an installed copy, which version a lookup reports, and how it
 * words an install that landed somewhere other than the newest release.
 *
 * Run with `node test/run.mjs`.
 */

import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'

const plugin = await import('../lib/index.js')

let passed = 0
const failures = []

/** Run one named case, recording a failure instead of aborting the suite. */
async function test(name, run) {
  try {
    await run()
    passed += 1
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures.push({ name, error })
    process.stdout.write(`  FAIL  ${name}\n        ${error instanceof Error ? error.message : String(error)}\n`)
  }
}

/** Build a throwaway profile directory and return its path. */
async function makeProfile() {
  const dir = await mkdtemp(join(tmpdir(), 'rea-agents-test-'))
  await writeFile(join(dir, 'package.json'), `${JSON.stringify({ name: 'fixture-profile', private: true }, null, 2)}\n`, 'utf8')
  return dir
}

/** Write an installed-looking package into a profile. */
async function pretendInstalled(dir, version, engines = { node: '>=22.19.0' }) {
  const pkgDir = join(dir, 'node_modules', 'rea-agents')
  await mkdir(join(pkgDir, 'scripts'), { recursive: true })
  await writeFile(
    join(pkgDir, 'package.json'),
    `${JSON.stringify({ name: 'rea-agents', version, engines }, null, 2)}\n`,
    'utf8',
  )
  await writeFile(join(pkgDir, 'scripts', 'rea.mjs'), '// fixture entry\n', 'utf8')
  return pkgDir
}

/**
 * Mount the plugin with a fake web server and return a `call` that drives its
 * handler with a synthetic request.
 */
function mount(dir) {
  let handler
  const effects = []
  const ctx = {
    webServer: {
      register(route) {
        handler = route.handler
        return () => {}
      },
    },
    get(name) {
      if (name === 'profileContext') return { dir, patchPath: join(dir, 'cordis.patch.yml') }
      return undefined
    },
    effect(factory) {
      effects.push(factory())
    },
  }
  plugin.apply(ctx)

  /** Issue one request against the registered handler. */
  const call = async (route, body, method = 'GET') => {
    const payload = body === undefined ? '' : JSON.stringify(body)
    const request = Readable.from(payload === '' ? [] : [Buffer.from(payload, 'utf8')])
    request.method = method
    request.url = `/rea-agents${route}`
    request.socket = { remoteAddress: '127.0.0.1' }
    let status = 0
    let text = ''
    const response = {
      writeHead(code) { status = code },
      end(chunk) { text += String(chunk ?? '') },
    }
    await handler(request, response)
    return { status, body: text === '' ? undefined : JSON.parse(text) }
  }
  return { call, effects }
}

process.stdout.write('dsh-rea-agents\n')

await test('registers exactly one prefix route and no default export surprises', async () => {
  const dir = await makeProfile()
  try {
    let captured
    plugin.apply({
      webServer: { register(route) { captured = route; return () => {} } },
      get() { return undefined },
      effect(factory) { factory() },
    })
    assert.equal(plugin.name, 'dsh-rea-agents')
    assert.deepEqual(plugin.inject, ['webServer'])
    assert.equal(captured.kind, 'prefix')
    assert.equal(captured.path, '/rea-agents')
    assert.equal(typeof captured.handler, 'function')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('the dictionary is bilingual and fully read', async () => {
  // Delegated to the audit script so the two cannot drift: it is the same
  // check a maintainer runs, not a second implementation of it.
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const audit = fileURLToPath(new URL('./dictionary.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [audit], { encoding: 'utf8', timeout: 30_000 })
  assert.equal(result.status, 0, `dictionary audit failed:\n${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /dictionary ok/u)
})

await test('the browser half registers its own bundle configuration', async () => {
  // The controls belong on the plugin's own card, not as another top-level
  // Settings row. Load the browser half with a fake module loader and inspect
  // what it registers.
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

  let loaded
  const fakeWindow = {
    __ModuleLoader__: {
      load(definition) { loaded = definition },
    },
  }
  // React is the only external the half requires at load time.
  const fakeRequire = () => ({ createElement() {}, useState() {}, useEffect() {}, useCallback() {} })
  // Execute the bundle against the fake loader: the file expects `window` and
  // `require` in scope and calls `window.__ModuleLoader__.load` itself.
  const evaluate = new Function('window', 'require', source) // eslint-disable-line no-new-func
  evaluate(fakeWindow, fakeRequire)

  assert.equal(loaded.id, 'dsh-rea-agents')
  const exports = loaded.factory(fakeRequire)
  assert.equal(exports.name, 'dsh-rea-agents')
  assert.deepEqual(exports.inject, ['slots'])

  /** Capture what the plugin registers, with a minimal slot ledger. */
  const registered = []
  const ctx = {
    slots: {
      inject(name, factory) {
        assert.equal(name, 'plugins.bundle.config', `unexpected slot ${name}`)
        return factory()
      },
      register(definition, component) {
        // The ledger refuses a keyed registration that names no key, and the
        // page's ledger reads that key before rendering the seat at all. A stub
        // that skips this is what let the controls vanish once, unseen.
        if (definition.name === 'plugins.bundle.config' && definition.key === undefined) {
          throw new Error(`keyed slot "${definition.name}" requires options.key`)
        }
        registered.push({ definition, component })
        return () => {}
      },
    },
    get() { return undefined },
    effect(factory) { factory() },
  }
  exports.apply(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].definition.name, 'plugins.bundle.config')
  // This plugin owns itself, so it keys the seat by its own package name — the
  // same string the page's ledger checks against the opened package.
  assert.equal(registered[0].definition.key, 'dsh-rea-agents')

  // The seat is also asked for a one-liner; the controls are page-only.
  const BundleConfig = registered[0].component
  assert.equal(BundleConfig({ view: 'summary' }), null)
  assert.equal(BundleConfig({}), null)
})

await test('reports a profile with nothing installed', async () => {
  const dir = await makeProfile()
  try {
    const { call } = mount(dir)
    const answer = await call('/state')
    assert.equal(answer.status, 200)
    assert.equal(answer.body.installed, null)
    assert.equal(answer.body.declared, null)
    assert.equal(answer.body.package, 'rea-agents')
    assert.equal(answer.body.writable, true)
    assert.equal(answer.body.profileDir, dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('every route the browser half calls accepts the method it uses', async () => {
  // This guards a 404 that really shipped. The browser half used to infer the
  // method from whether a body was passed, so the two actions that take no
  // arguments — checking the registry, and removing the pin — went out as GETs
  // to routes that only accept POST. The host then answered 404 for a route it
  // does handle, which reads as "no such route" rather than "wrong method".
  const { readFileSync } = await import('node:fs')
  const { fileURLToPath } = await import('node:url')
  const host = readFileSync(fileURLToPath(new URL('../lib/index.js', import.meta.url)), 'utf8')
  const client = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

  // Routes the host dispatches, spelled as `route === '/x' && request.method === 'Y'`.
  const accepted = new Set(
    [...host.matchAll(/route === '(\/[a-z]+)' && request\.method === '([A-Z]+)'/gu)]
      .map(match => `${match[2]} ${match[1]}`),
  )
  assert.ok(accepted.size >= 5, `expected the host to declare its routes, found ${accepted.size}`)

  // Calls the browser half makes, spelled as `apiGet('x')` / `apiPost('x')`.
  const calls = [...client.matchAll(/api(Get|Post)\('([a-z]+)'/gu)]
    .map(match => ({ method: match[1] === 'Get' ? 'GET' : 'POST', route: `/${match[2]}` }))
  assert.ok(calls.length >= 4, `expected the browser half to call the host, found ${calls.length}`)

  const refused = calls.filter(call => !accepted.has(`${call.method} ${call.route}`))
  assert.deepEqual(
    refused.map(call => `${call.method} ${call.route}`),
    [],
    'the host would answer 404 for these calls',
  )
})

await test('reports the installed version and its pin provenance', async () => {
  const dir = await makeProfile()
  try {
    await pretendInstalled(dir, '6.5.0')
    await mkdir(join(dir, 'dsh-rea-agents'), { recursive: true })
    await writeFile(
      join(dir, 'dsh-rea-agents', 'pin.json'),
      `${JSON.stringify({ version: '6.5.0', pinnedAt: '2026-10-16T00:00:00.000Z', latestKnown: '6.6.0' })}\n`,
      'utf8',
    )
    const { call } = mount(dir)
    const answer = await call('/state')
    assert.equal(answer.body.installed.version, '6.5.0')
    assert.equal(answer.body.installed.pinnedAt, '2026-10-16T00:00:00.000Z')
    assert.equal(answer.body.latestKnown, '6.6.0')
    assert.equal(answer.body.enginesWarning, null, 'a satisfying engines range must not warn')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('declares the pinned version it finds in the profile manifest', async () => {
  const dir = await makeProfile()
  try {
    await writeFile(
      join(dir, 'package.json'),
      `${JSON.stringify({ name: 'fixture-profile', private: true, dependencies: { 'rea-agents': '6.5.0' } }, null, 2)}\n`,
      'utf8',
    )
    await pretendInstalled(dir, '6.5.0')
    const { call } = mount(dir)
    const answer = await call('/state')
    assert.equal(answer.body.declared, '6.5.0')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('warns when the installed release wants a newer node', async () => {
  const dir = await makeProfile()
  try {
    await pretendInstalled(dir, '9.0.0', { node: '>=99.0.0' })
    const { call } = mount(dir)
    const answer = await call('/state')
    assert.ok(
      typeof answer.body.enginesWarning === 'string' && answer.body.enginesWarning.includes('99.0.0'),
      `expected a warning naming 99.0.0, got ${JSON.stringify(answer.body.enginesWarning)}`,
    )
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('rejects a non-loopback caller', async () => {
  const dir = await makeProfile()
  try {
    const { call } = mount(dir)
    const request = Readable.from([])
    request.method = 'GET'
    request.url = '/rea-agents/state'
    request.socket = { remoteAddress: '10.0.0.9' }
    let status = 0
    let text = ''
    let handler
    plugin.apply({
      webServer: { register(route) { handler = route.handler; return () => {} } },
      get() { return { dir } },
      effect(factory) { factory() },
    })
    await handler(request, { writeHead(code) { status = code }, end(chunk) { text += String(chunk ?? '') } })
    assert.equal(status, 403)
    assert.match(text, /loopback/u)
    // The loopback helper is exercised above; `call` stays unused here on purpose.
    void call
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('refuses an install request without a version', async () => {
  const dir = await makeProfile()
  try {
    const { call } = mount(dir)
    const answer = await call('/install', {}, 'POST')
    assert.equal(answer.status, 400)
    assert.equal(answer.body.ok, false)
    assert.match(answer.body.reason, /explicit version/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('refuses a malformed version before running pnpm', async () => {
  const dir = await makeProfile()
  try {
    const { call } = mount(dir)
    const answer = await call('/install', { version: 'not-a-version; rm -rf /' }, 'POST')
    assert.equal(answer.body.ok, false)
    assert.match(answer.body.reason, /unexpected version string/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('answers unknown routes with 404', async () => {
  const dir = await makeProfile()
  try {
    const { call } = mount(dir)
    const answer = await call('/nope')
    assert.equal(answer.status, 404)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('an install or check never creates the user patch layer', async () => {
  const dir = await makeProfile()
  try {
    const { call } = mount(dir)
    // `/check` may or may not reach a registry here; either way the plugin must
    // not write the user's patch layer. The route is driven for its side
    // effects only, so a failed lookup is an acceptable outcome.
    await call('/check', {}, 'POST')
    const patch = join(dir, 'cordis.patch.yml')
    let patchText = null
    try {
      patchText = await readFile(patch, 'utf8')
    } catch {
      patchText = null
    }
    assert.equal(patchText, null, 'the plugin must not create or edit the user patch layer')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('the launcher refuses a call without a profile directory', async () => {
  const dir = await makeProfile()
  try {
    const { spawnSync } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const launcher = fileURLToPath(new URL('../lib/rea-mcp.mjs', import.meta.url))
    // Called the way the harness would be called if the patch lost its profile
    // argument: the launcher must refuse rather than guess a directory.
    const result = spawnSync(process.execPath, [launcher, 'mcp'], { cwd: dir, encoding: 'utf8', timeout: 30_000 })
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`)
    assert.match(result.stderr, /without a usable profile directory/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('the launcher names the remedy when the profile holds no pin', async () => {
  const dir = await makeProfile()
  try {
    const { spawnSync } = await import('node:child_process')
    const { fileURLToPath } = await import('node:url')
    const launcher = fileURLToPath(new URL('../lib/rea-mcp.mjs', import.meta.url))
    // A real profile with no rea-agents installed: the launcher must say which
    // button to press instead of resolving some other copy from PATH.
    const result = spawnSync(process.execPath, [launcher, dir, 'mcp'], {
      cwd: dir,
      encoding: 'utf8',
      timeout: 30_000,
      env: { ...process.env, NODE_PATH: '' },
    })
    assert.equal(result.status, 1, `expected exit 1, got ${result.status}: ${result.stderr}`)
    assert.match(result.stderr, /press Install|press Update/u)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

await test('the browser half renders its section for its own bundle', async () => {
  // Delegated to the render harness so the two cannot drift: it drives the
  // registered component with a minimal React and asserts real output. That
  // covers the case this suite's slot stub cannot — a component that returns
  // null, which looks identical to "not registered" on the page.
  const { spawnSync } = await import('node:child_process')
  const { fileURLToPath } = await import('node:url')
  const harness = fileURLToPath(new URL('./render.mjs', import.meta.url))
  const result = spawnSync(process.execPath, [harness], { encoding: 'utf8', timeout: 60_000 })
  assert.equal(result.status, 0, `render harness failed:\n${result.stdout}${result.stderr}`)
  assert.match(result.stdout, /all passing/u)
})

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} failing, ${passed} passing\n`)
  process.exit(1)
}
process.stdout.write(`\n${passed} passing\n`)
