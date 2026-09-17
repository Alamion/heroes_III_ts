# TODO

Each item runs in its own chat with its own `/speckit-specify`. Read
[.specify/memory/constitution.md](.specify/memory/constitution.md) and [AGENTS.md](AGENTS.md)
first.

## 1. Reference environment — done

Implemented in [specs/001-reference-environment/](specs/001-reference-environment/) (`yarn ref …`,
see AGENTS.md). Uses a local Wine install of the Complete edition instead of Heroic/Proton/GOG
(constitution v1.1.0). Original notes kept below for history.


Set up a reference environment (Heroic Games Launcher, Proton, GOG Complete edition, a capture
workflow). Run `/speckit-specify` for it. (look at <https://h3hota.com/ru/x_linux> and
<https://h3hota.com/ru/download> for reference of how to install)

Notes:

- Baseline is the unmodified Complete edition: capture from `Heroes3.exe`, not `h3hota HD.exe`
  (HotA/HD Mod may be installed alongside, but must not affect captures).
- Captures go to the git-ignored `reference-captures/`, indexed by map, region, and timestamp so
  image-level checks can find them.
- Goal: an agent can script launching a map, positioning the view, taking screenshots, and
  recording short animation clips without asking the user (consider fixed resolution,
  windowed mode, and a deterministic way to reach a given map position).
- Also capture the map editor (`h3maped.exe`) views: static object placement without animation
  noise is useful for placement checks.

## 2. Foundation rewrite — done

Implemented in [specs/002-foundation-rewrite/](specs/002-foundation-rewrite/) (`yarn h3 …`,
`yarn verify …`, see AGENTS.md): no runtime dependencies, WebGL 1.0 terrain renderer, all
base-game formats, floating tiles, fidelity and budget checks. Open follow-ups for later items:
mud/lava river palettes, roads and map corners are not yet confirmed by game captures; the capture
tooling fails on some maps (see AGENTS.md). Original notes kept below for history.

Requirement from item 1: the H3M object parser must be able to list tiles covered by random
objects (random monsters, artifacts, resources, dwellings, towns/heroes) — the whole sprite
footprint, not just the object's tile (monster sprites span 2×2 tiles) — so reference checks can
treat them as floating (`yarn ref selfcheck --floating-tiles`, later image-diff masks).

The layered structure, format parsers, a renderer that only draws what's on screen, the headless
checking scripts and budget checks. Run `/speckit-specify`.

Notes:

- Scope: LOD (base game), DEF, PCX, H3M RoE/AB/SoD (full object details parsed, even if only
  terrain/rivers/roads are rendered at first), world-state model, WebGL1 terrain renderer with
  palette-lookup animation, browser dev harness, inspection CLIs, budget checks.
- Decide the stack: the constitution pushes against Pixi.js + Preact (bundle budget ≤ 100 KB
  gzipped, palette shaders); justify whatever is kept.
- `context/homm3-parser` (MIT) can be ported with attribution; `context/heroes_iii_android`
  (no license) and VCMI (GPL) are study-only.
- Known PoC failures to not repeat are listed in AGENTS.md "Current State".
- Replace `scripts/sync.js` (hardcoded Windows path) — or leave it to item 3's platform adapters.
- Add a third-party notices file when the first code is ported.
- Update AGENTS.md (stack, layout, commands) once the plan is decided.

## 3. Later features

One `/speckit-specify` each and roughly in this order:

1. ~~**Objects and animations**~~ — done in [specs/003-map-objects/](specs/003-map-objects/) (accepted
   deviations listed in its research.md: draw order in dense mountain clusters, reef animation).
   Original note: map objects, heroes, towns, monsters; draw order; player colors;
   animation timings verified against captures. Random-object tiles are floating in automated
   checks and verified less often, visually; if specific random outcomes need verifying, build an
   object atlas (as in the PoC) on a separate git branch and inspect it directly.
2. **Platform adapters** — built on Linux in [specs/004-platform-adapters/](specs/004-platform-adapters/):
   browser version (GitHub Pages), Wallpaper Engine, Lively, KDE Plasma plugin, host simulations and
   package checks; accepted on the real KDE session. **Open:** verify Wallpaper Engine and Lively on Windows (move the project there; use
   004 research "Open questions for the Windows session" and "Windows session handoff"). Later: a map
   folder with a random map per start or timed rotation (settings keys `mapsource`/`mapfolder`/
   `maprotation` are reserved). Original note: plain browser (file picker / drag-and-drop), Wallpaper
   Engine, Lively Wallpaper, KDE Plasma wallpaper plugin; pause/visibility handling; scale setting
   (32px default); packaging without any game files.
2a. **Multi-screen and lock screen** (candidate spec after 3.2; spike first; KDE and Windows) —
   (a) one map spanning all screens with continuous transitions: every screen places its camera from
   the union of all screen geometries, one seed per session and a wall-clock animation time so palette
   and object steps change at the same moment on every screen. KDE: `Qt.application.screens` + a QML
   singleton for the seed. Wallpaper Engine: one wallpaper can span all monitors ("Span" layout, the page
   gets the whole desktop rectangle) — check the monitor rectangles it exposes; Lively: its "Span"
   placement likewise. (b) the map on the lock screen: KDE's greeter (kscreenlocker) loads the
   wallpaper plugin but sets no shared GL contexts and does not initialise Qt WebEngine, so a
   WebEngineView there is expected to fail — test first; fallback is a native QML lock-screen view
   (e.g. frames rendered by the desktop wallpaper into the user cache). Windows: the lock screen accepts
   only a static image (Wallpaper Engine/Lively cannot animate it) — at most a periodically exported
   still; confirm in the Windows session.
3. **Complete edition save files** — research spike first (format is only partly documented);
   load into the existing world-state model.
4. **Interactive extras** — idle/mouse map scrolling, defeating monsters/heroes, capturing towns
   and mines; implemented as simulation events.
5. **HotA support** — only after base-game fidelity checks pass: HotA LOD (incl. 1.8+ encrypted
   names), HotA H3M versions, HotA saves. `[HotA] The Devil Is in the Detail.h3m` (252×252) is
   the stress-test map.

## Spin-off: browser extension "battlefield header"

Not a map wallpaper: a separate product (likely its own repository or workspace package) that reuses
the format parsers (LOD, DEF, PCX, palettes) and the animation knowledge. Start with a research spike,
then its own `/speckit-specify`.

Idea: an extension for Firefox (Chromium browsers if feasible) that shows a strip of a battlefield
(ground and some sky) in the browser header. From time to time a creature walks in, stops, idles,
and sometimes meets another creature: attack, defend, death. It must feel alive and fun but not
distracting and must not hide much of the page.

Research questions:

- Where it can be drawn at all. Firefox: the `theme` API (`browser.theme.update` with `theme_frame`
  images) is static per update — check whether frequent updates are viable (CPU, flicker, per-window
  themes) or whether animation needs another surface (sidebar, new tab page, a page overlay via a
  content script). Chromium: themes are static packaged images, no runtime theme API — find what is
  possible there, if anything.
- User-supplied game files, no game content shipped: can the extension ask for `H3sprite.lod` /
  `h3bitmap.lod` once (options page file picker) and keep them or the decoded sprites (extension
  IndexedDB, `unlimitedStorage`), survive browser restarts and updates; what happens on uninstall.
- Content: which battle backgrounds (`CmBk*.pcx`) and creature battle DEFs (animation groups: move,
  idle, attack, defend, hit, death) exist; which crop and proportions of ground/sky look good in a
  header of typical height and width; creature scale in a low header.
- Behaviour: a small, calm scenario engine (spawn rarely, walk, stop, occasional duel, death and
  fade), seeded; frame timing close to the game; pause when the window is hidden or on battery if
  the API allows; a user setting for frequency or "off".
- Budgets: idle CPU/GPU near zero between events; memory of decoded sprites; store review rules
  (AMO / Chrome Web Store) for extensions that read user-provided proprietary files.
- Code sharing: how to reuse `src/core` (formats, palette, DEF decoding) without the map-specific
  layers — a shared package, a git subtree, or a copy with a sync rule.

## Housekeeping

- ~~Refresh or drop `.opencode/skills/developing-preact`~~ — dropped with Preact (item 2).
- ~~Reference tooling (item 1): fix the one-tile mapping error of stills clamped at the top map
  edge, and `still` failures on `Shadow Valleys.h3m` (level switch) and `Merchant Princes.h3m`
  (reveal cheat)~~ — fixed in item 3.1 (spec 003); roads, mud/lava rivers and corners confirmed.
- Object draw order in dense obstacle clusters and reef animation differ from the game in a few
  percent of pixels (spec 003 research); investigate if they become visible.
- Warm start with objects is 1.1–1.8 s under 4× CPU throttling (limit 2 s): profile the data
  archive identity/cache path before adding more start-up work. Update 2026-09-17 (spec 004): the dev
  harness now measures 1.8–2.7 s on test_map.h3m, Pandora's Box and the synthetic 252×252 map, the same as
  on `testing` before spec 004 — over the limit on some runs; the packages stay under it (web 0.6–1.1 s,
  Wallpaper Engine 1.6–1.7 s on test_map.h3m).
