#!/usr/bin/env node
/**
 * MCP server entry point for the pinned `rea-agents` copy.
 *
 * The MCP client spawns this file as:
 *
 *     <node> rea-mcp.mjs <profile-dir> mcp
 *
 * It resolves the pinned package from `<profile-dir>` and hands control to its
 * CLI, which is what keeps a boot tied to one reviewed version.
 *
 * ## Why the profile directory is passed in
 *
 * This plugin can be installed as a symlink (`file:` or `link:` specs), and
 * Node resolves `import.meta.url` through symlinks to the *real* location. A
 * launcher that searched upward from its own URL would therefore look beside
 * the plugin's source checkout instead of beside the profile's own
 * `node_modules`, and would either miss the pinned copy or — worse — find an
 * unrelated one. The caller states the profile explicitly so resolution always
 * starts from the tree that holds the pin.
 *
 * ## Why not start `rea` from PATH
 *
 * The MCP child runs with a scrubbed environment. `PATH` may hold no `rea` at
 * all, and a `rea` that is there is whatever the operator last installed
 * globally, not the version this profile pinned. Starting that would make the
 * pin meaningless. Resolving through `createRequire` against the profile also
 * means pnpm's store layout (real directory or symlink) does not matter.
 *
 * The package declares no `main` or `exports` map, so it can only be reached by
 * subpath; that is why the specifier names the script explicitly.
 *
 * If the pin is missing, the process exits with a message naming the remedy and
 * the MCP client reports the server as unavailable, rather than silently
 * running some other copy.
 */

import { createRequire } from 'node:module'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

/** Package this launcher is pinned to. */
const PACKAGE = 'rea-agents'

/** Subpath of the published CLI entry point. */
const ENTRY = 'scripts/rea.mjs'

/** Position of the profile directory in this launcher's own argv. */
const ARGV_PROFILE = 2

function fail(message) {
  process.stderr.write(`dsh-rea-agents: ${message}\n`)
  process.exit(1)
}

const profileDir = process.argv[ARGV_PROFILE]

if (typeof profileDir !== 'string' || profileDir === '' || !existsSync(profileDir)) {
  fail(
    `the MCP entry was started without a usable profile directory (got ${JSON.stringify(profileDir ?? null)}) — `
    + 'reinstall the plugin so its cordis.patch.yml passes the profile through.',
  )
}

// Resolution is anchored at a file *inside* the profile, so Node searches that
// tree's node_modules first. The anchor need not exist; only its directory is
// used as the starting point.
const require = createRequire(join(profileDir, 'package.json'))

let resolved
try {
  resolved = require.resolve(`${PACKAGE}/${ENTRY}`)
} catch {
  fail(
    `no pinned ${PACKAGE} in this profile — open the REA page in Settings and press Install, `
    + 'or press Update if it reports a version to move to.',
  )
}

// The REA CLI reads its subcommand from argv[2]. This launcher consumed one
// extra argument (the profile directory) to resolve the package, so argv is
// rewritten back to the shape the CLI expects before control is handed over.
process.argv = [process.argv[0], resolved, ...process.argv.slice(ARGV_PROFILE + 1)]

// Importing the real entry point (rather than spawning it) keeps this process
// as the single stdio owner: the CLI connects to the MCP transport on our
// stdin/stdout, which a child process would have to inherit and duplicate.
await import(pathToFileURL(resolved).href)
