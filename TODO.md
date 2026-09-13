# TODO

Each item runs in its own chat with its own `/speckit-specify`. Read
[.specify/memory/constitution.md](.specify/memory/constitution.md) and [AGENTS.md](AGENTS.md)
first.

## 1. Reference environment

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

## 2. Foundation rewrite

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

1. **Objects and animations** — map objects, heroes, towns, monsters; draw order; player colors;
   animation timings verified against captures.
2. **Platform adapters** — plain browser (file picker / drag-and-drop), Wallpaper Engine,
   Lively Wallpaper, KDE Plasma wallpaper plugin; pause/visibility handling; scale setting
   (32px default); packaging without any game files.
3. **Complete edition save files** — research spike first (format is only partly documented);
   load into the existing world-state model.
4. **Interactive extras** — idle/mouse map scrolling, defeating monsters/heroes, capturing towns
   and mines; implemented as simulation events.
5. **HotA support** — only after base-game fidelity checks pass: HotA LOD (incl. 1.8+ encrypted
   names), HotA H3M versions, HotA saves. `[HotA] The Devil Is in the Detail.h3m` (252×252) is
   the stress-test map.

## Housekeeping

- Refresh or drop `.opencode/skills/developing-preact` if the foundation plan removes Preact.
