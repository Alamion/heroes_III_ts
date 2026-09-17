# AGENTS.md — Development Guide for heroes_iii_dynam

A live wallpaper that renders Heroes of Might and Magic III maps (terrain, objects, heroes,
towns — animated) from game files supplied by the user. Targets: plain browser, Wallpaper
Engine, Lively Wallpaper, KDE Plasma.

**The project constitution is [.specify/memory/constitution.md](.specify/memory/constitution.md).
Read it first. If this file conflicts with it, the constitution wins — fix this file.**

---

## Current State

The foundation ([specs/002-foundation-rewrite/](specs/002-foundation-rewrite/)) and map objects
([specs/003-map-objects/](specs/003-map-objects/)) are implemented: parsers for LOD, DEF, PCX and
H3M (RoE/AB/SoD), a version-independent world state, a WebGL 1.0 renderer for terrain, rivers,
roads, objects, heroes and towns (object atlas, per-object animation, flag colours, 16-bit shadows)
with the map border on top, a browser dev harness (sprite archive, data archive `h3bitmap.lod`,
map), inspection CLIs and headless checks (layers, determinism, fidelity with objects, budgets). The
capture tooling verifies level and pixel mapping before storing a capture. Platform adapters
([specs/004-platform-adapters/](specs/004-platform-adapters/)) are built on Linux: a browser version
(GitHub Pages from `testing`), Wallpaper Engine, Lively and a KDE Plasma 6 plugin, one host-neutral
wallpaper controller, `yarn package`, `yarn verify packages|hosts` (host simulations) and `yarn accept kde`.
KDE is accepted on a real Plasma session; Wallpaper Engine and Lively still need verification on the real Windows hosts (004 research "Open
questions for the Windows session" and "Windows session handoff").

Facts measured against the original game that code must respect (details in
[002 research](specs/002-foundation-rewrite/research.md), [003 research](specs/003-map-objects/research.md)):
- The game shows colours through RGB565 (`toDisplayColor` in the atlas palette).
- Palette animation: one global step counter, 180 ms per step, the last colour of a range moves to
  its start; lava rotates 246–254, mud river 228–239, lava river 240–248. Stills may catch sprites
  one step apart.
- Map border (`edg.def`) is a deterministic 4×4 pattern drawn over objects; roads are drawn 16 px down.
- Objects: bottom-right anchor; order flat → non-visitable → visitable → row → heroes (flag, then body) → map order;
  flag pixels (index 5) use `game.pal` entries 64–71 (players) and 72 (neutral); shadow index 1
  keeps `(c>>1)+(c>>2)`, index 4 `c>>1` of each 5/6-bit channel; object frames advance every 180 ms
  with a random phase per object per launch (seeded here); towns use `AVC?0` without fort, `AVC?x0`
  with one.
- Heroes: `ah00_.def`–`ah17_.def` body + `af0?.def` flag (colour baked in); not in `Objects.txt`.
- Accepted deviations (003 research, owner review 2026-09-17): draw order in dense mountain clusters,
  reef frames/shadows (the render keeps its reef shadows). Fidelity reports these views as `fail`;
  do not chase them.

---

## Stack and Layout

- TypeScript (strict, `erasableSyntaxOnly`: no enums, namespaces or parameter properties; `.ts`
  import extensions). **No runtime dependencies**: raw WebGL 1.0, native `DecompressionStream`,
  IndexedDB, a module Worker (web) or a Blob worker (classic host builds). Dev dependencies: Vite, Vitest, TypeScript, `playwright-core`
  (drives the system Chromium, `/usr/bin/chromium-browser` or `H3_CHROMIUM`, with SwiftShader).
- Node 22 runs the CLIs directly (type stripping).

```text
src/core/util      ByteReader, FormatError, logger, clock, seeded RNG, web globals
src/core/data      typed game tables (terrain, palette rotation, object classes, thresholds)
src/core/formats   lod/ def/ pcx/ pal/ h3m/ text/ (Objects.txt, artraits.txt)
src/core/state     world state, sprite footprints, floating tiles, random outcomes, render objects, object index
src/core/sim       simulation events
src/core/render    atlas, object atlas, camera, draw plans, draw order, animation, palette, software rasterizer, WebGL renderer
src/runtime        engine facade, decode worker, IndexedDB cache, frame scheduler
src/adapters/shared        wallpaper controller, settings + strings (en/ru, DOM-free), overlay, file URLs, remembered files
src/adapters/web           browser version (panel, drop, remembered files; ESM build)
src/adapters/wallpaper-engine|lively|kde   host bridges (classic build: listener.js + main.js)
src/adapters/dev-harness   index.html (harness), render.html (headless checks)
packaging/kde              QML shell of the Plasma wallpaper plugin
tools/package              yarn package (builds, manifests, previews)   tools/accept   yarn accept kde
tools/inspect      yarn h3        tools/checks   yarn verify
tools/shared       PNG codec, headless Chromium, game file lookup, CLI runner
tools/reference-env yarn ref (item 1)
test/fixtures/synthetic   generators for LOD/DEF/PCX/H3M (no game content)
```

Layers only import downwards (`core/util` → `data` → `formats` → `state` → `sim` → `render` →
`runtime` → `adapters`); `yarn verify layers` enforces it. Tools may import anything except adapters:
from adapters they import only the DOM-free `src/adapters/shared/settings.ts` and `strings.ts` (to
generate host manifests). Host adapters (`src/adapters/<host>/`) import only `src/adapters/shared/`,
runtime and core, never each other; nothing else imports tools or adapters.

---

## Commands

```bash
yarn dev            # dev harness (h3sprite.lod, h3bitmap.lod, a map; arrows/drag scroll, U level, O objects)
yarn build          # type-check (tsc -b) + production build into dist/
yarn preview        # preview production build
yarn test           # Vitest, run once (real-file and browser suites skip with a reason)
yarn test:watch     # Vitest, watch mode
yarn test:coverage  # coverage of src/core
yarn package [--host web|wallpaper-engine|lively|kde|all]   # dist/packages/<host>, Lively .zip, KDE .tar.gz
yarn preview:web    # serve dist/packages/web under /heroes_III_ts/ (as GitHub Pages)
yarn accept kde [--apply] [--screen 0] [--keep]   # install the plugin; --apply switches a screen and restores it
```

Inspection (one JSON document on stdout; exit 0 ok, 1 failure, 2 usage, 3 missing files).
File arguments are paths or bare names found in `public/dev-assets/`, `<bundleDir>/Maps`,
`<bundleDir>/Data`; LOD entries are `archive.lod:ENTRY`:

```bash
yarn h3 lod list h3sprite.lod [--filter '*tl.def']
yarn h3 lod extract h3sprite.lod:watrtl.def --out /tmp/w.def
yarn h3 def dump|png|palette h3sprite.lod:watrtl.def [--frame N --out F.png --full --opaque --step N]
yarn h3 pcx dump|png h3bitmap.lod:ENTRY.pcx [--out F.png]
yarn h3 map info|tiles|tile|objects|object|parse-all MAP [--level Z --region x0,y0,x1,y1 --x --y --class --index]
yarn h3 map floating MAP [--level 0] [--region ...] [--format list|json]   # for yarn ref selfcheck --floating-tiles
yarn h3 map draw-list MAP --level Z --region x0,y0,x1,y1 (--tick N | --time MS) [--seed S]
yarn h3 map random MAP [--seed S] [--level Z]
yarn h3 render MAP --level Z --region x0,y0,x1,y1 (--palette-step N | --time MS) [--tick N] [--seed S] [--no-objects] [--draw-list] [--scale F] --out F.png
```

Objects need the data archive `h3bitmap.lod` (Objects.txt, artraits.txt, game.pal); tools find it in
`<bundleDir>/Data`.

Checks (exit 0 pass / not-checkable, 1 fail, 3 prerequisite missing with `--require`, 4 skip;
reports in git-ignored `check-reports/`):

```bash
yarn verify layers
yarn verify determinism [--runs 10] [--rebuild]
yarn verify fidelity --map test_map.h3m --all-regions [--kind still|clip] [--capture ID] [--exclude-objects] [--seed S]
yarn verify fidelity --map M --level Z --region x0,y0,x1,y1
yarn verify budget [--no-build] [--throttle 4] [--viewport 1920x1080]   # + package sizes and package start-up
yarn verify packages [--host …] [--no-build] [--reproducible]
yarn verify hosts [--host …] [--files synthetic|real] [--map NAME] [--no-build]    # host simulations, invariants 1–10
yarn verify all
```

`yarn check` is a Yarn 1 built-in, hence `verify`.

Reference environment (captures from the original game; see below):

```bash
yarn ref doctor                                   # check prerequisites (exit 3 if any fail)
yarn ref setup [--force]                          # dedicated Wine prefix + staging root + expected hashes
yarn ref calibrate                                # record local probes, verify layout (Arrogance.h3m)
yarn ref still  --map F --level 0|1 --x N --y N [--start fixed|random] [--debug-steps]
yarn ref clip   --map F --level 0|1 --x N --y N --duration MS [--start fixed|random]
yarn ref editor --map F --level 0|1 --x N --y N [--overlay grid] [--launches N]
yarn ref find   --map F --level 0|1 --region x0,y0,x1,y1 [--source game|editor] [--kind still|clip]
yarn ref list | prune --id ID | --before ISO [--dry-run]
yarn ref selfcheck --map F [--runs 5] [--samples 10] [--floating-tiles "x,y;x,y"]
H3REF_LIVE=1 yarn test                            # also run live checks against the game (slow)
```

Every `yarn ref` command prints one JSON document on stdout; logs go to stderr.

---

## Workflow

- Spec Kit: `/speckit-specify` → `/speckit-clarify` (optional) → `/speckit-plan` →
  `/speckit-tasks` → `/speckit-implement`. Feature specs live in `specs/`.
- Every plan includes a Constitution Check. Every visible feature ships with a headless check
  (data-level and/or image diff against reference captures) that runs on Linux without a human.
- Development happens on Linux. No Windows-only paths, tools, or scripts in shared tooling.
- Code, comments, commits, and docs are in English.

---

## Local-Only Folders (git-ignored — never commit their contents)

| Folder | Contents |
| --- | --- |
| `public/dev-assets/` | Game files for development (see below) |
| `context/` | Third-party reference code and docs (see below) |
| `reference-captures/` | Screenshots/recordings from the original game, used by fidelity checks |
| `check-reports/` | Reports and diff images from `yarn verify` |
| `dist/` | Build output (never contains `public/dev-assets/`) |

Never commit game files or anything derived from them (extracted frames, atlases, palettes,
caches, captures). The one exception is a few documentation screenshots of this project's own
output in `docs/img/` (≤ 2 MB each, ≤ 10 MB total, never shipped; constitution I). Tests needing
real game files must skip with a clear message when absent.

### Dev assets (`public/dev-assets/`)

- `H3sprite.lod` — base game sprite archive (Complete edition)
- `h3bitmap.lod` — data archive (Objects.txt, artraits.txt, game.pal), needed for objects
- `test_map.h3m` — primary check map (see below)
- `Arrogance.h3m` — SoD map, 36×36 with underground
- `Merchant Princes.h3m` (72×72, SoD, one level), `Shadow Valleys.h3m` (72×72, SoD, two levels) —
  copies of Complete maps that have captures (the reveal-cheat and level-switch cases)
- `paragon-ultimate-edition.h3m` — SoD 144×144, two levels, ~30 000 objects (large real-map load); built for
  HD Mod + SoD_SP, so that plugin's objects show as missing sprites (expected)
- `По праву силы.h3m` — map with non-ASCII file name; HotA format (0x20), rejected by the base-game tooling
- `[HotA] The Devil Is in the Detail.h3m` — HotA map, 252×252 (HotA support comes later; budget
  checks use a synthetic 252×252 two-level map meanwhile)

Checks and tests may use any map and archive from the configured install (`<bundleDir>/Maps`,
`<bundleDir>/Data`); `dev-assets` are only examples.

**Primary check map: `public/dev-assets/test_map.h3m`** (local-only, built by the project owner in the
original editor; SoD 144×144, two levels). It holds nearly every object class, all terrains, rivers,
roads and player colors, split into zones (random objects kept apart); zone coordinates are in
[specs/003-map-objects/spec.md](specs/003-map-objects/spec.md). Use it first for fidelity checks
and captures.

### Reference material (`context/`)

| Folder | What | License → allowed use |
| --- | --- | --- |
| `homm3-parser/` | TS parsers for H3M (RoE/AB/SoD incl. object details), LOD, DEF, PCX | MIT → H3M layouts ported with attribution in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md) |
| `heroes_iii_android/` | Kotlin/libGDX Android live wallpaper (github.com/IlyaPomaskin/h3lwp): LOD/DEF/H3M readers, terrain palette rotation, rendering | No license → study only, never copy code |
| `example_wallpaper_engine/` | Someone else's Wallpaper Engine web wallpaper | Study packaging/`project.json` only |
| `wallpaper_dev_wiki/` | Wallpaper Engine web wallpaper docs (user properties, property listener, FPS limiter, debugging) | Reference |

Also: VCMI is a good format/behavior reference but is GPL — study only, never copy code.
Online Wallpaper Engine docs: <https://docs.wallpaperengine.io/>

---

## Baseline Game (fidelity reference)

- Heroes of Might and Magic III: **Complete**, unmodified: original SoD/Complete `Heroes3.exe`
  plus Complete data archives. Not HD Mod, not HotA.
- Local install: a Complete edition (with HotA + HD Mod on top) in a Wine prefix (path set in
  local config). It contains the original `Heroes3.exe` and `h3maped.exe`. Captures run the
  original executable under plain Wine on a virtual display with HotA/HD Mod not loaded; the
  HD Mod `Heroes3_HD.exe` is only a documented fallback that needs a constitution amendment.
- The reference environment and capture workflow are specified in
  [specs/001-reference-environment/](specs/001-reference-environment/).

### Reference environment setup (one time)

1. Install system packages: `sudo dnf install wine xorg-x11-server-Xvfb xdotool ffmpeg-free`
   (verified on Fedora 43: Wine 11.0 Staging, Xvfb 21.1.24, xdotool 3.20211022, ffmpeg-free 7.1.5).
2. `cp reference-env.config.example.json reference-env.config.json` and set `bundleDir` to the
   Complete edition folder (or export `H3REF_BUNDLE_DIR`). The file is git-ignored.
3. `yarn ref setup`, `yarn ref calibrate`, `yarn ref doctor` (all checks pass).

How it works: the tooling builds `~/.local/state/h3-reference/game-root` with a copy of
`Heroes3.exe`/`h3maped.exe` and symlinks to the original archives and runtime DLLs only (HotA and
HD Mod files are never visible), runs it in a dedicated Wine prefix (no audio) on an Xvfb display,
drives it with xdotool, and grabs with ffmpeg. Nothing is shown on the desktop and the game
folder and `~/.wine` are never written. Captures go to git-ignored `reference-captures/`;
calibration probes (derived from game output) stay in the state directory.

Facts agents need when touching the tooling:
- The Russian build types Cyrillic in the chat line unless Ctrl is held; the working reveal
  cheat is `nwcwhatisthematrix`; its reply covers the viewport for ~22 s.
- A minimap click centres the view on the clicked tile; the view (19×17 tiles) is read back from
  the dashed rectangle on the minimap. Never park the mouse at a screen edge (it scrolls).
- Starts are random unless `--start fixed` (default) sets town/hero/bonus; AI heroes and
  starting army sizes stay random (outside the viewport or covered by volatile masks).
- The editor picks animation frames once per launch; its volatile mask compares launches.
- Menu screens are recognised by calibrated probes; after changing navigation or layout run
  `yarn ref calibrate`. Failed captures leave a screenshot in `~/.local/state/h3-reference/failures/`.
- Random map objects (e.g. random monsters) are re-rolled every launch even in fixed mode;
  libfaketime does not pin them. Their tiles are "floating": excluded from automated
  reproducibility checks (`--floating-tiles` from `yarn h3 map floating`) and checked visually
  and less often.
- The level is detected from the minimap against each level's terrain (the interface is skinned
  in the human player's colour, so button hashes do not work); stills and clips are checked against
  a terrain render at the recorded mapping and one-tile shifts before they are stored
  (`MAPPING_UNVERIFIED`, `LEVEL_UNKNOWN`, `LEVEL_MISMATCH`). Records carry a `verification` block.
- Scenario intro messages of other sizes are not recognised by the probe; the reveal code is typed
  up to three times, the first attempt's Return closes such a message.
- `--debug-steps` saves a screenshot after every session step to the failures folder.
- Captures of an edited map file are skipped as `map-changed`; `yarn ref doctor` counts them.

---

## Wallpaper Engine Notes

- `project.json` is generated into the package by `yarn package` from
  `src/adapters/shared/settings.ts` (never hand-edited; there is no root `project.json`). User files
  come in through properties of `"type": "file"`. Do not set `fileType`; it blocks selection of
  some files.
- File property values arrive as local paths and must be resolved to `file:///` URLs.
- Wallpaper Engine is detected via `window.wallpaperPropertyListener`. Pause events arrive
  through the same listener (`setPaused`); Wallpaper Engine also freezes the process itself, but
  other hosts may not, so the core must stop rendering on pause/hidden from any adapter.

## Platform Adapter Notes

- Hosts only translate signals; behaviour lives in `src/adapters/shared/controller.ts`. Settings and
  host manifests come from `src/adapters/shared/settings.ts` + `strings.ts`; never hand-edit generated
  `project.json`, `LivelyProperties*.json`, `main.xml` or `config.qml`.
- `file://` hosts (Wallpaper Engine, KDE) cannot load module scripts or URL workers and `fetch` has no
  `file:` scheme: host packages are classic IIFE scripts, the worker is embedded and started from a Blob,
  files are read with `XMLHttpRequest`. Lively serves the folder over `https://<hash>.localhost/`;
  its folderDropdown copies chosen files into `userfiles/` and sends `userfiles\name`.
- Every page has a CSP without `'unsafe-inline'`: no inline scripts, styles or handlers (host listeners
  are separate `listener.js` files loaded first).
- KDE: one persistent `WebEngineProfile` singleton for all screens; lock and window-coverage detection are
  isolated behind `Loader`s. The lock screen gets a plain background (no shared GL context there).
- Actions (`ACTIONS` in `settings.ts`, e.g. "new random place now") hold no value: Wallpaper Engine gets a
  checkbox whose every toggle acts, Lively a button, KDE a counter the settings page increments, the browser a
  panel button (key `R`). They are handled by the bridges, never stored in `WallpaperSettings`.
- KDE live debugging: restart plasmashell with `QTWEBENGINE_REMOTE_DEBUGGING=127.0.0.1:9333`, attach over the
  DevTools protocol (Playwright's `connectOverCDP` is not supported by QtWebEngine; use the raw websocket).
- Test hook on a real host: `localStorage.setItem('h3dynam:test', '1')` in DevTools, reload, then
  `__h3wallpaper.controller.state()`.

---

## Code Style

- Strict TypeScript, no `any` without a justified local comment; `import type` for type-only
  imports.
- Format parsers and simulation must not touch the DOM and must run in Node.
- Game data tables (object classes, timings, palette rotation ranges, player colors) live in
  typed data modules, not scattered literals.
- Parsers are bounds-checked and throw typed errors with file name, offset, version, and
  structure; never guess byte skips.
- Log through the project logger (`src/core/util/log.ts`), never bare `console.log`; never swallow
  errors silently.
- A new synthetic fixture is generated by committed code in `test/fixtures/synthetic/`; never commit
  generated or game-derived files.
