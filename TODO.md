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
   004 research "Open questions for the Windows session" and "Windows session handoff"). Map rotation
   moved to item 5. Original note: plain browser (file picker / drag-and-drop), Wallpaper
   Engine, Lively Wallpaper, KDE Plasma wallpaper plugin; pause/visibility handling; scale setting
   (32px default); packaging without any game files.

After the open fixes of item 2, the order is (owner, 2026-09-22):

3. ~~**HotA support**~~ — implemented in [specs/005-hota-support/](specs/005-hota-support/): the
   obfuscated HotA 1.8 archive and archive sets, map format `0x20` (sub-versions 6, 7, 9 and 10,
   including the event-system block), Highlands and Wasteland, five town forms per faction, hero
   classes to 24, the HotA sprite conventions, a `hotaarchive` setting on every host and
   `yarn verify maps`. All 453 local maps parse to the exact last byte. Measurements and the
   reasoning behind each decision are in that spec's research.md; the constitution was amended
   (1.3.0) for the HotA reference baseline and the HotA budget case.

   The reference environment gained its second baseline from `h3hota.exe` (US4): `yarn ref …
   --baseline hota`, refused without the constitution clause, with its own game root, calibration,
   probe masks and capture namespace. Eight HotA views are captured; the water clip matches pixel
   for pixel over 17 frames.

   Left for later, each recorded with its evidence:
   - ~~**The HotA object-pixel difference**~~ — mostly solved (2026-09-24, 005 research "Four
     shadow strengths"): special indices are shadows only when marked, HotA tints shadows by the
     object's soil (sand, wasteland), and indices 2/3 are shadow strengths of their own. The eight
     views went from 84 475 to 23 393 differing pixels, the probe map to 0. The rest is draw order
     and overlap in dense highland forests and town bodies; needs owner review with the diff images
     before it can become an accepted deviation. To come back to, with the shadow rules:
     - **Overlapping objects** (not fixed): where a shadow meets a neighbouring object's body, or
       shadows stack, the game's result differs from ours — 21 649 of the 23 393 pixels are in the two
       underground highland views (`x1-19_y110-126`, `x3-21_y118-134`), about 500 per town in the
       town views. Single-step shadows over bare terrain match on 99 %+ everywhere, so this is draw
       order or stacking, not the shadow formula.
     - **Stacking order** (not measured): stacked steps are applied strongest kind first
       (`SHADOW_KIND_ORDER`), not in draw order.
     - **Overlapping tints** (not measured): shadows of objects on different soils over one pixel
       take the strongest tint (wasteland > sand > black).
     - **Tinting tile of objects without an entrance** (not measured): the lowest, rightmost blocked
       tile is used (`standingTile` in `render-objects.ts`); the probe towers all had entrances. A
       probe: decorations (trees, rocks) standing across a sand/wasteland border.
     - **Medium and faint shadows on sand** (not measured): indices 2 and 3 never fell on sand in the
       captures; the sand addition for them is extrapolated (`SAND_ADD` in `animation.ts`).
     - **Shadow indices 6 and 7** (not measured): assumed dark and light.
     - **Cyan markers** at special indices (19 HotA sprites): not understood, read as shadows.
     Details: 005 research "Recolouring implemented", "Four shadow strengths".
   - **A region-scoped object atlas** — object GPU memory still scales with the map, which
     contradicts constitution IV. HotA made it visible: `test_map_hota.h3m` needs 4610 frames and
     29.3 M sprite pixels, so the page size now follows the GPU's `MAX_TEXTURE_SIZE` (2048–4096)
     instead of the guaranteed minimum. The real fix is to build the atlas from the visible region.
   - **HotA saves**, **HotA truecolour sprites** (D32/P32; interface art only, not needed for the
     adventure map), **`HotA.dat`** (editor text) and **`EdObjts.txt`** — all out of scope with
     evidence in 005 research R12.
   - **Hero gender** — HotA ships a second gendered body per class (`ah00b_`); no measured source
     for a hero's gender was found, so the non-suffixed body is drawn.

4. **Publishing on the wallpaper platforms** — users download the wallpaper where they already look for
   wallpapers: Steam Workshop for Wallpaper Engine, the Lively library/gallery, the KDE Store
   (store.kde.org) for the Plasma plugin; the browser version stays on GitHub Pages. Ideally published
   automatically on a release, like GitHub Pages is deployed from `testing` now (research what each platform
   allows: Steam Workshop upload from CI via SteamCMD `workshop_build_item`, KDE Store/OCS API, Lively
   options). Write the text for each platform page, generated from the same source as the manifests where
   possible; each page states:
   - a link to this repository (the source);
   - that the game files are not included and the user supplies them (which files, where they come from);
   - the platform's own quirks (Wallpaper Engine has many: files copied into the wallpaper folder by
     hand, `game\` paths, image/video-only file pickers — see 004 research);
   - that suggestions and bug reports are handled only in the GitHub issues of this repository (not in
     Workshop comments or store reviews), so there is one place to watch.
   Name everywhere: "Heroes 3 Living Map" (`APP_NAME` in `src/adapters/shared/strings.ts`).
5. **Other extras**, one `/speckit-specify` each:
   - **Multi-screen and lock screen** (spike first; KDE and Windows) —
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
   - ~~**Map rotation**~~ — implemented in [specs/007-map-folder/](specs/007-map-folder/): a folder (or
     `.zip`) of maps, a random map per start, a new map every N minutes of visible time, "next map now",
     size and underground filters, a swap without an empty frame, an 8-map bound of the decode cache.
     Open: WE-F1/WE-F2/LV-F1 in the Windows session (004 research, "Map folder").
     **Follow-up (owner, 2026-09-25):** choosing files and folders differs per host (a path on Wallpaper
     Engine, picker/drop in the browser, a `.zip` on Lively, a folder dialog on KDE); look for a more
     uniform way (007 research R1 "Owner review"). Everything host-specific sits in each bridge's
     catalogue function, so a uniform method replaces only those.
   - **Complete edition save files** — research spike first (format is only partly documented);
     load into the existing world-state model.
   - **Interactive extras** — idle/mouse map scrolling, defeating monsters/heroes, capturing towns
     and mines; implemented as simulation events.

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
- Frame cost after the fractional-scale fix (spec 004 T074/T075): object vertices grew from 7 to 11 floats (12 since the HotA shadow tint)
  and are uploaded every object tick, +5–9 % main-thread time per frame under 4× CPU throttling; the
  budget idle-cadence limit was relaxed by one frame instead. When optimising performance, slim the vertex
  format (per-quad data once per quad) or upload only changed quads, then consider removing the slack.
