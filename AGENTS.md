# AGENTS.md — Development Guide for heroes_iii_dynam

A live wallpaper that renders Heroes of Might and Magic III maps (terrain, objects, heroes,
towns — animated) from game files supplied by the user. Targets: plain browser, Wallpaper
Engine, Lively Wallpaper, KDE Plasma.

**The project constitution is [.specify/memory/constitution.md](.specify/memory/constitution.md).
Read it first. If this file conflicts with it, the constitution wins — fix this file.**

---

## Current State

The code in `src/` is an old proof of concept (Pixi.js + Preact, terrain only, SoD maps only)
and is scheduled for a near-complete rewrite. Do not extend its structure; use it only as a
record of what was learned. Known problems:

- `TerrainRenderer` sizes the canvas to the whole map and creates a sprite per tile per layer —
  a 252×252 map allocates a ~24000×12000 surface and crashes the GPU driver.
- Palette animation bakes a new canvas/texture per rotation step.
- `H3mReader` skips a fixed 5 bytes per object (wrong for most object types); HotA parsing fails.
- `LodReader` has no LZMA support and no name decryption for HotA 1.8+ archives.
- `DefReader` decodes through growing JS arrays (slow, memory-heavy).
- `scripts/sync.js` hardcodes a Windows Wallpaper Engine path.

The target architecture, stack, and folder layout are decided by the foundation spec under
`specs/` (see [TODO.md](TODO.md)). Until it lands, follow the constitution's principles:
layered core (formats → state → simulation → renderer → adapters), screen-bound rendering,
platform-agnostic core, script-verifiable features.

---

## Commands

```bash
yarn dev            # Vite dev server (browser dev harness)
yarn build          # Type-check + production build
yarn preview        # Preview production build
yarn test           # Vitest, run once
yarn test:watch     # Vitest, watch mode
yarn test:coverage  # Coverage report
```

`yarn sync` / `yarn sync:watch` copy `dist/` to a hardcoded Windows Wallpaper Engine folder and
do not work on Linux; they will be replaced by a platform adapter build step.

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

Never commit game files or anything derived from them (extracted frames, atlases, palettes,
caches, captures). Tests needing real game files must skip with a clear message when absent.

### Dev assets (`public/dev-assets/`)

- `H3sprite.lod` — base game sprite archive (Complete edition)
- `Arrogance.h3m` — SoD map, 36×36 with underground
- `По праву силы.h3m` — map with non-ASCII file name
- `[HotA] The Devil Is in the Detail.h3m` — HotA map, 252×252 (HotA support comes later; useful
  as a size stress test once HotA parsing exists)

### Reference material (`context/`)

| Folder | What | License → allowed use |
| --- | --- | --- |
| `homm3-parser/` | TS parsers for H3M (RoE/AB/SoD incl. object details), LOD, DEF, PCX | MIT → may port code, with attribution in a third-party notices file |
| `heroes_iii_android/` | Kotlin/libGDX Android live wallpaper (github.com/IlyaPomaskin/h3lwp): LOD/DEF/H3M readers, terrain palette rotation, rendering | No license → study only, never copy code |
| `example_wallpaper_engine/` | Someone else's Wallpaper Engine web wallpaper | Study packaging/`project.json` only |
| `wallpaper_dev_wiki/` | Wallpaper Engine web wallpaper docs (user properties, property listener, FPS limiter, debugging) | Reference |

Also: VCMI is a good format/behavior reference but is GPL — study only, never copy code.
Online Wallpaper Engine docs: <https://docs.wallpaperengine.io/>

---

## Baseline Game (fidelity reference)

- Heroes of Might and Magic III: **Complete** (GOG), unmodified. Not HD Mod, not HotA.
- On Linux: Heroic Games Launcher + Proton, per <https://h3hota.com/ru/x_linux>. The guide ends by
  launching `h3hota HD.exe`; for reference captures run the original `Heroes3.exe` instead.

---

## Wallpaper Engine Notes

- User files come in through `project.json` properties of `"type": "file"`. Do not set
  `fileType`; it blocks selection of some files.
- File property values arrive as local paths and must be resolved to `file:///` URLs.
- Wallpaper Engine is detected via `window.wallpaperPropertyListener`. Pause events arrive
  through the same listener (`setPaused`); Wallpaper Engine also freezes the process itself, but
  other hosts may not, so the core must stop rendering on pause/hidden from any adapter.

---

## Code Style

- Strict TypeScript, no `any` without a justified local comment; `import type` for type-only
  imports.
- Format parsers and simulation must not touch the DOM and must run in Node.
- Game data tables (object classes, timings, palette rotation ranges, player colors) live in
  typed data modules, not scattered literals.
- Parsers are bounds-checked and throw typed errors with file name, offset, version, and
  structure; never guess byte skips.
- Log through the project logger, never bare `console.log`; never swallow errors silently.

Note: skills under `.opencode/skills/` (e.g. `developing-preact`) predate the constitution; if a
plan drops Preact, ignore that skill.
