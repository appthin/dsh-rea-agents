// Browser half of dsh-rea-agents: this plugin's own card on the Plugins page.
//
// Hand-written in the lazy-CJS bundle protocol (`window.__ModuleLoader__.load`
// with a factory returning cordis-plugin exports), so there is no build step.
// Everything it needs at runtime is already in the shell's frozen module table:
// React, plus the module loader itself.
//
// The section renders its own markup and CSS rather than depending on
// product-internal components, so it keeps working across harness versions
// that rearrange those components. The one stable contract it relies on is
// `plugins.bundle.config` — the Plugins page's declared seat for a bundle's own
// configuration, keyed by package name and drawn on that bundle's page between
// its description and its rows. The controls therefore sit on the
// dsh-rea-agents card, instead of occupying a top-level row in Settings next to
// account and model preferences.
//
// The seat is only drawn when the page's ledger finds this package's key among
// the registrations, so registering under the right key is what makes the
// section appear at all. The seat is also asked for a one-liner (`view:
// 'summary'`), which the controls decline: buttons belong on the page.
//
// This half holds no policy of its own. Whether a version counts as newer,
// how it gets installed, and what the profile ends up declaring are all decided
// by the host half, which owns the profile on disk. The section renders that
// state, collects the two intents a user has here (check, and move to a
// version), and reports exactly what happened.
window.__ModuleLoader__.load({
  id: 'dsh-rea-agents',
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    var react = require('react');
    var h = react.createElement;
    var useState = react.useState;
    var useEffect = react.useEffect;
    var useCallback = react.useCallback;

    /** Route prefix the host half publishes. */
    var API_PREFIX = '/rea-agents';

    /**
     * The dictionary, keyed for the two locales the harness ships. The page is
     * the only place a user learns that installing can land on an older
     * release than the newest one, so those sentences are worded as plainly as
     * possible rather than dressed up as a feature.
     */
    var DICT = {
      zh: {
        sectionTitle: 'REA 版本',
        langLabel: '语言：',
        langAuto: '跟随界面',
        loading: '正在读取…',
        loadFailedWith: '读取失败：{reason}',
        retry: '重试',
        refresh: '刷新',
        profile: '配置档',
        notInstalled: '尚未安装',
        notInstalledHint: '按「安装」，把这个插件所固定的版本装进当前配置档。',
        currentVersion: '当前版本',
        pinnedAt: '固定于',
        declared: '配置档声明',
        declaredMissing: '未在 package.json 中声明',
        nodeVersion: '当前 Node',
        install: '安装',
        installing: '安装中…',
        check: '检测最新版本',
        checking: '检测中…',
        update: '更新',
        updating: '更新中…',
        uninstall: '卸载REA',
        uninstalling: '卸载中…',
        uninstallConfirm: '确定卸载固定版本的 rea-agents？REA 工具将不再可用，直到你重新安装。',
        latest: '仓库最新',
        latestWith: '仓库最新：{version}',
        latestUnknown: '尚未检测',
        checkedAt: '检测于',
        upToDate: '已是最新',
        behind: '可更新',
        ahead: '比仓库最新还新',
        updateTo: '更新到 {version}',
        checkFailed: '检测失败',
        actionFailed: '操作失败',
        writableWarning: '当前配置档目录不可写，安装与更新会失败。请检查文件权限。',
        enginesWarning: '版本提示',
        supplyChainTitle: '关于「更新」可能装到较旧版本',
        supplyChainBody:
          'pnpm 的供应链安全策略（minimumReleaseAge）会拒绝自动安装发布时间未满规定时长的版本。因此按下「更新」时，实际装上的可能是 {resolved}，而不是仓库刚发布的 {wanted}。新发布的版本尚未度过观察期，可能存在未被发现的恶意代码或缺陷。这不是故障，而是该策略在起作用。',
        supplyChainGeneric:
          'pnpm 的供应链安全策略（minimumReleaseAge）会拒绝自动安装发布时间未满规定时长的版本。因此按下「更新」时，实际装上的版本可能比仓库最新版本旧。这不是故障，而是该策略在起作用。',
        landedOther:
          '本次安装的是 {installed}，而不是 {requested}。按 pnpm 供应链安全策略（minimumReleaseAge），{requested} 发布时间未满规定时长，未通过观察期，因此未被安装。',
        landedSame: '已完成：{installed}。',
        exemptedNote:
          '已更新到 {installed}。pnpm 在改动前会校验整个 lockfile，配置档里另有尚未度过观察期的条目（{exempted}），本次已单独豁免它们；这些条目本身没有被改动。',
        movedFrom: '已从 {from} 更新到 {to}。',
        movedFromUnconfirmed:
          '已从 {from} 更新到 {to}。请求的响应在送达前中断，此结论是回读磁盘上的实际版本得出的。',
        landedUnconfirmed: '已完成：{installed}。请求的响应在送达前中断，此结论是回读磁盘得出的。',
        engineNote: '引擎自备',
        engineBody:
          '本插件不安装任何分析引擎。原生反编译需要 Ghidra（或 IDA），APK 需要 jadx 与 apktool，真机需要 adb。缺哪个，对应工具会报 provider_unavailable 并点名要设的环境变量。',
        mcpNote: 'MCP 连接',
        mcpBody:
          'REA 以 MCP stdio 服务启动，工具名形如 mcp__rea__<工具名>。服务由本插件从配置档里已固定的那份副本启动，不走 PATH，也不联网。',
        footer: 'REA 由 morluto 开发，MIT 许可：github.com/morluto/rea。本插件仅管理其安装与版本。',
      },
      en: {
        sectionTitle: 'REA version',
        langLabel: 'Language:',
        langAuto: 'Follow interface',
        loading: 'Loading…',
        loadFailedWith: 'Could not load: {reason}',
        retry: 'Retry',
        refresh: 'Refresh',
        profile: 'Profile',
        notInstalled: 'Not installed',
        notInstalledHint: 'Press Install to add the version this plugin pins into the current profile.',
        currentVersion: 'Current version',
        pinnedAt: 'Pinned at',
        declared: 'Profile declares',
        declaredMissing: 'Not declared in package.json',
        nodeVersion: 'Node',
        install: 'Install',
        installing: 'Installing…',
        check: 'Check for newer version',
        checking: 'Checking…',
        update: 'Update',
        updating: 'Updating…',
        uninstall: 'Uninstall REA',
        uninstalling: 'Uninstalling…',
        uninstallConfirm: 'Uninstall the pinned rea-agents? REA tools stop working until you install again.',
        latest: 'Registry latest',
        latestWith: 'Registry latest: {version}',
        latestUnknown: 'Not checked yet',
        checkedAt: 'Checked at',
        upToDate: 'Up to date',
        behind: 'Update available',
        ahead: 'Newer than registry latest',
        updateTo: 'Update to {version}',
        checkFailed: 'Check failed',
        actionFailed: 'Action failed',
        writableWarning: 'This profile directory is not writable, so install and update will fail. Check file permissions.',
        enginesWarning: 'Version note',
        supplyChainTitle: 'Why an update may install an older release',
        supplyChainBody:
          'pnpm\'s supply-chain policy (minimumReleaseAge) refuses to install a version published more recently than the required age. Pressing Update may therefore install {resolved} rather than the {wanted} the registry just published. A newly published version has not completed that waiting period and may contain undetected malicious code or defects. This is the policy working, not a failure.',
        supplyChainGeneric:
          'pnpm\'s supply-chain policy (minimumReleaseAge) refuses to install a version published more recently than the required age, so pressing Update may install a version older than the registry latest. This is the policy working, not a failure.',
        landedOther:
          'This installation used {installed} rather than {requested}. Under pnpm\'s supply-chain policy (minimumReleaseAge), {requested} has not completed its waiting period, so it was not installed.',
        landedSame: 'Done: {installed}.',
        exemptedNote:
          'Updated to {installed}. pnpm verifies the whole lockfile before changing anything, and other entries in the profile had not finished their waiting period ({exempted}); those were exempted for this run only, and were not themselves changed.',
        movedFrom: 'Updated from {from} to {to}.',
        movedFromUnconfirmed:
          'Updated from {from} to {to}. The reply to the request was lost before it arrived; this was read back from the version on disk.',
        landedUnconfirmed:
          'Done: {installed}. The reply to the request was lost before it arrived; this was read back from disk.',
        engineNote: 'Engines are yours',
        engineBody:
          'This plugin installs no analysis engine. Native decompilation needs Ghidra (or IDA), APKs need jadx and apktool, and devices need adb. Whatever is missing, its tools report provider_unavailable and name the environment variable to set.',
        mcpNote: 'MCP connection',
        mcpBody:
          'REA runs as an MCP stdio server with tool names like mcp__rea__<tool>. The server starts from the copy pinned inside the profile — not from PATH, and not over the network.',
        footer: 'REA is by morluto, MIT licensed: github.com/morluto/rea. This plugin manages only its installation and version.',
      },
    };

    /**
     * The browser's own language, used whenever the shell cannot answer.
     *
     * Each tag matches on its primary subtag, the way DSH resolves an unknown
     * locale, so `zh-Hans` and `zh-TW` both land on Chinese and anything else
     * falls through to English — the shell's own `FALLBACK_LOCALE`. Returning a
     * fixed language here instead would ignore the machine the user is on.
     *
     * @returns `'zh'` or `'en'`.
     */
    function browserLocale() {
      try {
        var tags = [];
        if (typeof navigator !== 'undefined') {
          if (Array.isArray(navigator.languages)) tags = tags.concat(navigator.languages);
          if (typeof navigator.language === 'string') tags.push(navigator.language);
        }
        for (var i = 0; i < tags.length; i++) {
          var primary = String(tags[i] || '').slice(0, 2).toLowerCase();
          if (primary === 'zh') return 'zh';
          if (primary === 'en') return 'en';
        }
      } catch (error) {
        // A host without `navigator` falls through to the shell's fallback.
      }
      return 'en';
    }

    /**
     * Translate one key, interpolating `{name}` placeholders.
     *
     * An unrecognised locale resolves through {@link browserLocale} rather than
     * defaulting to one language, so a missing value cannot silently pin the
     * whole section.
     *
     * @param locale - `'zh'`, `'en'`, or anything else.
     * @returns a translate function.
     */
    function makeT(locale) {
      var id = locale === 'en' ? 'en' : locale === 'zh' ? 'zh' : browserLocale();
      var table = DICT[id];
      return function t(key, params) {
        var text = table[key] !== undefined ? table[key] : DICT.zh[key] !== undefined ? DICT.zh[key] : key;
        if (params === undefined) return text;
        return text.replace(/\{(\w+)\}/g, function (match, name) {
          return params[name] !== undefined ? String(params[name]) : match;
        });
      };
    }

    /** How the section decides its language. `auto` follows the interface. */
    var LANG_MODES = ['auto', 'zh', 'en'];

    /** Where a manual choice is remembered, so it survives a reload. */
    var LANG_KEY = 'dsh-rea-agents:lang';

    /**
     * The remembered preference, defaulting to `auto`.
     *
     * A store that refuses to be read only costs persistence: the section falls
     * back to following the interface, which is the sane place to land.
     *
     * @returns one of {@link LANG_MODES}.
     */
    function readLangPref() {
      try {
        var stored = window.localStorage.getItem(LANG_KEY);
        return typeof stored === 'string' && LANG_MODES.indexOf(stored) !== -1 ? stored : 'auto';
      } catch (error) {
        return 'auto';
      }
    }

    /** Remember a preference; a store that refuses only loses persistence. */
    function writeLangPref(mode) {
      try {
        window.localStorage.setItem(LANG_KEY, mode);
      } catch (error) {
        // The switch still applies for this session.
      }
    }

    /**
     * The shell's current language, and a way to hear about changes.
     *
     * The locale service is bound in {@link bindShellLocale} because that is
     * where the plugin context hands it over. Until then — and on a shell that
     * has no such service — the browser's language stands in, so the section
     * renders in the language of the machine rather than in a fixed one.
     */
    var shellLocale = {
      /** The active locale id, `'zh'` or `'en'`. */
      read: function () {
        return browserLocale();
      },
      /**
       * Hear about a language change.
       * @param listener - called with the new locale id.
       * @returns an unsubscribe function.
       */
      subscribe: function () {
        return function () {};
      },
    };

    /**
     * Bind the shell's locale service to {@link shellLocale}.
     *
     * The active language lives in the snapshot's `active` field. Reading any
     * other field yields `undefined`, which compares unequal to `'zh'` and so
     * silently pins the section to one language — that is a defect this code
     * shipped once, and centralising the read is what keeps it from coming back.
     *
     * @param locale - the locale service, or undefined when the shell has none.
     */
    function bindShellLocale(locale) {
      if (locale === undefined || locale === null) return;

      var listeners = [];

      /** The active locale id, never `undefined`. */
      var live = function () {
        try {
          var snapshot = locale.getLocale();
          var tag = snapshot !== undefined && typeof snapshot.active === 'string' ? snapshot.active : '';
          return tag === '' ? browserLocale() : toLocaleId(tag);
        } catch (error) {
          return browserLocale();
        }
      };

      shellLocale.read = live;
      shellLocale.subscribe = function (listener) {
        listeners.push(listener);
        return function () {
          var at = listeners.indexOf(listener);
          if (at !== -1) listeners.splice(at, 1);
        };
      };

      if (typeof locale.subscribe === 'function') {
        try {
          locale.subscribe(function () {
            var next = live();
            for (var i = 0; i < listeners.length; i++) {
              try {
                listeners[i](next);
              } catch (error) {
                // One bad listener must not strand the others.
                console.error('[dsh-rea-agents] locale listener failed:', error);
              }
            }
          });
        } catch (error) {
          console.warn('[dsh-rea-agents] locale mirror skipped:', error);
        }
      }
    }

    /** The shells's language tag, narrowed to one of the two dictionaries. */
    function toLocaleId(tag) {
      return typeof tag === 'string' && tag.slice(0, 2).toLowerCase() === 'zh' ? 'zh' : 'en';
    }

    /**
     * The translator for one already-resolved language.
     *
     * Nothing here depends on the component's props. An earlier version trusted
     * a framework-supplied `t` on the theory that the render machinery would
     * re-derive it on a locale switch; in practice the section came out English
     * under a Chinese interface, because that seat was never populated for this
     * slot. The language is now resolved by this half and drives its own
     * re-render, so what is drawn and what is asked for cannot disagree.
     *
     * @param localeId - `'zh'` or `'en'`.
     * @returns a translate function.
     */
    function translatorFor(localeId) {
      return makeT(toLocaleId(localeId));
    }

    /** Issue one request to the host half and parse its JSON answer. */
    function callHost(route, method, body) {
      return fetch(API_PREFIX + '/' + route, {
        method: method,
        headers: body === undefined ? undefined : { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      }).then(function (response) {
        return response.json().then(function (payload) {
          if (!response.ok) throw new Error(payload && payload.reason ? payload.reason : 'HTTP ' + response.status);
          return payload;
        });
      });
    }

    /**
     * GET one read-only route.
     *
     * Reads and actions are separate functions rather than one that infers the
     * method from whether a body was passed. That inference was a real bug: the
     * actions that take no arguments — checking the registry, and removing the
     * pin — were sent as GETs to routes that only accept POST, and the host
     * answered 404 for a route it does handle. Naming the method at each call
     * site removes the guess entirely.
     */
    function apiGet(route) {
      return callHost(route, 'GET', undefined);
    }

    /** POST one action route. An empty body is sent as `{}` so the request stays a well-formed JSON POST. */
    function apiPost(route, body) {
      return callHost(route, 'POST', body === undefined ? {} : body);
    }

    /**
     * Compare two dotted versions, ignoring any prerelease suffix so a
     * `-beta` build never claims to be newer than the release beside it.
     * Returns 0 when either side is unparsable, which the caller renders as
     * "cannot tell" rather than guessing.
     */
    function compareVersions(left, right) {
      if (typeof left !== 'string' || typeof right !== 'string') return 0;
      var a = left.split('-')[0].split('.').map(Number);
      var b = right.split('-')[0].split('.').map(Number);
      if (a.some(isNaN) || b.some(isNaN)) return 0;
      for (var i = 0; i < Math.max(a.length, b.length); i += 1) {
        var x = a[i] === undefined ? 0 : a[i];
        var y = b[i] === undefined ? 0 : b[i];
        if (x !== y) return x > y ? 1 : -1;
      }
      return 0;
    }

    var CSS =
      '.rea-section{display:flex;flex-direction:column;gap:12px;padding-top:4px}' +
      '.rea-head{display:flex;align-items:center;justify-content:space-between;gap:10px}' +
      '.rea-section-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary);margin:0}' +
      '.rea-lang{display:inline-flex;align-items:center;gap:4px;flex:none;color:var(--dsw-alias-label-secondary);cursor:pointer;font-size:12px}' +
      '.rea-lang-text{white-space:nowrap}' +
      '.rea-lang select{border:none;background:transparent;color:inherit;font:inherit;font-size:12px;height:26px;padding:0 2px;outline:none;cursor:pointer}' +
      '.rea-lang select option{color:var(--dsw-alias-label-primary);background:var(--dsw-alias-bg-base)}' +
      '.rea-actions{display:flex;flex-direction:column;gap:10px}' +
      '.rea-row{display:flex;align-items:center;gap:8px;flex-wrap:wrap}' +
      '.rea-desc{font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary);margin:0}' +
      '.rea-label{font-size:11px;color:var(--dsw-alias-label-secondary);margin:0}' +
      '.rea-value{font-size:12px;color:var(--dsw-alias-label-primary);margin:2px 0 0;font-variant-numeric:tabular-nums}' +
      '.rea-mono{font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;word-break:break-all}' +
      '.rea-btn{display:inline-flex;align-items:center;justify-content:center;height:28px;padding:0 11px;border-radius:7px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font-size:12px;cursor:pointer;white-space:nowrap}' +
      '.rea-btn:hover:not(:disabled){border-color:var(--dsw-alias-border-l2)}' +
      '.rea-btn:disabled{opacity:.55;cursor:default}' +
      '.rea-btn-primary{background:var(--dsw-alias-bg-accent,var(--dsw-alias-bg-layer-1));border-color:var(--dsw-alias-border-l2);font-weight:500}' +
      '.rea-tag{display:inline-flex;align-items:center;height:20px;padding:0 8px;border-radius:6px;font-size:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base)}' +
      '.rea-tag-ok{color:var(--dsw-alias-label-success,#1a7f37)}' +
      '.rea-tag-info{color:var(--dsw-alias-label-accent,#0969da)}' +
      '.rea-tag-warn{color:var(--dsw-alias-label-warning,#9a6700)}' +
      '.rea-note{padding:9px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-size:12px;line-height:18px;color:var(--dsw-alias-label-secondary)}' +
      '.rea-note-title{font-weight:600;color:var(--dsw-alias-label-primary);margin:0 0 4px;font-size:12px}' +
      '.rea-note p{margin:0}' +
      '.rea-warn{border-color:var(--dsw-alias-border-l2)}' +
      '.rea-log{padding:9px 11px;border-radius:8px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-base);font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;font-size:11px;line-height:16px;white-space:pre-wrap;word-break:break-word;max-height:200px;overflow:auto;color:var(--dsw-alias-label-secondary)}' +
      '.rea-facts{display:grid;grid-template-columns:repeat(auto-fit,minmax(140px,1fr));gap:10px}' +
      '.rea-empty{font-size:12px;color:var(--dsw-alias-label-secondary);margin:0}' +
      '.rea-fineprint{font-size:11px;line-height:16px;color:var(--dsw-alias-label-secondary);margin:0;opacity:.85}';

    /** Inject the page's stylesheet once, keyed by a stable id. */
    function useStyles() {
      useEffect(function () {
        var id = 'dsh-rea-agents-styles';
        if (document.getElementById(id) !== null) return;
        var style = document.createElement('style');
        style.id = id;
        style.textContent = CSS;
        document.head.appendChild(style);
      }, []);
    }

    /** One labelled fact in the summary grid. */
    function Fact(props) {
      return h(
        'div',
        null,
        h('p', { className: 'rea-label' }, props.label),
        h('p', { className: 'rea-value' + (props.mono ? ' rea-mono' : '') }, props.value),
      );
    }

    /** A titled explanatory note. */
    function Note(props) {
      return h(
        'div',
        { className: 'rea-note' + (props.warn ? ' rea-warn' : '') },
        props.title === undefined ? null : h('p', { className: 'rea-note-title' }, props.title),
        h('p', null, props.children),
      );
    }

    /**
     * Section chrome for the contribution: a small heading plus body, sized to
     * sit under the plugin card's own content rather than replacing its title.
     * The card already draws the plugin's name, description and switch; the
     * section adds only what the card cannot know — the pinned version and the
     * actions that move it.
     *
     * `t` is handed in already bound to the language the caller resolved, rather
     * than derived here. Deriving it here is what silently pinned the heading to
     * Chinese: every call site passed no language of its own, so the default
     * branch won on every render.
     *
     * @param props - `t`, the bound translator, the language control, and the
     * section's children.
     */
    function Chrome(props) {
      var t = props.t;
      return h(
        'div',
        { className: 'rea-section' },
        h(
          'div',
          { className: 'rea-head' },
          h('p', { className: 'rea-section-title' }, t('sectionTitle')),
          props.lang === undefined ? null : props.lang,
        ),
        props.children,
      );
    }

    /**
     * The manual language choice, with the label the control needs to be
     * readable on its own.
     *
     * `auto` follows the interface and is the default, so a user who never
     * touches this gets the language the rest of the shell speaks. Picking a
     * language pins the section regardless of the shell, and the choice is
     * remembered across reloads. This exists because the section is not always
     * read in the language of the interface around it: a user may run a Chinese
     * shell for their own comfort while sharing screenshots in English, or the
     * reverse.
     *
     * @param props - `pref` (the current mode), `onChange`, and `t`.
     */
    function LangPicker(props) {
      var t = props.t;
      return h(
        'label',
        { className: 'rea-lang', title: t('langLabel') },
        h('span', { className: 'rea-lang-text' }, t('langLabel')),
        h(
          'select',
          {
            value: props.pref,
            'aria-label': t('langLabel'),
            onChange: function (event) {
              props.onChange(event.target.value);
            },
          },
          h('option', { value: 'auto' }, t('langAuto')),
          // A language names itself in its own language, so these two are the
          // same in both dictionaries by design and are not translated.
          h('option', { value: 'zh' }, '\u4e2d\u6587'),
          h('option', { value: 'en' }, 'English'),
        ),
      );
    }

    /**
     * The controls. Host state is the single source of truth; every action
     * re-reads it from the response so the version shown is the version on
     * disk, never a value this half predicted.
     */
    function ReaSection(props) {
      useStyles();

      // The manual choice and the shell's own language are both component
      // state, and the pair of them is what re-renders this section.
      //
      // The shell's language has to be tracked here rather than taken from a
      // prop. The section is rendered for a slot this half owns, and that seat
      // does not arrive carrying a translator — the earlier version assumed it
      // did, which is why "Follow interface" produced English under a Chinese
      // interface. Owning the state removes the assumption: a language the
      // section cannot observe is a language it cannot show.
      var prefState = useState(readLangPref);
      var pref = prefState[0];
      var setPref = prefState[1];
      var shellState = useState(shellLocale);
      var shell = shellState[0];
      var setShell = shellState[1];

      useEffect(function () {
        if (typeof shellLocale.subscribe !== 'function') return undefined;
        setShell(shellLocale.read());
        return shellLocale.subscribe(function (next) {
          setShell(next);
        });
      }, []);

      // `auto` follows the shell; a pinned mode overrides it.
      var localeId = pref === 'auto' ? shell : pref;
      var t = translatorFor(localeId);
      var lang = h(LangPicker, {
        pref: pref,
        t: t,
        onChange: function (mode) {
          writeLangPref(mode);
          setPref(mode);
        },
      });

      var state = useState({ status: 'loading' });
      var snapshot = state[0];
      var setSnapshot = state[1];
      var busyState = useState(null);
      var busy = busyState[0];
      var setBusy = busyState[1];

      var noticeState = useState(null);
      var notice = noticeState[0];
      var setNotice = noticeState[1];

      var logState = useState(null);
      var log = logState[0];
      var setLog = logState[1];

      var load = useCallback(function () {
        return apiGet('state').then(function (payload) {
          setSnapshot({ status: 'ready', data: payload });
          // Handed back so a caller can report what the disk actually says
          // rather than what a reply claimed.
          return payload;
        }).catch(function (error) {
          setSnapshot({ status: 'failed', error: String(error && error.message ? error.message : error) });
          return undefined;
        });
      }, []);

      useEffect(function () {
        load();
      }, [load]);

      /**
       * Run one action, then re-read the truth from disk and report the outcome.
       *
       * The refresh is a separate read rather than a reuse of whatever the
       * action replied with, and that is deliberate. An action that installs a
       * version can take a minute, and its reply is one message that can be lost
       * — a dropped response, a reloaded page, a request the shell gave up on.
       * When the card trusted that reply alone, the install succeeded on disk
       * while the page kept showing the old version until the user refreshed it
       * by hand: the work was done and the page disagreed.
       *
       * `load()` asks `/state`, which reads the installed manifest from disk
       * every time, so the card shows the version the MCP server will actually
       * start. The action's own reply is still used where it carries something
       * disk cannot answer — the log, and the reason for a refusal.
       *
       * The notice is set after the refresh so nothing clears it afterwards.
       */
      var act = useCallback(function (name, request) {
        setBusy(name);
        setNotice(null);
        setLog(null);
        return request().then(function (payload) {
          if (payload && payload.log !== undefined) setLog(payload.log);
          return load().then(function (fresh) {
            if (payload && payload.ok === false) {
              setNotice({ kind: 'error', text: (payload.reason || t('actionFailed')) });
              return undefined;
            }
            // The refreshed state replaces whatever the reply carried, so every
            // caller reports from the disk.
            return { ...(payload === undefined ? {} : payload), state: fresh };
          });
        }).catch(function (error) {
          // A lost response must not leave the card stale either: the action may
          // well have completed on disk, and the refresh is what shows it. The
          // caller is handed the refreshed state so it can tell the difference
          // between "it failed" and "it worked, and the answer never came back".
          return load().then(function (fresh) {
            setNotice({ kind: 'error', text: (error && error.message) ? error.message : t('actionFailed') });
            return { transportLost: true, state: fresh };
          });
        }).finally(function () {
          setBusy(null);
        });
      }, [load, t]);

      if (snapshot.status === 'loading') {
        return h(Chrome, { t: t, lang: lang }, h('p', { className: 'rea-desc' }, t('loading')));
      }
      if (snapshot.status === 'failed') {
        return h(
          Chrome,
          { t: t, lang: lang },
          h('p', { className: 'rea-desc' }, t('loadFailedWith', { reason: snapshot.error })),
          h('button', { type: 'button', className: 'rea-btn', onClick: load }, t('retry')),
        );
      }

      var data = snapshot.data;
      var installed = data.installed;
      var current = installed === null ? null : installed.version;
      var latest = data.latestKnown;
      var relation = current === null || latest === null ? 'unknown' : compareVersions(current, latest);

      /** The install is behind a version the registry reported. */
      var canUpdate = installed !== null && latest !== null && relation < 0;
      var anyBusy = busy !== null;

      /**
       * Install whatever the registry currently offers.
       *
       * A first install has no prior version to compare against, so it asks
       * the registry once and installs that exact string. Asking for a version
       * (rather than letting pnpm resolve a range) keeps the intent explicit
       * all the way down: what the page asked for is what the log shows.
       */
      var onInstall = function () {
        act('install', function () {
          return apiPost('check').then(function (check) {
            if (check.ok !== true) throw new Error(check.reason || t('checkFailed'));
            return apiPost('install', { version: check.latest });
          });
        }).then(function (result) {
          if (result === undefined || (result.transportLost !== true && result.ok !== true)) return;
          var landed = result.state && result.state.installed ? result.state.installed.version : null;
          if (landed === null) return;
          setNotice(
            result.transportLost === true
              ? { kind: 'warn', text: t('landedUnconfirmed', { installed: landed }) }
              : { kind: 'ok', text: t('landedSame', { installed: landed }) },
          );
        });
      };

      var onCheck = function () {
        setBusy('check');
        setNotice(null);
        setLog(null);
        apiPost('check').then(function (payload) {
          if (payload.state !== undefined) setSnapshot({ status: 'ready', data: payload.state });
          if (payload.ok !== true) {
            setNotice({ kind: 'error', text: (payload.reason || t('checkFailed')) });
            if (payload.log) setLog(payload.log);
            return;
          }
          setNotice({ kind: 'ok', text: t('latestWith', { version: payload.latest }) });
        }).catch(function (error) {
          setNotice({ kind: 'error', text: (error && error.message) ? error.message : t('checkFailed') });
        }).finally(function () {
          setBusy(null);
        });
      };

      var onUpdate = function () {
        if (latest === null) return;
        var from = current;
        act('update', function () { return apiPost('update', { version: latest }); }).then(function (result) {
          if (result === undefined) return;
          var landed = result.state && result.state.installed ? result.state.installed.version : null;
          if (landed === null) return;

          // The reply never arrived. The refresh still says what the disk holds,
          // so a version that moved really did move — reporting only the failed
          // request would deny work that actually finished.
          if (result.transportLost === true) {
            if (from !== null && landed !== from) {
              setNotice({ kind: 'warn', text: t('movedFromUnconfirmed', { from: from, to: landed }) });
            }
            return;
          }
          if (result.ok !== true) return;

          // The honest sentence: a supply-chain hold means the version the
          // user asked for is NOT the version that landed, and saying only
          // "done" would be a lie by omission.
          if (landed !== latest) {
            setNotice({
              kind: 'warn',
              text: t('landedOther', { installed: landed, requested: latest }),
            });
            return;
          }
          // The update may have needed a workaround: pnpm refuses every change
          // while any unrelated lockfile entry is still inside its waiting
          // period, and the host re-runs once, exempting just those entries. A
          // run that needed that is not an ordinary one, so it is said out loud
          // rather than presented as a clean install.
          var exempted = result.exempted;
          if (Array.isArray(exempted) && exempted.length > 0) {
            setNotice({
              kind: 'warn',
              text: t('exemptedNote', {
                installed: landed,
                exempted: exempted.join(', '),
              }),
            });
            return;
          }
          setNotice({ kind: 'ok', text: from === null ? t('landedSame', { installed: landed }) : t('movedFrom', { from: from, to: landed }) });
        });
      };

      var onUninstall = function () {
        if (!window.confirm(t('uninstallConfirm'))) return;
        act('uninstall', function () { return apiPost('unpin'); });
      };

      var versionTag = function () {
        if (current === null) return h('span', { className: 'rea-tag' }, t('notInstalled'));
        if (latest === null) return h('span', { className: 'rea-tag' }, t('latestUnknown'));
        if (relation < 0) return h('span', { className: 'rea-tag rea-tag-info' }, t('behind'));
        if (relation > 0) return h('span', { className: 'rea-tag rea-tag-warn' }, t('ahead'));
        return h('span', { className: 'rea-tag rea-tag-ok' }, t('upToDate'));
      };

      return h(
        Chrome,
        { t: t, lang: lang },
        h('div', { className: 'rea-actions' },
          h('div', { className: 'rea-row' }, versionTag()),
          h('div', { className: 'rea-row' },
            installed === null
              ? h('button', { type: 'button', className: 'rea-btn rea-btn-primary', disabled: anyBusy, onClick: onInstall },
                  busy === 'install' ? t('installing') : t('install'))
              : null,
            canUpdate
              ? h('button', { type: 'button', className: 'rea-btn rea-btn-primary', disabled: anyBusy, onClick: onUpdate },
                  busy === 'update' ? t('updating') : t('updateTo', { version: latest }))
              : null,
            h('button', { type: 'button', className: 'rea-btn', disabled: anyBusy, onClick: onCheck },
              busy === 'check' ? t('checking') : t('check')),
            h('button', { type: 'button', className: 'rea-btn', disabled: anyBusy, onClick: load }, t('refresh')),
            installed !== null
              ? h('button', { type: 'button', className: 'rea-btn', disabled: anyBusy, onClick: onUninstall },
                  busy === 'uninstall' ? t('uninstalling') : t('uninstall'))
              : null,
          ),
        ),

        h('div', { className: 'rea-facts' },
          h(Fact, { label: t('currentVersion'), value: current === null ? t('notInstalled') : current }),
          h(Fact, { label: t('latest'), value: latest === null ? t('latestUnknown') : latest }),
          h(Fact, { label: t('declared'), value: data.declared === null ? t('declaredMissing') : data.declared }),
          h(Fact, { label: t('nodeVersion'), value: data.nodeVersion }),
        ),

        installed === null ? h('p', { className: 'rea-empty' }, t('notInstalledHint')) : null,

        notice === null ? null : h(
          'div',
          { className: 'rea-note' + (notice.kind === 'error' || notice.kind === 'warn' ? ' rea-warn' : ''), role: 'status' },
          h('p', null, notice.text),
        ),

        data.writable === false ? h(Note, { warn: true }, t('writableWarning')) : null,
        data.enginesWarning === null || data.enginesWarning === undefined
          ? null
          : h(Note, { title: t('enginesWarning'), warn: true }, data.enginesWarning),
        log === null ? null : h('div', { className: 'rea-log' }, log),

        h('div', { className: 'rea-facts' },
          h(Fact, { label: t('profile'), value: data.profileDir, mono: true }),
          installed === null || installed.pinnedAt === null ? null : h(Fact, { label: t('pinnedAt'), value: installed.pinnedAt }),
          data.checkedAt === null || data.checkedAt === undefined ? null : h(Fact, { label: t('checkedAt'), value: data.checkedAt }),
        ),

        // The supply-chain explanation is stated before an update is pressed,
        // not only after one lands somewhere unexpected.
        h(Note, { title: t('supplyChainTitle') },
          canUpdate
            ? t('supplyChainBody', { wanted: latest, resolved: current })
            : t('supplyChainGeneric')),

        h(Note, { title: t('engineNote') }, t('engineBody')),
        h(Note, { title: t('mcpNote') }, t('mcpBody')),
        h('p', { className: 'rea-fineprint' }, t('footer')),
      );
    }

    var NS = 'dsh-rea-agents';

    /** npm package name this plugin ships under; the detail slot filters on it. */
    var PACKAGE_NAME = 'dsh-rea-agents';

    /** Required service: the slot ledger the section registers into. */
    var inject = ['slots'];

    /**
     * Register this plugin's controls on its own card in the plugin manager.
     *
     * The controls live in `plugins.bundle.config`, the Plugins page's seat for
     * a bundle's own configuration, rather than in a top-level Settings
     * section. REA is a plugin, and its version, install state and update
     * action belong on the plugin's own page, not as a peer of account and
     * model settings.
     *
     * The seat is keyed by package name, and the page draws it only when its
     * ledger finds that key among the registrations — so the key is what makes
     * the section appear, not just what labels it.
     *
     * @param ctx - the browser plugin context.
     */
    function apply(ctx) {
      var slots = ctx.slots;
      if (slots === undefined) {
        throw new Error('[dsh-rea-agents] the slots service is unavailable, so the plugin card cannot be registered');
      }
      // The locale service is read through `ctx.get` rather than injected:
      // every string has an English spelling, so a deployment without the
      // service still renders correctly instead of failing to mount. A
      // registration failure stays loud for `slots`, which has no fallback —
      // controls that silently never appear are the one failure mode this half
      // must not have.
      var locale = ctx.get('locale');

      // Bind the shell's language so the section can follow it, and publish this
      // half's copy as a dictionary namespace.
      //
      // The binding is what makes "Follow interface" mean anything: the section
      // reads the language itself and re-renders on a change, instead of
      // expecting a translator to arrive in its props. It does not — that was
      // tried, and the section rendered English under a Chinese interface.
      if (locale !== undefined && locale !== null) {
        bindShellLocale(locale);
      }

      // Registering the dictionary keeps this half's copy available to the
      // shell's own machinery and lets anything else resolve these keys. It is
      // not the mechanism that draws the section, though: the section owns its
      // language, so a registration failure must not take the controls with it.
      if (locale !== undefined && typeof locale.register === 'function') {
        try {
          ctx.effect(function () {
            return locale.register(NS, { zh: DICT.zh, en: DICT.en });
          }, 'dsh-rea-agents: dictionaries');
        } catch (error) {
          console.warn('[dsh-rea-agents] dictionary registration skipped:', error);
        }
      }

      ctx.effect(function () {
        return slots.inject('plugins.bundle.config', function () {
          // `plugins.bundle.config` is the Plugins page's seat for *a bundle's
          // own configuration*, keyed by the package name and drawn on that
          // bundle's page between its description and its rows. The page
          // decides whether to draw it from a ledger of registered keys, so
          // registering is what makes the section appear at all.
          return slots.register(
            {
              name: 'plugins.bundle.config',
              key: PACKAGE_NAME,
              // Declaring the namespace puts the framework-synthesized `t` seat
              // into the component's props, bound to the active locale and
              // re-derived whenever it changes.
              locale: NS,
            },
            function BundleConfig(props) {
              // This seat is rendered for `summary` too, where a one-liner is
              // expected. The controls are only meaningful as a page.
              if (props.view !== 'page') return null;
              // No translator is threaded down: the section resolves its own
              // language and re-renders when that changes.
              return h(ReaSection, null);
            },
          );
        });
      }, 'dsh-rea-agents: bundle configuration');
    }

    exports.name = NS;
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  },
});
