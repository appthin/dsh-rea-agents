/**
 * Reproduce the client-module scan for one package, following the same steps
 * the harness uses: resolve the bare package root from the profile, read its
 * manifest, then accept the `dsh.client` declaration and its `exports["./client"]`.
 *
 * This answers "would the browser half be discovered?" without guessing from
 * the UI: if any step here fails, the bundle never reaches the page.
 */
import { createRequire } from 'node:module'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const packageName = process.argv[2] ?? 'dsh-rea-agents'
const profileDir = process.argv[3] ?? join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')

/** The profile's own manifest is the resolution base the harness uses. */
const base = join(profileDir, 'package.json')
const require = createRequire(base)

const report = []
const fail = message => {
  report.push(`  FAIL  ${message}`)
}

let pkgPath
try {
  pkgPath = require.resolve(`${packageName}/package.json`)
  report.push(`  ok    package.json resolves -> ${pkgPath}`)
} catch (error) {
  fail(`package.json does not resolve from the profile: ${error.code ?? error.message}`)
}

if (pkgPath !== undefined) {
  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const decl = pkg.dsh?.client
  if (decl === undefined) fail('manifest has no dsh.client declaration')
  else if (decl.platform !== 'web') fail(`dsh.client.platform is ${JSON.stringify(decl.platform)}, expected "web"`)
  else report.push('  ok    dsh.client declares platform "web"')

  const clientExport = pkg.exports?.['./client']
  if (clientExport === undefined) fail('manifest exports no "./client"')
  else {
    const relative = typeof clientExport === 'string' ? clientExport : clientExport.default
    if (typeof relative !== 'string') fail('exports["./client"] is not a string or {default: string}')
    else {
      const clientPath = join(dirname(pkgPath), relative)
      try {
        readFileSync(clientPath)
        report.push(`  ok    ./client resolves to an existing file -> ${clientPath}`)
      } catch {
        fail(`exports["./client"] points at a missing file: ${clientPath}`)
      }
    }
  }
}

process.stdout.write(`${packageName}\n${report.join('\n')}\n`)
