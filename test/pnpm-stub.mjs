/**
 * A stand-in for pnpm, used by the suite to drive the plugin's install paths.
 *
 * The plugin shells out to `pnpm`, so a test that wants to observe what the
 * plugin does about a supply-chain refusal has to stand in for that process. It
 * reads its script from `REA_STUB_DIR` and answers in order, which lets a case
 * describe "fails once, then succeeds" without any network or package manager.
 *
 * Written with no dependencies so it runs under the same Node as the suite.
 *
 * Protocol, in `REA_STUB_DIR`:
 *   calls.jsonl    — appended, one line per invocation: { argv, cwd }
 *   responses.json — an array of replies; the first is consumed per call
 *   install.json   — optional { version } to materialise on disk for that reply
 *
 * Each reply is { code?, stdout?, stderr?, install? }. When every reply is
 * consumed the stub exits 0 with no output, so a test never hangs on a
 * mis-declared number of invocations.
 */
import { appendFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const stateDir = process.env.REA_STUB_DIR
if (stateDir === undefined) {
  process.stderr.write('REA_STUB_DIR is not set\n')
  process.exit(2)
}

const indexPath = join(stateDir, 'responses.json')
let replies = []
try {
  replies = JSON.parse(readFileSync(indexPath, 'utf8'))
} catch {
  replies = []
}

// Record what the plugin asked for, before answering: a test asserting on the
// retry needs to see the first invocation even when it failed.
appendFileSync(
  join(stateDir, 'calls.jsonl'),
  `${JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() })}\n`,
)

const reply = replies.shift() ?? { code: 0, stdout: '', stderr: '' }
writeFileSync(indexPath, JSON.stringify(replies))

if (reply.install !== undefined) {
  const pkgDir = join(process.cwd(), 'node_modules', 'rea-agents')
  rmSync(pkgDir, { recursive: true, force: true })
  mkdirSync(join(pkgDir, 'scripts'), { recursive: true })
  writeFileSync(
    join(pkgDir, 'package.json'),
    `${JSON.stringify({ name: 'rea-agents', version: reply.install.version, engines: { node: '>=22.19.0' } }, null, 2)}\n`,
  )
  writeFileSync(join(pkgDir, 'scripts', 'rea.mjs'), '// stub entry\n')
  // The manifest is where the plugin reads the declared version from.
  const manifestPath = join(process.cwd(), 'package.json')
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
  manifest.dependencies = { ...(manifest.dependencies ?? {}), 'rea-agents': reply.install.version }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)
}

process.stdout.write(reply.stdout ?? '')
process.stderr.write(reply.stderr ?? '')
process.exit(reply.code ?? 0)