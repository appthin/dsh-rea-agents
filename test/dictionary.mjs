/**
 * Audit the client dictionary: report keys defined but never used, and keys
 * used but never defined. A stale key is not a runtime failure — it is dead
 * copy and dead translations that drift from what the section actually says.
 */
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

// Slice the DICT literal itself out of the file: from its declaration to the
// statement that follows it. Anchoring here keeps fetch options and component
// props — which also sit at an eight-space indent inside their own literals —
// from being mistaken for dictionary entries.
const dictStart = src.indexOf('var DICT = {')
const dictEnd = src.indexOf('\n    };', dictStart)
if (dictStart === -1 || dictEnd === -1) {
  process.stdout.write('dictionary problems:\n  - the DICT literal was not found\n')
  process.exit(1)
}
const dict = src.slice(dictStart, dictEnd)

/** Top-level keys of one locale object inside DICT. */
function block(locale, next) {
  const start = dict.indexOf(`\n      ${locale}: {`)
  if (start === -1) return ''
  const end = next === null ? dict.length : dict.indexOf(`\n      ${next}: {`)
  return dict.slice(start, end === -1 ? dict.length : end)
}

const zh = block('zh', 'en')
const en = block('en', null)

/** Keys of a locale block, at the copy's own indent inside DICT. */
function keysOf(text) {
  return [...text.matchAll(/^ {8}([A-Za-z][A-Za-z0-9]*):/gmu)].map(m => m[1])
}

const zhKeys = keysOf(zh)
const enKeys = keysOf(en)

// `t` is also the parameter name of two callbacks in this file, so only count
// calls whose literal names a key one of the dictionaries defines.
const known = new Set([...zhKeys, ...enKeys])

/** Whether the component reads this key through `t(...)`. */
const used = key => src.includes(`t('${key}'`)

const problems = []

const onlyZh = zhKeys.filter(k => !enKeys.includes(k))
const onlyEn = enKeys.filter(k => !zhKeys.includes(k))
if (onlyZh.length > 0) problems.push(`defined in zh but not en: ${onlyZh.join(', ')}`)
if (onlyEn.length > 0) problems.push(`defined in en but not zh: ${onlyEn.join(', ')}`)

const unused = zhKeys.filter(k => !used(k))
if (unused.length > 0) problems.push(`defined but never read: ${unused.join(', ')}`)

// Every t('literal') call whose literal looks like copy must name a known key.
// React's `h(tag, props)` and fetch options are not translation calls, so a
// literal outside the dictionary is only a problem when it is shaped like one
// of this file's camelCase keys AND is passed to the translator by name.
const calls = [...src.matchAll(/\bt\('([A-Za-z][A-Za-z0-9]*)'/gu)].map(m => m[1])
const missing = [...new Set(calls)].filter(k => !known.has(k))
if (missing.length > 0) problems.push(`read but not defined: ${missing.join(', ')}`)

// Text that can never be translated is text that sits outside the dictionaries.
// A CJK character anywhere else is either a hardcoded label or Chinese
// punctuation joining translated pieces, and either one stays Chinese under an
// English interface. Both kinds have shipped in this file before, so both are
// checked rather than trusted.
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/u

const enCjk = en.split('\n').filter(line => CJK.test(line))
if (enCjk.length > 0) {
  problems.push(`the en dictionary carries CJK: ${enCjk.map(line => line.trim()).join(' | ')}`)
}

// Line numbers are counted against the whole file so a report points at the
// line a reader will find in an editor, not at an offset inside a slice.
const firstDictLine = src.slice(0, dictStart).split('\n').length
const lastDictLine = src.slice(0, dictEnd).split('\n').length
src.split('\n').forEach((line, index) => {
  const number = index + 1
  if (number >= firstDictLine && number <= lastDictLine) return
  if (CJK.test(line)) problems.push(`CJK outside the dictionary at L${number}: ${line.trim()}`)
})

if (problems.length > 0) {
  process.stdout.write(`dictionary problems:\n${problems.map(p => `  - ${p}`).join('\n')}\n`)
  process.exit(1)
}

process.stdout.write(`dictionary ok: ${zhKeys.length} keys, both locales, all read, no CJK outside zh\n`)
