/**
 * Reproduce the client-module composer's decision for one package against the
 * live profile, without booting the app.
 *
 * The composer asks three questions per Loader row: resolve the package root,
 * read `dsh.client`, then accept `exports["./client"]` and read its bytes. This
 * script asks the same three in the same order and reports the first that
 * fails. It exists because "the section does not appear" has several distinct
 * causes — a missing row, an unresolvable package, a rejected declaration, or a
 * bundle the page silently dropped — and guessing between them wastes a restart.
 */
import { createRequire } from 'node:module'
import { readFileSync, statSync } from 'node:fs'
import { dirname, join } from 'node:path'

const profileDir = join(process.env.USERPROFILE ?? '', '.dsh', 'profiles', 'desktop')
const require = createRequire(join(profileDir, 'package.json'))

/** Every package that declares a browser half, so the two can be compared. */
const targets = ['dsh-rea-agents', 'dsh-mcp-manager-plus']

/**
 * Ask the composer's questions for one package.
 * @param packageName - bare package name as the Loader row spells it.
 */
function inspect(packageName) {
  const steps = []
  let pkgPath
  try {
    pkgPath = require.resolve(`${packageName}/package.json`)
    steps.push(['resolve package.json', true, pkgPath])
  } catch (error) {
    steps.push(['resolve package.json', false, error.code ?? error.message])
    return { packageName, steps }
  }

  const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  const decl = pkg?.dsh?.client
  steps.push(['dsh.client present', decl !== undefined, JSON.stringify(decl ?? null)])
  if (decl === undefined) return { packageName, steps }
  steps.push(['platform is web', decl.platform === 'web', String(decl.platform)])

  const exportsField = pkg?.exports
  steps.push(['exports is an object', typeof exportsField === 'object' && exportsField !== null, typeof exportsField])
  if (typeof exportsField !== 'object' || exportsField === null) return { packageName, steps }

  const client = exportsField['./client']
  const relative = typeof client === 'string' ? client : client?.default
  steps.push(['exports["./client"] is a string', typeof relative === 'string', String(relative)])
  if (typeof relative !== 'string') return { packageName, steps }

  const clientPath = join(dirname(pkgPath), relative)
  try {
    const bytes = statSync(clientPath).size
    readFileSync(clientPath)
    steps.push(['client bundle readable', true, `${clientPath} (${bytes} bytes)`])
  } catch (error) {
    steps.push(['client bundle readable', false, `${clientPath}: ${error.message}`])
  }

  return { packageName, steps }
}

let failedSomewhere = false
for (const target of targets) {
  const { steps } = inspect(target)
  process.stdout.write(`${target}\n`)
  for (const [step, ok, detail] of steps) {
    process.stdout.write(`  ${ok ? 'ok  ' : 'FAIL'}  ${step.padEnd(32)} ${detail}\n`)
    if (!ok) failedSomewhere = true
  }
  process.stdout.write('\n')
}

process.exit(failedSomewhere ? 1 : 0)
