/**
 * Check the documentation's own integrity.
 *
 * Two things go wrong quietly in a bilingual README set: a cross-language link
 * points at a file that was renamed, and the screenshot list drifts from the
 * images the READMEs actually embed. Neither breaks the plugin, and neither is
 * noticed until a reader clicks. Both are mechanical, so they are checked here.
 *
 * GitHub-relative targets (`../../issues/new`, `../../releases/tag/…`) are
 * deliberately skipped: they resolve against the repository's web view, not
 * against this filesystem, so a local existence check would be a false alarm.
 */

import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** The documents to check, and the file each lives in. */
const DOCUMENTS = ['README.md', 'README.en.md', 'CHANGELOG.md', 'CHANGELOG.en.md']

/**
 * Every plain `[text](target)` in one document, in order.
 *
 * The negative lookbehind excludes `![alt](src)`: an image's source is not a
 * link, and treating it as one would demand that screenshots — which the
 * maintainer adds by hand — already exist before the check can pass.
 */
function linksIn(text) {
  return [...text.matchAll(/(?<!!)\[[^\]]*\]\(([^)\s]+)\)/gu)].map(match => match[1])
}

/** Every `![alt](target)` in one document, in order. */
function imagesIn(text) {
  return [...text.matchAll(/!\[[^\]]*\]\(([^)\s]+)\)/gu)].map(match => match[1])
}

const problems = []
let checkedLinks = 0

for (const name of DOCUMENTS) {
  const path = join(root, name)
  if (!existsSync(path)) {
    problems.push(`${name} is missing`)
    continue
  }
  const text = readFileSync(path, 'utf8')

  for (const target of linksIn(text)) {
    // Skip things a local check cannot decide.
    if (/^[a-z][a-z0-9+.-]*:/iu.test(target)) continue // http:, https:, mailto:
    if (target.startsWith('#')) continue // in-page anchor
    if (target.startsWith('../../')) continue // repository web view (issues, releases, compare)
    const resolved = target.split('#')[0]
    if (resolved === '') continue
    checkedLinks += 1
    if (!existsSync(join(root, resolved))) {
      problems.push(`${name} links to a file that does not exist: ${target}`)
    }
  }
}

// The screenshot list and the images the READMEs embed must agree, in both
// directions: an image with no listing is forgotten packaging, and a listed
// file nothing embeds is a stale entry.
const listed = JSON.parse(readFileSync(join(root, 'screenshots.json'), 'utf8'))
const embedded = new Set()
for (const name of ['README.md', 'README.en.md']) {
  for (const image of imagesIn(readFileSync(join(root, name), 'utf8'))) embedded.add(image)
}

if (listed.length === 0) problems.push('screenshots.json lists no screenshots')
if (listed.length !== new Set(listed).size) problems.push('screenshots.json repeats an entry')

for (const image of embedded) {
  if (!listed.includes(image)) problems.push(`an image is embedded but not listed in screenshots.json: ${image}`)
}
for (const image of listed) {
  if (!embedded.has(image)) problems.push(`screenshots.json lists an image nothing embeds: ${image}`)
}

// A screenshot the READMEs embed must also reach the published package. The
// `files` field decides that, and an image missing from it renders as a broken
// link on the registry page while working perfectly in the repository — which
// is exactly the kind of gap nobody notices until after publishing.
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
const shipped = manifest.files ?? []

/** Match one root-relative path against the manifest's `files` patterns. `*` is the only wildcard used. */
function isShipped(path) {
  return shipped.some(entry => {
    const pattern = String(entry)
      // Escape every regex metacharacter except `*`, then let `*` span anything.
      .replace(/[.+^${}()|[\]\\]/gu, '\\$&')
      .replace(/\*/gu, '.*')
    return new RegExp(`^${pattern}$`, 'u').test(path)
  })
}

for (const image of listed) {
  if (!isShipped(image)) problems.push(`a screenshot is not covered by package.json "files": ${image}`)
  if (!existsSync(join(root, image))) problems.push(`a listed screenshot is not in the repository: ${image}`)
}

if (problems.length > 0) {
  process.stdout.write(`documentation problems:\n${problems.map(problem => `  - ${problem}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(
  `documentation ok: ${DOCUMENTS.length} files, ${checkedLinks} local links resolve, `
  + `${listed.length} screenshots listed, embedded and shipped\n`,
)

assert.ok(true)
