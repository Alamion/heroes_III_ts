# Data Model: Reference Environment

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

All types live in `tools/reference-env/model/`. JSON shapes are formalised in
[contracts/capture-record.schema.json](contracts/capture-record.schema.json). Coordinates:
tiles are 0-based `(x, y)` with `level` `0` = surface, `1` = underground; pixels are 0-based
screen coordinates of the virtual display.

## ReferenceConfig

Machine-local configuration. Source precedence: environment variable → `reference-env.config.json`
(repo root, git-ignored) → default. Example committed as `reference-env.config.example.json`.

| Field | Env var | Default | Rule |
|---|---|---|---|
| `bundleDir` | `H3REF_BUNDLE_DIR` | — (required) | Complete folder; must contain `Heroes3.exe`, `h3maped.exe`, `Data/` |
| `wineBinary` | `H3REF_WINE` | `wine` | executable on PATH or absolute path |
| `stateDir` | `H3REF_STATE_DIR` | `$XDG_STATE_HOME/h3-reference` | outside the repo; holds prefix, staging roots, calibration, lock |
| `capturesDir` | `H3REF_CAPTURES_DIR` | `<repo>/reference-captures` | must be git-ignored |
| `mapSearchDirs` | — | `[<repo>/public/dev-assets, <bundleDir>/Maps]` | maps resolved by file name |
| `timeouts` | — | still 120 s, clip 60 s + duration, editor 120 s, step 30 s, lock wait 300 s | positive integers |
| `expectedHashes` | — | recorded by `ref setup` | sha256 of `Heroes3.exe`, `Heroes3_HD.exe`, `h3maped.exe`, original data archives |

## SettingsProfile (data module)

Typed constant describing fixed game settings (R4): registry key, list of `{ name, type, value,
purpose }`, cheat texts (`nwctheone`, fallback `nwcwhatisthematrix`), message-line key, and the pinned HD
Mod vanilla profile (`sod.ini` key/value list) used only when the HD Mod fallback is selected. Version
string `profileId` is copied into every record.

## Calibration (local, git-ignored)

Stored in `<stateDir>/calibration.json`, produced by `ref calibrate`, never committed
(derived from game output).

| Field | Meaning |
|---|---|
| `gameLayout` | viewport rect, 32 px grid origin, visible columns/rows, minimap rect and side, view-rectangle color, shroud color, level-switch control, cursor park point |
| `navigation` | per-step click points and probe signatures (region + hash) |
| `editorLayout` | same for the editor, plus overlay toggles |
| `gameExecutable` | `original` \| `hd-mod` (Spike S0 result) |
| `positioningMethod` | `minimap-click` (confirmed) \| `minimap-click+arrows` \| `anchor+arrows` |
| `gameExeSha256`, `editorExeSha256` | build the calibration belongs to; mismatch ⇒ recalibrate |

## CaptureRequest

| Field | Type | Rule |
|---|---|---|
| `source` | `game` \| `editor` | — |
| `kind` | `still` \| `clip` | `clip` only with `source = game` |
| `map` | string | file name found in `mapSearchDirs`, or path |
| `level` | `0` \| `1` | `1` requires map with underground |
| `target` | `{ x, y }` | inside map bounds |
| `durationMs` | integer | clip only, 500–60000 |
| `overlays` | string[] | editor only; default `[]` |
| `start` | `fixed` \| `random` | game only; default `fixed` (FR-009a) |

Derived: `mapFile { name (NFC), sha256, sizeTiles, hasUnderground, formatVersion }` — size,
underground and version read from the H3M header by a minimal bounds-checked header reader in
the tooling (enough to validate the request; not the full project parser).

## CaptureRecord (`record.json`)

| Field | Type | Notes |
|---|---|---|
| `schemaVersion` | `1` | — |
| `id` | string | directory name |
| `createdAt` | ISO-8601 UTC | — |
| `source`, `kind` | enums | from request |
| `map` | `{ name, key, sha256, sizeTiles, hasUnderground, formatVersion }` | `key` = folder name |
| `level` | `0 \| 1` | — |
| `requested` | `{ x, y }` | — |
| `visible` | `{ x0, y0, x1, y1, partialEdges }` | inclusive tile range actually on screen (FR-011) |
| `mapping` | `{ tileSize: 32, originTile: {x,y}, originPixel: {x,y}, viewport: {x,y,w,h} }` | pixel of tile `(tx,ty)` = `originPixel + (t - originTile) * 32` |
| `positionSource` | `minimap-rect` \| `editor-view` | how `visible` was obtained |
| `startSetup` | `{ mode: "fixed", choices: { town, hero, bonus } }` \| `{ mode: "random" }` | game captures only |
| `visibility` | `{ method: "cheat", code, verified: true }` \| `{ method: "editor" }` | FR-010 |
| `cursor` | `{ drawnByX: false, parkedAt: {x,y} \| null }` | — |
| `executable` | `{ file, sha256, label }` | label `Heroes3.exe (original)`, `Heroes3_HD.exe (HD Mod vanilla profile)`, or `h3maped.exe (original)` |
| `archives` | `{ file, sha256 }[]` | archives visible in staging root |
| `settings` | `{ profileId, values }` | read back after launch |
| `display` | `{ width, height, depth }` | — |
| `files` | `{ still?, volatileMask?, frames?, timeline? }` | relative paths |
| `clip` | `{ grabFps, durationMs, distinctFrames, shortestStepMs, resolvesAllSteps }` | clip only |
| `tooling` | `{ version, gitCommit, wine, ffmpeg, xvfb, xdotool }` | — |

Validation: `visible` contains `requested` unless the record sets `clamped: true`; all file
paths exist; hashes are 64 hex chars.

## FrameTimeline (`frames.json`)

`{ grabFps, frames: [{ index, file, tStartMs, tEndMs, md5 }] }`, sorted, contiguous
(`tEndMs[i] = tStartMs[i+1]`), `tStartMs[0] = 0`. Lookup "frame at t" = the frame with
`tStartMs ≤ t < tEndMs`.

## CaptureQuery / CaptureMatch

Query: `{ map (name or key), level, region {x0,y0,x1,y1}, source?, kind?, limit? }`.
Match: `{ id, dir, record, crop: {x,y,w,h} }` where `crop` is the pixel rectangle of `region` in
that capture. Only captures whose `visible` range fully contains `region` match; sorted by
`createdAt` descending; empty array ⇒ explicit "no capture" result.

## DoctorReport

`{ ok, checks: [{ id, status: "pass"|"fail"|"warn"|"skip", detail, fix? }] }`. Check ids:
`config`, `bundle-found`, `game-exe-hash`, `editor-exe-hash`, `archives-hash`, `bundle-unchanged`,
`wine`, `xvfb`, `xdotool`, `ffmpeg`, `prefix`, `staging-root`, `settings-profile`,
`no-hota-loaded`, `hd-mod-state` (not loaded, or loaded with verified vanilla profile), `calibration`, `maps-reachable`, `captures-gitignored`,
`config-gitignored`, `lock`.

## State transitions — capture run

```text
requested → locked → display-up → staged → launched → at-adventure-map (or editor-open)
  → revealed → positioned → verified-position → grabbed → recorded → cleaned-up
any state --timeout/error--> failed → cleaned-up   (no record dir left behind)
```

Each failure carries a typed error code: `CONFIG_INVALID`, `PREREQ_MISSING`, `HASH_MISMATCH`,
`LOCKED`, `DISPLAY_FAILED`, `LAUNCH_TIMEOUT`, `NAVIGATION_TIMEOUT`, `MAP_UNSUPPORTED`,
`REVEAL_FAILED`, `POSITION_MISMATCH`, `GRAB_FAILED`, `CALIBRATION_MISSING`.
