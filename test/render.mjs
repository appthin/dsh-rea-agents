/**
 * Render the browser half's section against a minimal React, in every state it
 * can reach, and assert it produces content each time.
 *
 * This harness exists because of a real failure. The section rendered its
 * loading state, then threw on the state that follows it, and React unmounted
 * the whole contribution — so the controls vanished with nothing reported
 * anywhere. A harness that only rendered the first state could not see it, so
 * this one runs the effects, settles the fetch, re-renders, and checks the
 * result of each pass: loading, ready, and failed.
 *
 * The host is not involved: `/state` is answered from a stub so the test stays
 * offline and deterministic.
 */

import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const source = readFileSync(fileURLToPath(new URL('../lib/client.js', import.meta.url)), 'utf8')

// ---- Minimal React ----------------------------------------------------------

/** This component instance's hook cells, position-stable across renders. */
const hooks = []
let hookIndex = 0

/** Effects whose dependency list moved in this render, in declaration order. */
let effectQueue = []
/** Set by a state setter; drives another render pass. */
let dirty = false

const react = {
  createElement: (type, props, ...children) => ({
    type,
    props: props ?? {},
    children: children.flat().filter(child => child !== null && child !== undefined && child !== false),
  }),
  useState(initial) {
    const index = hookIndex++
    if (hooks[index] === undefined) hooks[index] = typeof initial === 'function' ? initial() : initial
    const set = value => {
      hooks[index] = typeof value === 'function' ? value(hooks[index]) : value
      dirty = true
    }
    return [hooks[index], set]
  },
  useEffect(fn, deps) {
    const index = hookIndex++
    const previous = hooks[index]
    const changed = previous === undefined
      || deps === undefined
      || deps.length !== previous.deps.length
      || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
    hooks[index] = { deps: deps ?? null, cleanup: previous?.cleanup }
    if (changed) effectQueue.push({ index, fn })
  },
  useCallback(fn, deps) {
    const index = hookIndex++
    const previous = hooks[index]
    const changed = previous === undefined
      || deps === undefined
      || deps.length !== previous.deps.length
      || deps.some((dep, i) => !Object.is(dep, previous.deps[i]))
    if (changed) hooks[index] = { deps: deps ?? null, fn }
    return hooks[index].fn
  },
}

/** Render one element tree, invoking function components. */
function render(element) {
  if (element === null || element === undefined) return null
  if (typeof element === 'string') return element
  if (typeof element.type === 'string') {
    return { ...element, children: element.children.map(render).filter(child => child !== null) }
  }
  return render(element.type({ ...element.props, children: element.children }))
}

/** Collect every string a rendered tree contains, in document order. */
function textsOf(node, out = []) {
  if (node === null || node === undefined) return out
  if (typeof node === 'string') { out.push(node); return out }
  for (const child of node.children ?? []) textsOf(child, out)
  return out
}

// ---- Ambient stubs -----------------------------------------------------------

const fakeDocument = {
  getElementById: () => null,
  createElement: () => ({ id: '', textContent: '' }),
  head: { appendChild() {} },
  // The mount-report effect looks for its own anchor; finding none makes it
  // report and return, which is all the render path needs.
  querySelectorAll: () => [],
}

/**
 * Render repeatedly until the component stops changing, running each effect
 * whose dependencies moved and letting the promises they start settle.
 * @param element - the element to render.
 * @returns the final tree plus the text of every pass, so a throw in a later
 * pass is visible as a missing state rather than a passing test.
 */
async function settle(element) {
  const passes = []
  for (let pass = 0; pass < 6; pass += 1) {
    dirty = false
    hookIndex = 0
    effectQueue = []
    const tree = render(element)
    passes.push(textsOf(tree).join(' '))
    for (const { index, fn } of effectQueue) {
      const result = fn()
      if (typeof result === 'function') hooks[index].cleanup = result
    }
    // Let every microtask the effects started run out: `api()` chains a fetch
    // promise through `.then(… .json())` and then a state setter, which is
    // several turns. A macrotask boundary is the reliable way to drain them.
    await new Promise(resolve => setImmediate(resolve))
    if (!dirty) return { tree, passes }
  }
  return { tree: null, passes }
}

// ---- Load the bundle --------------------------------------------------------

let definition
const fakeWindow = {
  __ModuleLoader__: { load(d) { definition = d } },
  confirm: () => true,
}
const fakeRequire = () => react
globalThis.document = fakeDocument
new Function('window', 'require', source)(fakeWindow, fakeRequire)

const exports = definition.factory(fakeRequire)

// ---- Slot ledger stub, with its real admission rules -------------------------

/**
 * A controllable stand-in for DSH's locale service.
 *
 * The real snapshot carries the active language in `active`, and the plugin
 * subscribes to be told when it moves. Both are reproduced here: reading the
 * wrong field once pinned the whole section to Chinese, and a stub that could
 * not switch languages could not have caught it.
 */
const localeService = {
  active: 'en',
  /** Callbacks the plugin registers; `setLocale` drives them. */
  listeners: [],
  getLocale() { return { active: localeService.active, locales: [], revision: 0 } },
  subscribe(listener) { localeService.listeners.push(listener); return () => {} },
}

/** Switch the stand-in's language the way the real service would. */
function setLocale(active) {
  localeService.active = active
  for (const listener of localeService.listeners) listener()
}

const registered = []
const ctx = {
  slots: {
    inject(name, factory) { return factory() },
    register(definition_, component) {
      // The ledger refuses a registration that omits the field its kind keys
      // on. A stub that accepts anything is how the controls once vanished with
      // nothing reported: the throw was swallowed by entry reconciliation.
      if (definition_.name === 'plugins.bundle.config' && definition_.key === undefined) {
        throw new Error(`keyed slot "${definition_.name}" requires options.key`)
      }
      if (definition_.name === 'plugins.detail.section' && definition_.id === undefined) {
        throw new Error(`list slot "${definition_.name}" requires options.id`)
      }
      registered.push({ definition: definition_, component })
      return () => {}
    },
  },
  get(name) { return name === 'locale' ? localeService : undefined },
  effect(factory) { return factory() },
  logger: { warn() {}, error() {} },
}

exports.apply(ctx)

assert.equal(registered.length, 1, 'exactly one slot registration is expected')
// This plugin owns itself, so it registers into the keyed seat for a bundle's
// own configuration, under its own package name. That key is also what the
// page's ledger checks before drawing the seat at all.
assert.equal(registered[0].definition.name, 'plugins.bundle.config')
assert.equal(registered[0].definition.key, 'dsh-rea-agents')

const entry = registered[0].component

/** The host state payload the stub serves. */
const statePayload = {
  profileDir: 'C:\\Users\\Terry\\.dsh\\profiles\\desktop',
  profileSource: 'profileContext',
  writable: true,
  manifestDigest: 'abc',
  package: 'rea-agents',
  declared: '6.5.0',
  installed: {
    version: '6.5.0', entry: 'x', path: 'y',
    pinnedAt: '2026-10-17T04:28:00.643Z', pinnedFrom: 'install', engines: null,
  },
  pinned: '6.5.0',
  pinnedAt: '2026-10-17T04:28:00.643Z',
  latestKnown: '6.5.0',
  checkedAt: '2026-10-17T04:28:00.643Z',
  enginesWarning: null,
  nodeVersion: '24.18.1',
}

/** Point the ambient fetch at a payload, or at a rejection. */
function answerWith(payload) {
  globalThis.fetch = () => Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
}
function failWith(message) {
  globalThis.fetch = () => Promise.reject(new Error(message))
}

// ---- The checks --------------------------------------------------------------

const failures = []
const check = async (name, fn) => {
  try {
    await fn()
    process.stdout.write(`  ok    ${name}\n`)
  } catch (error) {
    failures.push(name)
    process.stdout.write(`  FAIL  ${name}\n        ${error.message}\n`)
  }
}

process.stdout.write('browser half render\n')

await check('declines the summary view', async () => {
  assert.equal(entry({ view: 'summary' }), null)
  assert.equal(entry({}), null, 'an absent view must not render the controls')
})

await check('every component it renders is defined', async () => {
  // A static guard for the whole class of bug this file was written for: a
  // component renamed in one place but still referenced by its old name
  // elsewhere. Exercising every state catches it too, but only for the states
  // the harness happens to reach; this catches it for every call site at once.
  const defined = new Set(
    [...source.matchAll(/function\s+([A-Z][A-Za-z0-9]*)\s*\(/gu)].map(match => match[1]),
  )
  // Uppercase identifiers handed to `h(...)`, on one line or the next.
  const used = [...source.matchAll(/\bh\(\s*([A-Z][A-Za-z0-9]*)\s*[,\n]/gu)].map(match => match[1])
  const dangling = [...new Set(used)].filter(name => !defined.has(name))
  assert.deepEqual(dangling, [], `h() references undefined component(s): ${dangling.join(', ')}`)
})

/** Any CJK character: in an English section there must be none. */
const CJK = /[\u3000-\u303f\u3400-\u4dbf\u4e00-\u9fff\uff00-\uffef]/u

await check('renders entirely in English while English is the active locale', async () => {
  // The strong form of the assertion is "no CJK survives anywhere", not "the
  // heading is English". A section that mixes languages passes the weak form and
  // fails this one — which is the exact shape of the bug this covers, where one
  // component derived its own translator and silently fell back to Chinese.
  setLocale('en')
  answerWith(statePayload)
  hooks.length = 0
  const { passes } = await settle(entry({ view: 'page' }))
  const joined = passes.join(' | ')
  assert.match(joined, /REA version/u, `expected the English heading, got: ${joined}`)
  // The installed version must survive into the rendered text: it is what the
  // user reads to know which copy the MCP server will start.
  assert.match(joined, /6\.5\.0/u, `expected the pinned version, got: ${joined}`)
  assert.doesNotMatch(joined, CJK, `English output contains CJK: ${joined}`)
})

await check('renders entirely in Chinese while Chinese is the active locale', async () => {
  setLocale('zh')
  answerWith(statePayload)
  hooks.length = 0
  const { passes } = await settle(entry({ view: 'page' }))
  const joined = passes.join(' | ')
  assert.match(joined, /REA 版本/u, `expected the Chinese heading, got: ${joined}`)
  assert.match(joined, /6\.5\.0/u, `expected the pinned version, got: ${joined}`)
})

await check('follows a language switch made after it mounted', async () => {
  // A switch must reach a section that is already registered, which is what the
  // subscription exists for. Rendering once and calling it done would leave the
  // section in whatever language it was born with.
  setLocale('en')
  answerWith(statePayload)
  hooks.length = 0
  const before = (await settle(entry({ view: 'page' }))).passes.join(' | ')
  assert.doesNotMatch(before, CJK, `expected English before the switch, got: ${before}`)

  setLocale('zh')
  const after = (await settle(entry({ view: 'page' }))).passes.join(' | ')
  assert.match(after, /REA 版本/u, `expected Chinese after the switch, got: ${after}`)
})

await check('renders the failure line in English, with English punctuation', async () => {
  setLocale('en')
  failWith('network down')
  hooks.length = 0
  const { passes } = await settle(entry({ view: 'page' }))
  const joined = passes.join(' | ')
  assert.match(joined, /Could not load: network down/u, `expected the English failure line, got: ${joined}`)
  assert.match(joined, /Retry/u, `expected a retry control, got: ${joined}`)
  assert.doesNotMatch(joined, CJK, `English failure output contains CJK: ${joined}`)
})

await check('renders the failure line in Chinese for a Chinese interface', async () => {
  setLocale('zh')
  failWith('network down')
  hooks.length = 0
  const { passes } = await settle(entry({ view: 'page' }))
  const joined = passes.join(' | ')
  assert.match(joined, /读取失败：network down/u, `expected the Chinese failure line, got: ${joined}`)
  assert.match(joined, /重试/u, `expected a retry control, got: ${joined}`)
})

await check('prefers the framework translator when one is handed down', async () => {
  // This is the path production actually takes: the shell synthesizes `t` from
  // the declared namespace and re-derives it on a locale switch. Every check
  // above runs through the dictionary fallback, so without this one the seat the
  // section really uses would go untested.
  setLocale('en')
  answerWith(statePayload)
  hooks.length = 0
  const marker = key => `FRAMEWORK(${key})`
  const { passes } = await settle(entry({ view: 'page', t: marker }))
  const joined = passes.join(' | ')
  assert.match(joined, /FRAMEWORK\(sectionTitle\)/u, `the framework seat must win, got: ${joined}`)
  assert.match(joined, /FRAMEWORK\(loading\)/u, `the loading copy must come from the seat, got: ${joined}`)
})

/** Every host `button` in a rendered tree, in document order. */
function buttonsOf(node, out = []) {
  if (node === null || node === undefined || typeof node === 'string') return out
  if (node.type === 'button') out.push(node)
  for (const child of node.children ?? []) buttonsOf(child, out)
  return out
}

/**
 * Answer each route from a map, so one render can drive several endpoints.
 *
 * A route's value may be a function, called per request. That is how a test
 * models the disk: `/state` answers with whatever the "disk" currently holds, so
 * a refresh after an action can be shown to observe the change rather than be
 * handed a fixture that agrees with it.
 */
function answerRoutes(routes) {
  globalThis.fetch = url => {
    const key = Object.keys(routes).find(candidate => String(url).startsWith(candidate))
    const entry = routes[key]
    if (entry === undefined) return Promise.reject(new Error(`unexpected fetch: ${url}`))
    try {
      const payload = typeof entry === 'function' ? entry() : entry
      if (payload instanceof Error) return Promise.reject(payload)
      return Promise.resolve({ ok: true, json: () => Promise.resolve(payload) })
    } catch (error) {
      return Promise.reject(error)
    }
  }
}

await check('reports a successful update and shows the version it landed on', async () => {
  // The user-visible acceptance test: press Update, and the section must say it
  // succeeded AND show the new version without a manual refresh.
  setLocale('en')
  let disk = { ...statePayload, latestKnown: '6.7.0' }
  const after = {
    ...statePayload,
    latestKnown: '6.7.0',
    declared: '6.7.0',
    pinned: '6.7.0',
    installed: { ...statePayload.installed, version: '6.7.0' },
  }
  answerRoutes({
    '/rea-agents/state': () => disk,
    '/rea-agents/update': () => {
      disk = after
      return { ok: true, log: 'dependencies:\n+ rea-agents 6.7.0', exempted: [], state: after }
    },
  })

  hooks.length = 0
  const first = await settle(entry({ view: 'page' }))
  assert.match(first.passes.join(' | '), /6\.5\.0/u, 'the section should start on 6.5.0')

  const update = buttonsOf(first.tree).find(button => /Update to 6\.7\.0/u.test(textsOf(button).join(' ')))
  assert.ok(update, 'the update control must be offered before the update')

  update.props.onClick()
  await new Promise(resolve => setImmediate(resolve))

  const second = await settle(entry({ view: 'page' }))
  const joined = second.passes.join(' | ')
  assert.match(joined, /Updated from 6\.5\.0 to 6\.7\.0/u, `expected a success notice, got: ${joined}`)
  assert.match(joined, /Current version 6\.7\.0/u, `expected the new version to be shown, got: ${joined}`)
})

await check('shows the version on disk even when the update reply is lost', async () => {
  // The failure that made the card need a manual refresh: the install completed
  // on disk while the reply never arrived, so a card that trusted the reply kept
  // showing the old version. The refresh must come from `/state`, and the
  // outcome must be read from the disk rather than from the lost request.
  setLocale('en')
  let disk = { ...statePayload, latestKnown: '6.7.0' }
  const after = {
    ...statePayload,
    latestKnown: '6.7.0',
    pinned: '6.7.0',
    installed: { ...statePayload.installed, version: '6.7.0' },
  }
  answerRoutes({
    '/rea-agents/state': () => disk,
    '/rea-agents/update': () => {
      disk = after
      return new Error('connection reset')
    },
  })

  hooks.length = 0
  const first = await settle(entry({ view: 'page' }))
  const update = buttonsOf(first.tree).find(button => /Update to 6\.7\.0/u.test(textsOf(button).join(' ')))
  assert.ok(update, 'the update control must be offered')
  update.props.onClick()
  await new Promise(resolve => setImmediate(resolve))

  const joined = (await settle(entry({ view: 'page' }))).passes.join(' | ')
  assert.match(joined, /Current version 6\.7\.0/u, `the card must follow the disk, got: ${joined}`)
  // Reporting only the failed request would deny work that actually finished.
  assert.match(joined, /Updated from 6\.5\.0 to 6\.7\.0/u, `the moved version must be reported, got: ${joined}`)
  assert.match(joined, /read back from the version on disk/u, `the loss must be disclosed, got: ${joined}`)
})

await check('still reports the failure when a lost reply changed nothing', async () => {
  // The other half of the rule above: a lost reply is not evidence of success.
  // With the version unmoved, the request's failure is the only true story.
  setLocale('en')
  const disk = { ...statePayload, latestKnown: '6.7.0' }
  answerRoutes({
    '/rea-agents/state': () => disk,
    '/rea-agents/update': () => new Error('connection reset'),
  })

  hooks.length = 0
  const first = await settle(entry({ view: 'page' }))
  const update = buttonsOf(first.tree).find(button => /Update to 6\.7\.0/u.test(textsOf(button).join(' ')))
  assert.ok(update, 'the update control must be offered')
  update.props.onClick()
  await new Promise(resolve => setImmediate(resolve))

  const joined = (await settle(entry({ view: 'page' }))).passes.join(' | ')
  assert.match(joined, /connection reset/u, `the failure must be reported, got: ${joined}`)
  assert.match(joined, /Current version 6\.5\.0/u, `nothing moved, so 6.5.0 stands, got: ${joined}`)
  assert.doesNotMatch(joined, /Updated from/u, `no success may be claimed, got: ${joined}`)
})

await check('says which entries it had to exempt when an update needed that', async () => {
  setLocale('en')
  let disk = { ...statePayload, latestKnown: '6.7.0' }
  const after = {
    ...statePayload,
    latestKnown: '6.7.0',
    pinned: '6.7.0',
    installed: { ...statePayload.installed, version: '6.7.0' },
  }
  answerRoutes({
    '/rea-agents/state': () => disk,
    '/rea-agents/update': () => {
      disk = after
      return { ok: true, log: 'retried', exempted: ['dshmarket@1.66.36'], state: after }
    },
  })

  hooks.length = 0
  const first = await settle(entry({ view: 'page' }))
  const update = buttonsOf(first.tree).find(button => /Update to 6\.7\.0/u.test(textsOf(button).join(' ')))
  assert.ok(update, 'the update control must be offered')
  update.props.onClick()
  await new Promise(resolve => setImmediate(resolve))

  const joined = (await settle(entry({ view: 'page' }))).passes.join(' | ')
  assert.match(joined, /dshmarket@1\.66\.36/u, `the exemption must be named, got: ${joined}`)
  assert.match(joined, /6\.7\.0/u, `the landed version must be shown, got: ${joined}`)
})

if (failures.length > 0) {
  process.stdout.write(`\n${failures.length} failing\n`)
  process.exit(1)
}
process.stdout.write('\nbrowser half render: all passing\n')