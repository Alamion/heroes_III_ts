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

Reference environment (captures from the original game; see below):

```bash
yarn ref doctor                                   # check prerequisites (exit 3 if any fail)
yarn ref setup [--force]                          # dedicated Wine prefix + staging root + expected hashes
yarn ref calibrate                                # record local probes, verify layout (Arrogance.h3m)
yarn ref still  --map F --level 0|1 --x N --y N [--start fixed|random]
yarn ref clip   --map F --level 0|1 --x N --y N --duration MS [--start fixed|random]
yarn ref editor --map F --level 0|1 --x N --y N [--overlay grid] [--launches N]
yarn ref find   --map F --level 0|1 --region x0,y0,x1,y1 [--source game|editor] [--kind still|clip]
yarn ref list | prune --id ID | --before ISO [--dry-run]
yarn ref selfcheck --map F [--runs 5] [--samples 10] [--floating-tiles "x,y;x,y"]
H3REF_LIVE=1 yarn test                            # also run live checks against the game (slow)
```

Every `yarn ref` command prints one JSON document on stdout; logs go to stderr.

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
  reproducibility checks (`--floating-tiles`, later from the H3M object list) and checked
  visually and less often.

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
