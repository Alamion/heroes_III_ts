# Research: Platform Adapters

Decisions for [plan.md](plan.md). Sources: host documentation and host source code read on
2026-09-17 (Wallpaper Engine docs mirrored in `context/wallpaper_dev_wiki/`, Lively
`rocksdanister/lively` source and wiki, libplasma / plasma-workspace / kpackage / Qt WebEngine docs,
three existing Plasma 6 web wallpapers), and the current code (`src/runtime`, `tools/checks`).
Items marked **Spike** (KDE, on Linux) are measured before dependent code is finished; Wallpaper Engine and
Lively facts marked "Windows question" are verified in the follow-up Windows session. Results go to "Measurements".

## Host facts

### Wallpaper Engine (WE)

- The page is opened from the wallpaper folder as `file:///…/index.html` in WE's CEF.
- `window.wallpaperPropertyListener` must be assigned by a top-level classic script, otherwise the
  first `applyUserProperties` call (all properties) can be missed. Later calls carry only changed keys;
  each value is `{ value }`. A file property value is a raw local Windows path without scheme (cleared
  → `""`). `applyGeneralProperties({ fps })` gives the user's frame limit (0 = none); `setPaused(bool)`
  is sent, and WE may also freeze the process.
- `fetch('file:///…')` is reported to fail ("URL scheme 'file' is not supported"); a WE developer
  states `XMLHttpRequest` reads local files without extra flags. (Windows question WE-1)
- Module scripts and `new Worker(url)` from a `file://` page are blocked by Chromium's opaque origin
  unless the host passes `--allow-file-access-from-files`. Windows question WE-3.
- Browser storage lives in a CEF profile shared by all web wallpapers (one `file://` origin), may be
  wiped when the CEF cache is reset, and is separate per monitor. IndexedDB is not documented. The cache
  is therefore best-effort; files are always re-read from their paths. Windows question WE-5.
- `project.json`: `file`, `type: "web"`, `title`, `preview`, `general.properties` (types `file`,
  `combo`, `slider`, `bool`, `textinput`; `condition` strings such as `"viewmode.value == 2"`), and
  `general.localization` keyed by locale (`en-us`, `ru-ru`) mapping `ui_*` tokens. `fileType` must not be
  set (it restricts selection to images/videos). Property keys: English letters and digits only.
- The page gets no documented language value; `applyGeneralProperties` keys are checked in Windows question WE-6;
  fallback `navigator.language`.
- Debugging: WE Settings → General → "CEF devtools port" exposes DevTools on localhost; WE has a command
  line (`wallpaper64.exe -control openWallpaper -file …\project.json`, `-control pause|play`).

### Lively Wallpaper

- `LivelyInfo.json` at the zip root: `AppVersion, Title, Desc, Author, License, Contact, Type, FileName,
  Arguments, IsAbsolutePath, Thumbnail, Preview`. `Type` 1 = web. `Arguments: "--pause-event true"`
  enables `livelyWallpaperPlaybackChanged(jsonString)` with `{ IsPaused }`. Unknown `Arguments` make the
  player exit, so Chromium flags cannot be added.
- The page is served from the wallpaper folder over `https://<hash>.localhost/` (WebView2 virtual host
  mapping): relative `fetch` works, module scripts and module workers work, and the origin (and its
  IndexedDB) is stable while the folder does not move. Storage is persistent under `%LOCALAPPDATA%`.
- `LivelyProperties.json`: `slider {min,max,step,value}`, `dropdown {items[],value index}`,
  `checkbox`, `folderDropdown {folder, filter "*.lod", value}`, `label`, `button`. Values arrive via a
  global `livelyPropertyListener(name, value)`, once per control after page load and on change.
  `folderDropdown` "Browse" **copies** the chosen file into `<wallpaper>/<folder>/`; the value sent is
  `folder\file` with a backslash, or `null`. `LivelyProperties.loc.json` localises `text`, `help`,
  `items` per language (`ru` matches `ru-RU`).
- Input: mouse forwarded by default, keyboard opt-in. CLI: `Lively.exe setwp --file`, `setprop`.
  Debug mode opens DevTools; WebView2 also honours `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS`.

### KDE Plasma 6

- Installed on the development machine: plasmashell 6.7.5, Qt WebEngine / WebChannel 6.10.3,
  kf6-kpackage 6.30, `kpackagetool6`, `plasmawindowed` (applets only; no wallpaper viewer).
- Package: `metadata.json` (`KPackageStructure: "Plasma/Wallpaper"`, `X-Plasma-API-Minimum-Version:
  "6.0"`, reverse-domain `KPlugin.Id`), `contents/ui/main.qml` (root `WallpaperItem`, config via
  `root.configuration`), `contents/config/main.xml` (kcfg), `contents/ui/config.qml` (`cfg_*` bindings,
  `QtQuick.Dialogs.FileDialog`). `kpackagetool6 -t Plasma/Wallpaper -i <archive> -p <root>` validates by
  installing into a temporary root. Store archive: `.tar.gz`.
- `WebEngineView` works inside plasmashell (it sets `AA_ShareOpenGLContexts`). The lock-screen greeter
  does not, so a web view there may render black → the plugin shows a plain dark background on the lock
  screen (detected by `Plasmoid.activity` being undefined).
- A `file://` page with `localContentCanAccessFileUrls: true` (default) may read `file://` URLs with
  `XMLHttpRequest`; `fetch` of `file:` is unsupported. Module scripts/workers from `file://` are
  uncertain → same classic build as WE (R3).
- Default QML profile is off-the-record (IndexedDB lost on restart). A persistent
  `WebEngineProfile { storageName; offTheRecord: false }` must be one object per process: two profiles
  with the same storage name corrupt the store. One profile object is shared through a package QML
  singleton (the QML engine is global to plasmashell) — **Spike S3**.
- Visibility: `WallpaperItem` exposes nothing. Established patterns: `org.kde.taskmanager` `TasksModel`
  filtered by screen for maximised/fullscreen windows; DBus `org.freedesktop.ScreenSaver.ActiveChanged`
  for lock. DPMS has no API (not handled; the compositor stops presenting anyway).
- Translations: package `.mo` loading works from Plasma 6.5.6; to avoid gettext tooling the generated
  config UI picks strings from a generated JS table by `Qt.uiLanguage` (R9).
- Real-session driving: `qdbus org.kde.plasmashell /PlasmaShell evaluateScript` can set a desktop's
  `wallpaperPlugin` and config; `QTWEBENGINE_REMOTE_DEBUGGING=<port>` in plasmashell's environment
  exposes CDP.

## Decisions

### R1. One host-neutral wallpaper controller, thin per-host bridges

- **Decision**: `src/adapters/shared/` holds everything common: settings definition, strings, file-kind
  detection, file reading by URL, overlay (placeholder and messages), view placement, settings
  application with coalescing, and the `WallpaperController` that owns the engine. Each host folder
  (`web`, `wallpaper-engine`, `lively`, `kde`) only translates host signals into controller calls
  ([contracts/host-bridge.md](contracts/host-bridge.md)).
- **Rationale**: Principle V (thin adapters); one place to test behaviour (FR-003–FR-010); host checks
  only need to verify the translation.
- **Alternatives**: one adapter per host with its own logic — duplicated behaviour and four times the
  checks.

### R2. Engine additions are generic, not host-specific

- **Decision**: `EngineOptions.workerFactory` (who creates the decode worker), `setUserScale(1|2|3)`,
  `placeView(placement)`, `forgetCache()`, `setFrameLimit(fps)`, and a load generation guard so a newer
  `loadMap/loadArchive` call wins over an older one still in flight. View placement math is a pure
  function in `src/core/render/view-placement.ts` using the seeded RNG from `core/util`.
- **Rationale**: the camera already carries `scale` through shaders and clamping (only `resize` pins it
  to DPR); the worker is created with `import.meta.url`, which classic builds do not have; rapid host
  setting events need last-wins loads (edge case "many changes in a row").
- **Alternatives**: scale by CSS-stretching the canvas — breaks the surface budget rule and smooths
  pixels unless `image-rendering` behaves the same in all hosts.

### R3. Two build flavours: ESM for web, classic for file-based hosts

- **Decision**: `web` (GitHub Pages, served over https) keeps the current ESM build with a module worker.
  `host` flavour (WE, KDE, and Lively for uniformity) is a single classic IIFE script plus the worker
  embedded as a string and started from a `Blob` URL. The page's first classic `<script>` assigns the
  host listeners synchronously and queues events until the controller starts.
- **Rationale**: `file://` pages cannot load module scripts or `new Worker('x.js')` without
  `--allow-file-access-from-files`, which WE users would have to add by hand and Lively forbids. A Blob
  worker is same-origin by construction. Lively could use ESM, but one host build means one set of host
  checks and one size figure.
- **Alternatives**: decode on the main thread in hosts (`useWorker: false`) — violates Principle IV;
  a local HTTP server — needs a native helper, not possible in WE/Lively/KDE packages.
- **Cost**: the embedded worker is counted in the runtime budget (≤ 100 KB gz per package; today 46 KB
  total).

### R4. Reading user files

- **Decision**: `readUserFile(url)` uses `XMLHttpRequest` with `responseType = 'arraybuffer'` for
  `file:` URLs and `fetch` otherwise; the result becomes a `Blob` given to the engine. Host paths are
  normalised: backslashes → `/`, each segment `encodeURIComponent`-encoded, drive letter kept
  (`file:///C:/…`), Lively values made relative to the page. Missing file (status 0 with empty body,
  404, network error) → `FILE_MISSING` message.
- **Warm-start note** (h3lwp, `context/heroes_iii_android`, studied only): it copies the LOD into app storage once
  at setup, decodes only the sprites the chosen maps need, keeps no decoded cache, and rebuilds its atlas
  when the wallpaper process starts; showing/hiding only pauses rendering. Start cost is paid rarely
  (process start, map change), not on every show. The same holds here: host pause and visibility never
  reload; the file re-read happens only on page start (login, host restart) and file setting changes.
- **Rationale**: the only reading path known to work in WE and QtWebEngine; handles spaces and Cyrillic
  (edge cases).
- **Alternatives**: streaming range reads — `file://` XHR has no ranges; whole reads of ~50 MB from a
  local disk are expected to take < 0.5 s (Windows question WE-1 measures, SC-002).

### R5. File identity and stale data

- **Decision**: keep engine identities (map: SHA-256 of the whole file; archives: size + LOD header +
  index). Files read by URL have no `lastModified`; that is acceptable because any changed LOD entry
  changes the index offsets/sizes. Hosts re-read files on every start and on every changed setting.
- **Rationale**: FR-007 "changed file never served stale" holds without host metadata.
- **Alternatives**: host modification times — not available in WE/Lively values.

### R6. File kind detection by content

- **Decision**: `classifyFile(blob)` in `src/runtime/file-kind.ts` (bounded work, allowed on the main thread:
  LOD header + index via `blob.slice`, at most the first 64 KB of a map inflated through a
  `DecompressionStream` reader that is cancelled early): `LOD\0` magic → open the index →
  data archive if it has `Objects.txt`, `artraits.txt`, `game.pal`; sprite archive if it has the terrain
  DEFs; else `unknown-archive`. gzip magic or a raw H3M version code → read the version (inflating only
  the first bytes) → `map` (RoE/AB/SoD), `unsupported-map` (HotA, WoG, Chronicles), else `unknown`.
- **Rationale**: FR-002; reuses `LodArchive` and `versionFromCode`; never inflates a whole map on the main
  thread (Principle IV).
- **Alternatives**: by extension/name — fails for dropped files with odd names and wrong settings.

### R7. Settings: one definition, generated host manifests

- **Decision**: `src/adapters/shared/settings.ts` defines keys, types, ranges, defaults and conditions
  ([contracts/settings.md](contracts/settings.md)). The packaging tool generates WE `project.json`,
  `LivelyProperties.json` + `.loc.json`, KDE `main.xml` + `config.qml` string table from it. Map source
  keys are fixed now (`mapfile`) and a later `mapsource`/`mapfolder` pair is reserved so FR-018a holds.
  The root `project.json` of the proof of concept is deleted.
- **Rationale**: FR-003 "same settings with the same meaning on every host", FR-003b completeness
  checkable in one place.
- **Layering**: `settings.ts` and `strings.ts` are DOM-free data modules; `yarn verify layers` allows `tools/`
  to import exactly these two files from `src/adapters/shared/` (FR-008) and enforces that they import
  nothing with DOM or host APIs.
- **Alternatives**: hand-written manifests per host — drift between hosts.

### R8. View placement

- **Decision**: modes `random` (default), `centre`, `coords`. `coords` maps slider fractions 0–100 to the
  camera centre between the clamped extremes (0 = leftmost/topmost reachable view). `random` draws both
  fractions from the seeded RNG at start and on map change; seed from `crypto.getRandomValues` unless a
  check fixes it. Level `underground` on a one-level map → surface. A map smaller than the view is
  centred by existing clamping.
- **Rationale**: FR-003a; same slider range on every map size.

### R9. Strings and language

- **Decision**: `src/adapters/shared/strings.ts` holds `en` and `ru` tables with identical keys (type-level
  check: `ru` is typed `Record<keyof typeof en, string>`), plus a `verify packages` check over generated
  manifests. Language: host value where one exists (Lively and WE localise their own panels; KDE passes
  `Qt.uiLanguage`), else `navigator.language`; `ru*` → Russian, anything else → English.
- **Rationale**: FR-003b, SC-008 without gettext or a runtime dependency.

### R10. Pause and visibility per host

- **Decision**: the controller is inactive when any of: host paused, host hidden, `document.hidden`.
  WE: `setPaused`. Lively: `livelyWallpaperPlaybackChanged` (`--pause-event true`). KDE: QML computes
  `hidden` from `TasksModel` (maximised or fullscreen window on this screen, not minimised) or
  `ScreenSaver.ActiveChanged`, calls the page bridge, then sets `WebEngineView.visible = false`.
  Browser: `visibilitychange`. WE `fps` limit: `setFrameLimit(fps)` makes the scheduler wait at least
  `1000/fps` between frames (the idle cadence is already ≤ 5.6 fps).
- **Rationale**: FR-004, FR-015, FR-018, SC-003; engine already reaches 0 pending callbacks when
  inactive.
- **Alternatives**: freezing the page (`lifecycleState: Frozen`) in KDE — optional follow-up once the
  bridge call is proven; not needed for the budget.

### R11. KDE plugin structure

- **Decision**: Id `io.github.alamion.h3dynam`. `main.qml`: `WallpaperItem` → `WebEngineView` loading
  `../web/index.html` from the package (`file://`), background black, persistent profile from a
  singleton `SharedProfile.qml` (`storageName: "h3dynam"`); settings and file URLs pushed with
  `runJavaScript("h3wallpaper.apply(…)")` after `loadingChanged` succeeded and on every config change;
  `config.qml` with three `FileDialog`s, combos, sliders (visible only in `coords` mode), checkbox.
  Lock screen → plain background, no web view.
- **Rationale**: FR-017, FR-018; runJavaScript is enough for small JSON (files are read by the page).
- **Alternatives**: WebChannel — async setup and an extra script for no gain; URL query — reloads the page
  (and decoded state) on every setting change.

### R12. Browser adapter: remembered files and UI

- **Decision**: files are stored as `Blob`s in a separate IndexedDB database `h3dynam-files` (store
  `userFiles`, key = slot) so a cache schema bump does not forget them; settings in `localStorage`
  (try/catch). "Forget files" deletes that database and clears the decode cache (`forgetCache`). Drop zone
  = whole page; picker accepts multiple files; each file is classified (R6) into its slot. Panel: files,
  level, view mode + sliders, scale, objects, language-aware, auto-hides after 4 s idle; keyboard and drag
  scrolling as in the harness. The dev harness stays for development and checks.
- **Rationale**: FR-011–FR-013, SC-001.

### R13. Cross-view decode sharing

- **Decision**: the worker wraps each decode in `navigator.locks.request('h3dynam:decode:' + identity)`
  and re-checks the cache inside the lock. Two KDE screens (or two browser tabs) sharing a profile decode
  once; the second reads the cache.
- **Rationale**: FR-018 "decoded data shared, not decoded twice"; Web Locks exist in all target
  Chromium versions and in workers; absent API → decode without lock.

### R14. Packaging and publishing

- **Decision**: `yarn package [--host web|wallpaper-engine|lively|kde|all]` builds into
  `dist/packages/<host>/` and archives: Lively `.zip`, KDE `.tar.gz`, WE folder (published from the WE
  editor), web folder. Archives are written by small deterministic writers in `tools/shared/archive.ts`
  (sorted entries, fixed timestamps, Node `zlib`), so repeated builds are byte-identical. Preview images
  are generated from committed SVG/code (no game art). A GitHub Actions workflow on push to `testing`
  runs type-check, tests, `yarn package --host web`, `yarn verify packages` and `yarn verify hosts --host
  web`, then deploys `dist/packages/web` with `actions/deploy-pages`. Pages use relative asset paths
  (`base: './'`) so the `/heroes_III_ts/` sub-path works. Every package sets a CSP
  (`default-src 'self'; worker-src 'self' blob:; connect-src 'self' file: blob:; img-src 'self' data: blob:`)
  and the check rejects absolute external URLs. The CSP has no `'unsafe-inline'`: every script, including the
  host listener that must run first, is a separate file (`listener.js` loaded as the first classic
  `<script src>`); styles come from files and CSSOM only.
- **Rationale**: FR-013a, FR-019, FR-020.
- **Alternatives**: system `zip`/`tar` — timestamps and ordering make output non-reproducible.

### R15. Checks without real hosts (Linux, headless)

- **Decision**: `yarn verify packages` (static): required files per host, no game files (extensions
  `.lod .snd .vid .def .pcx .h3m .h3c .gm1 .pal .msk .fnt`, LOD/H3M magics, any file > 2 MB), no external URLs,
  no affiliation wording/logos (word list), string tables complete, manifests match the settings
  definition, host flavour has no module scripts or URL workers, runtime JS size, reproducibility (two
  builds, same hashes). `yarn verify hosts` (headless Chromium, synthetic fixtures by default, real files
  when present): web served under a sub-path; WE opened as `file://` with a simulated listener (Chromium
  started with `--allow-file-access-from-files` to stand in for WE's XHR permission); Lively served on
  `http://<hash>.localhost` with backslash folderDropdown values; KDE page opened as `file://` with bridge
  calls as QML makes them. Each scenario checks: placeholder text for missing files, load, each setting's
  effect, paused/hidden → 0 frames and 0 pending callbacks, ×1 frame equals the engine render for the same
  inputs (coords mode, fixed seed and clock), language switch, malformed files → message. KDE package
  also installed into a temporary root with `kpackagetool6` (skip, exit 4, when absent).
- **Rationale**: FR-020, FR-021, SC-003–SC-008; runs in CI and on Linux (Principle III, V).

### R16. Real-host acceptance

- **Decision**: `quickstart.md` holds the per-host acceptance procedures (FR-022). Browser and KDE are
  accepted on Linux within this feature; `yarn accept kde` automates the local Plasma part (install with
  `kpackagetool6`, set the plugin through plasmashell DBus scripting only with `--apply`, restore the
  previous wallpaper after). Wallpaper Engine and Lively are verified in a follow-up session run on
  Windows itself, working from "Open questions for the Windows session" below. No remote-control tooling
  for Windows is built.
- **Rationale**: an agent on the Windows machine reaches the hosts, their DevTools and the desktop directly;
  remote driving over SSH cannot see the interactive session and would add Windows-side scripts to shared
  tooling (Principle V).
- **Constraint for that session**: nothing Windows-only is committed to shared tooling; findings go to
  "Measurements"; fixes are made in the host-neutral code or the host bridge and re-checked by
  `yarn verify hosts` on Linux.

## Spikes

- **S2 (KDE)**: `WebEngineView` in a wallpaper plugin: XHR of `file://` user files, Blob worker, WebGL in
  plasmashell, `runJavaScript` bridge timing, `TasksModel` maximised detection, lock-screen behaviour.
- **S3 (KDE)**: singleton persistent profile shared by two screens; IndexedDB survives
  `plasmashell --replace`.

## Open questions for the Windows session

Expected pattern (built and simulated on Linux in this feature): classic IIFE page, top-level host
listeners queuing events, Blob-URL worker, user files read by `XMLHttpRequest` (WE: `file:///` from host
paths; Lively: relative URLs into `userfiles/`), IndexedDB decode cache as best effort, pause from host
events plus `document.hidden`. To verify or correct there:

**Wallpaper Engine **
1. **WE-1** Does `XMLHttpRequest` with `responseType = 'arraybuffer'` read a ~50 MB `file:///` file? Time for
   `H3sprite.lod` (warm-start budget 2 s includes it).
2. **WE-2** Paths with spaces, Cyrillic, `#`, `%`: is the value a raw backslash path, and does the R4 encoding load it?
3. **WE-3** Classic script + Blob worker start? (Module script and URL worker expected blocked — confirm, to justify R3.)
4. **WE-4** Is `window.wallpaperPropertyListener` set early enough to get the first full `applyUserProperties`?
5. **WE-5** Does IndexedDB survive a WE restart and a PC reboot; is it wiped by other wallpapers or cache reset;
   separate per monitor?
6. **WE-6** Keys of `applyGeneralProperties` — is there a language value; does `navigator.language` follow WE's
   language or Windows'?
7. **WE-7** On pause (fullscreen app): is `setPaused(true)` delivered, does `visibilitychange` fire, is the process
   frozen; after resume does animation continue without a frame burst?
8. **WE-8** Is `fps` delivered, and does the scheduler limit hold?
9. **WE-9** Does `localization` under `general` give Russian property labels with WE set to Russian (`ru-ru` key)?
10. **WE-10** WebGL 1 context on the WE CEF; `devicePixelRatio` and surface size on scaled (125–150 %) Windows displays
    and multi-monitor setups.

**Lively**
1. **LV-1** `folderDropdown` Browse copies the three files into `userfiles/`; relative XHR/fetch of 50 MB works over
   the virtual host; time.
2. **LV-2** Value format `userfiles\name` (backslash) or `null`; files with Cyrillic names.
3. **LV-3** `livelyPropertyListener` calls arrive after the classic bundle has registered the listener (all controls,
   once) and on change; dropdown index mapping.
4. **LV-4** `--pause-event true` → `livelyWallpaperPlaybackChanged` on fullscreen/battery rules; JS keeps running
   while paused, the page reaches 0 pending callbacks.
5. **LV-5** IndexedDB persistence across Lively restart; per-screen / span / duplicate layouts.
6. **LV-6** `LivelyProperties.loc.json` with `ru` gives Russian labels; `navigator.language` in WebView2.
7. **LV-7** Import of the `.zip` package, thumbnail/preview display.

**Both**
- Real `yarn verify hosts` invariants reproduced on the real host through DevTools (`?h3test=1` is not
  available in hosts: set `window.__h3testHook = true` from the DevTools console and reload).
- Budgets (warm/cold start, memory) on a real mid-range Windows GPU.

## Measurements

(filled during implementation)
