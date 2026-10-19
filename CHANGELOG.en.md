# Changelog

English | [中文](CHANGELOG.md)

Every notable change to this plugin is recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the version numbers follow
[Semantic Versioning](https://semver.org/).

## [1.0.6] - 2026-10-19

### Fixed

- **After a successful update the card kept showing the old version until it was refreshed by
  hand.** The card delegated its refresh entirely to the state carried inside the action's reply.
  An install can take close to a minute, and that one reply is losable — a cut connection, a
  reloaded page, a request the shell gives up on — so **the work finished on disk while the page
  still displayed the previous version**.

  Every action now **re-reads the state from disk** afterwards (`/state` reads the installed
  manifest out of `node_modules` each time) and reports the outcome from that. The action's own
  reply is used only for what the disk cannot answer: the log, and the reason for a refusal.

- **A lost reply must not report completed work as a failure.** When the re-read shows the version
  really moved, the card says so — "Updated from A to B" — and notes that this was read back from
  disk; only when nothing moved is the request's failure the story. Neither case lets the card
  show something untrue.

## [1.0.5] - 2026-10-19

### Fixed

- **The section did not follow a language switch, and a restart did not help either.** The previous
  release read the right field (`active`) but still never made React re-render: it subscribed to
  locale changes and mutated a closed-over variable, so the value changed and the picture did not.
  It now uses the mechanism the shell provides: this half's zh/en dictionaries are registered as a
  namespace (`locale.register`), the slot registration declares that `locale` seat, and the shell
  synthesizes `t` into props — re-deriving it on a locale change, which redraws the section. When no
  locale service is available the fallback is the **browser's own language**, not a hardcoded `'en'`.

- **"Update" was deadlocked by an unrelated dependency**
  (`ERR_PNPM_MINIMUM_RELEASE_AGE_VIOLATION`). Measured, not guessed: pnpm verifies the **whole
  lockfile** before changing anything, so any entry in the profile that has not finished its
  supply-chain waiting period blocks every operation — in the field, `dshmarket@1.66.36`, which has
  nothing to do with REA. Three changes:

  1. **No more `remove` first.** Measured on pnpm 11.28.5 and 12.4.1,
     `add <pkg>@<ver> --save-exact` replaces the version in place and records it in both the manifest
     and the lockfile — the "re-adding may be a no-op" worry that justified the removal was wrong, and
     the step only added a second way to fail.
  2. **One retry with a targeted exemption.** The offending entries are parsed out of pnpm's own
     message and exempted with `--config.minimum-release-age-exclude=<name>@<version>`.
  3. **The package being installed is never exempted.** If REA's own target is too new the run stays
     failed and says so; exempting it would quietly cancel the waiting period the user relies on.

- **The parse has to tolerate a line wrap.** pnpm wraps to the terminal width and splits `within` from
  `the minimumReleaseAge cutoff` across two lines — exactly the shape the field report arrived in.
  A parser that assumed a space would find no offender, and the retry would silently never happen.

### Added

- `test/pnpm-stub.mjs`: a stand-in for pnpm that lets the suite drive the real install paths and
  inspect the command line the plugin builds — including the retry flags — with no network and no
  package manager.
- Four host cases: in-place update (and never calling `remove`), targeted-exemption retry on an
  unrelated offence, **no** exemption when the target itself is the offender, and a rule that
  unparsable text must never become a command-line flag.
- One render case: the framework-supplied `t` must win. That is the path production actually takes,
  and until now every case exercised only the dictionary fallback.
- The page now states which entries were exempted when an update needed that, instead of presenting a
  run that needed a workaround as an ordinary install.

## [1.0.4] - 2026-10-18

### Fixed

- **The section stayed Chinese after switching the interface to English.** Three unrelated defects,
  stacked:

  1. **The wrong locale-snapshot field was read.** The active language lives in `active`
     (`LocaleSnapshot` in `packages/client/locale/src/client/index.ts`), but the code read `id`, so it
     always got `undefined` and always fell back to Chinese.
  2. **The heading's component derived its own language.** `Chrome` took the language from a
     `props.locale`, and all three of its call sites pass no props — so the heading "REA 版本" was
     Chinese under every interface language. That is the "some places are still Chinese" half of the
     report. It now receives an already-bound `t`, so a forgotten prop throws instead of quietly
     drawing the wrong language.
  3. **Two messages were joined with a Chinese colon** (`：`) — the load-failure line and the
     registry-latest notice — which rendered as `Could not load：…` in English. Each is now one
     dictionary entry, letting every language choose its own wording and punctuation.

### Changed

- **The fallback language is now English rather than Chinese.** Chinese is used only while the
  interface language is Chinese; everything else resolves to English. That matches DSH's own text
  resolution, whose fallback chain ends at English.

### Added

- `test/render.mjs` now asserts that **English output contains no CJK at all**, and covers switching
  language after the section has mounted. This is the strong form of the check: the weak one ("the
  heading is English") misses a section that mixes languages, which is the shape this bug had.
- `test/dictionary.mjs` gains two rules: the English dictionary may contain no CJK, and **no CJK may
  appear outside the dictionaries** — that is, no hardcoded untranslated copy and no Chinese
  punctuation.

## [1.0.3] - 2026-10-17

### Changed

- **The "Uninstall" button is now "Uninstall REA".** The plugin card's **header** already carries an
  "Uninstall" — that one removes the plugin package; the one in this section removes REA. Two buttons
  with the same name on a single card is exactly the confusion this rename clears up. The confirmation
  dialog already said "the pinned rea-agents", so it was left alone.

## [1.0.2] - 2026-10-17

### Fixed

- **"Check for newer version" reported `HTTP 404`.** `api()` used to infer the method from whether a
  body was passed, so the two actions that take **no arguments** — checking the registry (`/check`) and
  removing the pin (`/unpin`) — went out as GETs to routes that only accept POST. The host answered 404
  for a route it does handle, which reads as "no such route" when it actually meant "wrong method". The
  method is now stated at each call site through `apiGet` / `apiPost`, and the guess is gone. The
  Uninstall button was affected by the same cause.

### Changed

- **The icon is blue instead of black.** Its stroke used `currentColor`, but the plugin manager renders
  the file through an `<img>` — an SVG loaded that way inherits nothing from the page, so
  `currentColor` could only resolve to the SVG's own default, which is black. It is now a literal blue,
  `#247bbf`, the only spelling that survives that boundary.

### Removed

- Every diagnostic instrument added while tracking the problem down: the browser half's `report()`
  calls, the host's `POST`/`GET /report` channel, the mount-probe effect, and the `data-rea-section`
  attribute. They served their purpose and no longer ship.

## [1.0.1] - 2026-10-17

### Fixed

- **The controls never appeared on the plugin's card.** Two unrelated defects stacked on top of each
  other:
  - **The slot registration was refused.** The controls were first registered into
    `plugins.detail.section` — a **list** slot, whose registrations must carry an `id`. That seat is
    for "a plugin that has something to say about bundles it does not own"; the seat for a plugin's
    **own** configuration is `plugins.bundle.config` (keyed, so it must carry a `key`). Either omission
    makes the slot ledger throw, and that throw was swallowed by the page's entry reconciliation — so
    the controls vanished with nothing reported anywhere.
  - **A component was referenced by a name it no longer had.** After the section's wrapper was renamed
    to `Chrome`, two **multi-line** `h(...)` calls still named it `Section` (a single-line bulk
    replacement never matched them). The loading state used the new name and rendered fine; as soon as
    data arrived it took the ready branch, threw `ReferenceError`, and React unmounted the whole
    contribution — visible only as a flash, with no second report.

### Changed

- **The controls moved from a top-level Settings section onto the plugin's own card.** They now
  register into `plugins.bundle.config` (keyed by package name) instead of `settings.section`, and are
  drawn between the card's description and its "Included components" list. That is the seat the
  contract reserves for a bundle's own configuration, and it is also the more prominent position.

### Added

- `GET /rea-agents/diagnose`: reports whether the browser half reached the page's module graph and
  whether the Loader row passes the composer's per-row gate — the one question that cannot be answered
  offline.
- `test/render.mjs` now drives all three states: loading, ready and failed. The earlier version covered
  only loading, because the stub ran no effects, so `load()` never ran and the status never left
  loading — which is exactly how it stepped over the branch that crashed.
- A static check that every component referenced by `h(UppercaseIdentifier, …)` is defined in the file.
  It covers every call site at once, rather than only the states a test happens to reach.

## [1.0.0] - 2026-10-17

First release.

### Added

- Pins `rea-agents` to one exact version inside the active profile and starts the MCP server from that
  copy, so a harness start never fetches or executes a newly published release.
- A "REA version" section on the plugin's own card: install, check for a newer version, update,
  uninstall and refresh. State is read back from disk after every action, so the version shown is the
  copy the server will start.
- An update that lands on a release older than the registry's newest names pnpm's
  `minimumReleaseAge` policy as the cause, rather than presenting it as a success.
- When the optional `frida` dependency reports `ERR_PNPM_IGNORED_BUILDS`, the install is judged **by
  what is on disk** and the withheld build is reported as a milder fact of its own, not as a failure.
- A distinct `rea-agents-mcp` entry id, so a stale hand-written `rea-mcp` override in a profile cannot
  silently switch this plugin's MCP server off.
- All engines are yours to provide: the plugin installs no Ghidra, IDA, jadx, apktool, adb or any other
  analysis engine.

[1.0.6]: ../../compare/v1.0.5...v1.0.6
[1.0.5]: ../../compare/v1.0.4...v1.0.5
[1.0.4]: ../../compare/v1.0.3...v1.0.4
[1.0.3]: ../../compare/v1.0.2...v1.0.3
[1.0.2]: ../../compare/v1.0.1...v1.0.2
[1.0.1]: ../../compare/v1.0.0...v1.0.1
[1.0.0]: ../../releases/tag/v1.0.0
