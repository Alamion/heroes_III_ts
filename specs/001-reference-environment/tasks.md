---
description: "Task list for the Reference Environment feature"
---

# Tasks: Reference Environment

**Input**: Design documents from `specs/001-reference-environment/`

**Prerequisites**: [plan.md](plan.md), [spec.md](spec.md), [research.md](research.md),
[data-model.md](data-model.md), [contracts/cli.md](contracts/cli.md),
[contracts/capture-record.schema.json](contracts/capture-record.schema.json),
[quickstart.md](quickstart.md)

**Tests**: Included. Constitution Principle III and FR-021 require automated checks. Unit tests use
synthetic buffers/fixtures only (no game files, Principle I); live tests run only with
`H3REF_LIVE=1` and skip with a message when `yarn ref doctor` fails.

**Organization**: Grouped by user story. Story 4 (setup + doctor, P1) comes before Story 1
(still capture, P1) because every capture depends on it.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on unfinished tasks)
- **[Story]**: US1–US5 from spec.md

## Conventions for every task

- Code lives under `tools/reference-env/`, tests under `test/reference-env/`; run TypeScript
  directly with Node 22 (`node tools/reference-env/cli.ts`). Use `.ts` extensions in imports,
  `import type` for types, erasable syntax only (no `enum`, no parameter properties, no
  namespaces). No new npm dependencies.
- Pure logic takes buffers/objects and returns values (no process spawning) so it is unit-testable.
  Process wrappers use `node:child_process` `spawn` with argument arrays (never shell strings).
- Errors: throw `RefError` from `tools/reference-env/errors.ts` with a code from data-model.md.
  Logging: only via `tools/reference-env/log.ts` (stderr). stdout: only the command's JSON result.
- Never write inside `bundleDir` or `~/.wine`. Anything derived from game output (calibration,
  probe hashes, captures) goes to `stateDir` or `capturesDir` — never into the repo tree outside
  git-ignored folders.
- Spike tasks (S0–S6) record measured values in `<stateDir>/calibration.json` and write a short
  findings note to `specs/001-reference-environment/research.md` (append under a
  "Spike results" heading; text only, no images or hashes of game output).

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repository wiring and system prerequisites

- [X] T001 Ask the developer to run `sudo dnf install xorg-x11-server-Xvfb xdotool` (Wine and ffmpeg are already installed), then verify with `Xvfb -help`, `xdotool version`, `ffmpeg -version`, `wine --version`; record the versions in the "Spike results" section of specs/001-reference-environment/research.md
- [X] T002 Create directories tools/reference-env/{model,data,env,analysis,commands,store} and test/reference-env/ (directories only; files are added by later tasks, no barrel `index.ts` files)
- [X] T003 [P] Add `"ref": "node tools/reference-env/cli.ts"` to scripts in package.json
- [X] T004 [P] Add `"tools/**/*.ts"` to `include` in tsconfig.node.json so `yarn build` (`tsc -b`) type-checks the tooling
- [X] T005 [P] Extend `test.include` in vite.config.ts to `['test/**/*.test.ts']` covering test/reference-env/ (keep existing pattern working)
- [X] T006 [P] Add `reference-env.config.json` to .gitignore (next to the existing `reference-captures/` entry)
- [X] T007 [P] Create reference-env.config.example.json with `bundleDir` = `"/home/<user>/.wine/drive_c/Games/Heroes of Might and Magic III Complete"`, `wineBinary` = `"wine"`, and commented-by-key documentation fields (`"_comment_bundleDir"` etc.) for `stateDir`, `capturesDir`, `mapSearchDirs`, `timeouts` per data-model.md ReferenceConfig

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core modules every command uses

**⚠️ CRITICAL**: No user story work can begin until this phase is complete

- [X] T008 [P] Implement `RefError` (fields: `code`, `message`, `step?`, `details?`) and a `const ERROR_CODES` object with all codes from data-model.md (`CONFIG_INVALID`, `PREREQ_MISSING`, `HASH_MISMATCH`, `LOCKED`, `DISPLAY_FAILED`, `LAUNCH_TIMEOUT`, `NAVIGATION_TIMEOUT`, `MAP_UNSUPPORTED`, `REVEAL_FAILED`, `POSITION_MISMATCH`, `GRAB_FAILED`, `CALIBRATION_MISSING`) plus `INPUT_IGNORED` for S0, in tools/reference-env/errors.ts
- [X] T009 [P] Implement level-gated stderr logger (`error|warn|info|debug`, set once from CLI `--log-level`) in tools/reference-env/log.ts
- [X] T010 [P] Define TypeScript types `ReferenceConfig`, `CaptureRequest`, `CaptureRecord`, `FrameTimeline`, `CaptureQuery`, `CaptureMatch`, `DoctorReport`, `Calibration` exactly as in data-model.md and contracts/capture-record.schema.json, in tools/reference-env/model/types.ts
- [X] T011 [P] Implement `validateRecord(value: unknown): CaptureRecord` (hand-written checks mirroring contracts/capture-record.schema.json: required fields, enums, 64-hex hashes, `visible` contains `requested` unless `clamped`) throwing `RefError(CONFIG_INVALID)` with the failing path, in tools/reference-env/model/validate-record.ts
- [X] T012 [P] Unit tests for `validateRecord` (valid minimal record, each enum violation, bad hash, requested outside visible without `clamped`) in test/reference-env/validate-record.test.ts
- [X] T013 Implement `loadConfig(env, repoRoot)` with precedence env var → `reference-env.config.json` → defaults (`stateDir` = `$XDG_STATE_HOME/h3-reference` or `~/.local/state/h3-reference`; `capturesDir` = `<repo>/reference-captures`; `mapSearchDirs` = `[<repo>/public/dev-assets, <bundleDir>/Maps]`; timeouts from data-model.md); reject `stateDir` inside the repo, in tools/reference-env/config.ts
- [X] T014 [P] Unit tests for `loadConfig` (env overrides file, defaults, missing `bundleDir` → `CONFIG_INVALID`, `stateDir` inside repo rejected) using a temp dir in test/reference-env/config.test.ts
- [X] T015 [P] Implement `runProcess(cmd, args, { env, cwd, timeoutMs, input? })` returning `{ code, stdout: Buffer, stderr: string }` and `spawnLongRunning(...)` returning a handle with `kill()`, killing the process group on timeout, in tools/reference-env/env/process.ts
- [X] T016 [P] Implement bounds-checked H3M header reader `readH3mHeader(bytes, fileName)` → `{ formatVersion: 'RoE'|'AB'|'SoD', sizeTiles, hasUnderground }`: gunzip if the file starts with `1f 8b` (use `node:zlib`), read u32 version (`0x0E` RoE, `0x15` AB, `0x1C` SoD; anything else → `RefError(MAP_UNSUPPORTED)` with offset and version), then `hasHero` u8, `size` u32, `twoLevel` u8, in tools/reference-env/analysis/h3m-header.ts
- [X] T017 [P] Unit tests for `readH3mHeader` with synthetic gzipped and raw byte arrays (SoD 36×36 two-level, RoE single level, HotA version `0x20` rejected, truncated file → error with offset) in test/reference-env/h3m-header.test.ts
- [X] T018 [P] Implement `sha256File(path)` (streaming) and `mapKey(fileName, sha256)` = NFC name without extension + `-` + first 8 hex chars; replace `/` and control chars with `_`, keep other Unicode, in tools/reference-env/store/identity.ts
- [X] T019 [P] Unit tests for `mapKey` (ASCII, `По праву силы.h3m` stays Cyrillic, NFD input normalised to NFC, slash replaced) in test/reference-env/identity.test.ts
- [X] T020 [P] Implement single-capture lock: `acquireLock(stateDir, waitMs)` creates `<stateDir>/capture.lock` with `{ pid, startedAt, command }` via exclusive create (`wx`), polls every 1 s until `waitMs`, takes over when the PID is dead (warn), else throws `RefError(LOCKED)`; `release()` removes only its own lock, in tools/reference-env/env/lock.ts
- [X] T021 [P] Unit tests for the lock (acquire/release, second acquire times out with `LOCKED`, stale PID takeover) in test/reference-env/lock.test.ts
- [X] T022 [P] Implement Xvfb wrapper `startDisplay({ width, height, depth })`: spawn `Xvfb -displayfd <fd> -screen 0 WxHxD -nolisten tcp`, read the display number from the fd, wait until `xdpyinfo`-free readiness (poll `xdotool getdisplaygeometry` with `DISPLAY` set), return `{ display: ':N', stop() }`; failure → `RefError(DISPLAY_FAILED)`, in tools/reference-env/env/xvfb.ts
- [X] T023 [P] Implement xdotool wrapper bound to a display: `click(x, y, button=1)` (mousemove then click), `move(x, y)`, `key(name)`, `type(text, delayMs=60)`, `getMouse()`; always pass `DISPLAY` in env, never the developer's display, in tools/reference-env/env/input.ts
- [X] T024 [P] Implement ffmpeg grab wrapper: `grabRaw(display, rect)` → `{ width, height, rgb: Buffer }` (`-f x11grab -draw_mouse 0 -video_size WxH -i :N+x,y -frames:v 1 -f rawvideo -pix_fmt rgb24 -`), `grabPng(display, rect, outPath)`, `writePng(rgb, width, height, outPath)` (ffmpeg rawvideo → png), in tools/reference-env/env/grab.ts
- [X] T025 Implement Wine wrapper: `ensurePrefix(stateDir)` (`WINEPREFIX=<stateDir>/prefix`, `WINEARCH` default, run `wineboot -u` once, set `HKCU\Software\Wine\Drivers` `Graphics`=`x11` via `wine reg add`), `launch(exePath, args, { display, cwd, loadDllLog: boolean })` with `WAYLAND_DISPLAY` removed from env and `WINEDEBUG=+loaddll` when requested (log to `<stateDir>/logs/<timestamp>-loaddll.log`), `killAll()` = `wineserver -k` for that prefix only, `regImport(regFile)`, `regQuery(key)`, in tools/reference-env/env/wine.ts (depends on T015)
- [X] T026 Implement `parseLoadedDlls(logText)` → lowercase DLL base names and `assertNoForbiddenDlls(names, { allowHdMod })` (forbidden always: `hota.dll`, `hota_me.dll`, `hw_hota.dll`, `hd_hota.dll`; forbidden unless `allowHdMod`: `_hd3_.dll`, `patcher_x86.dll`, `hd_*.dll`, `hw_sod.dll`) in tools/reference-env/analysis/loaddll.ts
- [X] T027 [P] Unit tests for `parseLoadedDlls`/`assertNoForbiddenDlls` with a synthetic Wine `+loaddll` log in test/reference-env/loaddll.test.ts
- [X] T028 [P] Implement `waitUntilStable(grabFn, { consecutive: 3, intervalMs: 250, timeoutMs, step })` comparing raw buffers byte-for-byte, and `regionHash(rgb, width, rect)` (sha1 of the cropped bytes) in tools/reference-env/analysis/stability.ts
- [X] T029 [P] Unit tests for `waitUntilStable` (stabilises after changes; times out with `NAVIGATION_TIMEOUT` and `step`) using a fake grab function in test/reference-env/stability.test.ts
- [X] T030 Implement CLI entry: parse `<command>` and `--key value` / repeatable flags, `--log-level`, dispatch to `commands/<name>.ts`, print exactly one JSON document to stdout, map outcomes to exit codes (0 ok, 1 `RefError`, 2 usage, 3 `PREREQ_MISSING`) per contracts/cli.md, in tools/reference-env/cli.ts
- [X] T031 [P] Unit tests for CLI argument parsing and exit-code mapping (import the pure `parseArgs`/`exitCodeFor` helpers) in test/reference-env/cli.test.ts

**Checkpoint**: `yarn test` passes and `yarn build` type-checks tools; `yarn ref foo` prints a usage-error JSON and exits 2.

---

## Phase 3: User Story 4 - One-time setup and doctor (Priority: P1) — prerequisite for all captures

**Goal**: `yarn ref setup` builds the dedicated prefix and staging root, `yarn ref calibrate --only game` decides the executable (S0) and navigation (S1–S2), and `yarn ref doctor` reports every prerequisite.

**Independent Test**: `yarn ref doctor` exits 0 with all checks `pass`; `H3REF_BUNDLE_DIR=/nonexistent yarn ref doctor` exits 3 naming `bundle-found` (quickstart.md "Setup and verification").

### Tests for User Story 4

- [X] T032 [P] [US4] Unit tests for staging plan generation (T034): whitelist resolution is case-insensitive against a fake bundle tree, never includes `HotA*`/`hota*` files, includes HD Mod files only when `mode = 'hd-mod'`, and `Maps/` contains only the requested map, in test/reference-env/staging.test.ts
- [X] T033 [P] [US4] Unit tests for doctor check aggregation (`ok` false if any `fail`; `warn` does not fail; each failing check carries `fix`) using injected fake check functions, in test/reference-env/doctor.test.ts

### Implementation for User Story 4

- [X] T034 [P] [US4] Define the staging whitelist data module: game files `Heroes3.exe` (copied), `h3maped.exe` (copied), DLLs `binkw32.dll`, `smackw32.dll`, `mss32.dll`, `mp3dec.asi`, `ifc20.dll`, `dpwsockx.dll`, `zdraw.dll` (symlinked; `zdraw.dll` is required by this `Heroes3.exe`, see research.md Spike results), `Data/` archives `h3bitmap.lod`, `h3sprite.lod`, `h3ab_bmp.lod`, `h3ab_spr.lod`, `heroes3.snd`, `h3ab_ahd.snd`, `video.vid`, `h3ab_ahd.vid` (symlinked, case-insensitive match; the extra `bitmap.lod`/`sprite.lod`/`lbitmap.lod`/`lsprite.lod`/`sound.snd` are added only if S0 shows the executable opens them), `Mp3/` (symlinked); separate `HD_MOD_FILES` list (`Heroes3_HD.exe`, `_HD3_.dll`, `HD_*.dll`, `HW_SOD.dll`, `patcher_x86.dll`, `patcher_x86.ini`, `_HD3_Data/` except `Settings/`) used only in `hd-mod` mode, in tools/reference-env/data/staging-whitelist.ts
- [X] T035 [US4] Implement staging: `planStaging(bundleDir, mode, mapPath)` (pure, returns list of `{ kind: 'copy'|'symlink'|'mkdir'|'write', from?, to }`) and `applyStaging(plan, stagingRoot)` that rebuilds `<stateDir>/game-root/` idempotently (copies only when hash differs, creates empty `Games/`, clears and fills `Maps/` with the one map), plus `bundleManifest(bundleDir)` = sorted `{ relPath, size, mtimeMs }` for top-level files and `Data/`, in tools/reference-env/env/staging.ts
- [X] T036 [P] [US4] Define the settings profile data module: `profileId` (`"ref-2026-09-14-v1"`), SoD registry key `HKCU\Software\New World Computing\Heroes of Might and Magic® III\1.0` with value list left as a typed TODO array to be filled by T041, cheat codes `['nwcwhatisthematrix', 'nwctheone']` (only the first works on the original Russian build), `messageLineKey: 'Tab'`, `holdCtrlWhileTyping: true`, `keyDelayMs: 120`, and `HD_MOD_VANILLA_PROFILE` key/values for `sod.ini` (`Graphics.Resolution = 800x600`, `Graphics.DD.Scaling = 0`, `Graphics.GDI.Scaling = 0`, `Graphics.OpenGL.Scaling = 0`, `HD+ = 0`, `Fix.Cosmetic = 0`, `UI.AdvMgr.HigherFPS = 0`, `UI.DarkTransitions = 0`, `UI.AdvMgr.SkipMapMsgs = 0`, `UI.AdvMgr.DragMap = 0`, `Graphics.SystemCursors = 1`, `Sys.WriteToIniInsteadRegistry = 1`, `Graphics.MaximizedMode = 0`), in tools/reference-env/data/settings-profile.ts
- [X] T037 [US4] Implement `yarn ref setup`: load config, verify `bundleDir` contains `Heroes3.exe`, `h3maped.exe`, `Data/`; `ensurePrefix`; build the staging root in `original` mode for `Arrogance.h3m`; compute and store `expectedHashes` (sha256 of `Heroes3.exe`, `Heroes3_HD.exe` if present, `h3maped.exe`, whitelisted archives) and `bundleManifest` in `<stateDir>/setup.json`; print `{ ok, prefix, stagingRoots, hashes }`; `--force` rebuilds the prefix, in tools/reference-env/commands/setup.ts
- [X] T038 [US4] Implement doctor checks as individual functions returning `{ id, status, detail, fix? }` for every id in data-model.md DoctorReport: `config`, `bundle-found`, `game-exe-hash`, `editor-exe-hash`, `archives-hash`, `bundle-unchanged` (manifest vs setup.json), `wine`, `xvfb`, `xdotool`, `ffmpeg` (version probes), `prefix`, `staging-root`, `settings-profile` (regQuery vs profile, or `sod.ini` in staging for hd-mod), `no-hota-loaded` and `hd-mod-state` (latest loaddll log from calibration), `calibration` (exists and exe hashes match), `maps-reachable` (`Arrogance.h3m` and `По праву силы.h3m` resolvable), `captures-gitignored` and `config-gitignored` (`git check-ignore`), `lock` (no live foreign lock) — whole run under 30 s, in tools/reference-env/commands/doctor-checks.ts
- [X] T039 [US4] Implement `yarn ref doctor` aggregating T038 checks into `DoctorReport`, human-readable lines to stderr, JSON to stdout, exit 3 when any check fails; export `requirePrereqs(ids)` so capture commands fail fast with the same diagnostics (Story 4 scenario 3), in tools/reference-env/commands/doctor.ts
- [X] T040 [US4] **Spike S0 — executable selection.** Implement `calibrate --only game --step executable`: start an 800×600×24 display, launch staged original `Heroes3.exe` with loaddll log, wait for the screen to stabilise (skip intro with `Escape` up to 5 times), then press a menu button and check the screen changed (`regionHash` before/after). If unchanged, relaunch under `wine explorer /desktop=h3ref,800x600 Heroes3.exe` and repeat. If still unchanged, restage in `hd-mod` mode, write `HD_MOD_VANILLA_PROFILE` into the staging copy of `_HD3_Data/Settings/sod.ini` (never the bundle), launch `Heroes3_HD.exe` directly and repeat. Save full-screen PNGs of each attempt to `<stateDir>/spikes/s0/`, store `gameExecutable` and launch mode (`direct`|`virtual-desktop`) in calibration.json, append results to research.md "Spike results", in tools/reference-env/commands/calibrate.ts and tools/reference-env/commands/calibrate-executable.ts
- [X] T041 [US4] **Spike S1 — settings.** With the selected executable: for `original`, launch with a clean prefix, open the in-game System Options, change walk speed, scroll speed, music/sound volume and any intro/animation options one at a time via `xdotool`, export `HKCU\Software\New World Computing` with `wine reg export` after each change, diff the exports, and fill the value list in tools/reference-env/data/settings-profile.ts with exact names, types, and chosen values (music and sound off, default animation, fixed walk/scroll speed); for `hd-mod`, confirm each `sod.ini` key's effect (resolution 800×600 real, no scaling) by grabbing a screenshot and checking its size and pixel scale. Implement `applySettings()` (reg import or sod.ini write) and `readBackSettings()` in tools/reference-env/env/settings.ts
- [X] T042 [US4] **Spike S2 — navigation.** Measure click points at 800×600 for: intro skip, main menu *New Game*, *Single Scenario*, scenario list (one map), *Advanced options* with **fixed town, hero and starting bonus for every player** (launches are otherwise random — see research.md Spike results), *Begin*, the start-of-game dialog OK, and the adventure-map ready state. Support both start modes (FR-009a): `fixed` (default) applies the documented town/hero/bonus choices in advanced options; `random` skips that step; the choices live in tools/reference-env/data/navigation.ts and are copied into `record.startSetup`. Initial measured points: intro skip click (400, 300) after logos, New Game (645, 75), Scenario (645, 65), Begin (495, 553), intro message OK (400, 381). Record per step `{ action, point|key, probeRect }` in calibration.json and per-step probe hashes (from `regionHash`) under `navigation`; define the step sequence (names, action kinds, timeouts — no coordinates or hashes) as a typed constant in tools/reference-env/data/navigation.ts; implement `navigateToAdventureMap(ctx)` executing steps with `waitUntilStable` + probe match and `NAVIGATION_TIMEOUT` naming the step, in tools/reference-env/env/navigate.ts; verify 5/5 successful runs from a clean start and note it in research.md "Spike results"
- [X] T043 [US4] Write the setup guide section "Reference environment setup" in AGENTS.md (packages, config file, `yarn ref setup`, `yarn ref calibrate`, `yarn ref doctor`, where state and captures live, that HotA is never loaded and HD Mod only as a documented fallback) and add `yarn ref …` lines to the Commands block in AGENTS.md
- [X] T044 [US4] Constitution gate: if T040 recorded `gameExecutable = "hd-mod"`, stop and ask the developer to approve an amendment to Principle II in .specify/memory/constitution.md (allow HD Mod with the pinned vanilla profile for base-game captures, records labeled; MINOR bump with Sync Impact Report) before continuing to Phase 4; if `original`, mark this task done with a note in research.md "Spike results"

**Checkpoint**: doctor all-green; calibration has `gameExecutable` and navigation; bundle manifest unchanged.

---

## Phase 4: User Story 1 - Still capture of a map region (Priority: P1) 🎯 MVP

**Goal**: `yarn ref still --map Arrogance.h3m --level 0 --x 10 --y 12` stores a lossless viewport screenshot with a validated `record.json`, no human input.

**Independent Test**: run the same request twice; both finish unattended in < 2 min and non-volatile viewport pixels match (quickstart.md "Story validations").

### Tests for User Story 1

- [X] T045 [P] [US1] Unit tests for minimap analysis (T049) on synthetic RGB buffers: a 144×144 minimap with a dashed red rectangle at known tile edges for map sizes 36, 72, 108, 144 → exact `visible` range; rectangle clipped at map edge → `partialEdges`/clamped; shroud pixels present → `hasShroud` true, in test/reference-env/minimap.test.ts
- [X] T046 [P] [US1] Unit tests for tile geometry (T050): `tileToMinimapPoint` for sizes 36/72/144, `visibleToMapping` producing `originTile`/`originPixel`, and `cropForRegion` in test/reference-env/geometry.test.ts
- [X] T047 [P] [US1] Unit tests for volatile mask (T051): pixels changing in any of K synthetic frames are set; `compareWithMasks(a, b, maskA, maskB)` ignores masked pixels and reports differing count, in test/reference-env/volatile-mask.test.ts
- [X] T048 [P] [US1] Unit tests for atomic capture store writes (T053): directory name format `<UTC>_x<x0>-<x1>_y<y0>-<y1>`, write to `.tmp-*` then rename, failure removes temp dir, existing capture never overwritten, in test/reference-env/capture-store.test.ts

### Implementation for User Story 1

- [X] T049 [US1] **Spike S5 — minimap geometry and view rectangle.** Measure on the selected executable at 800×600: minimap rect and side length, dashed red rectangle color(s) and dash pattern, shroud color, adventure viewport rect, 32 px grid origin, visible columns/rows including partial tiles, level-switch control (button point and/or key), and edge clamping; store under `gameLayout` in calibration.json. Implement pure `findViewRect(minimapRgb, side, colors)`, `rectToVisibleTiles(rect, side, mapSize, layout)`, `hasShroud(minimapRgb, shroudColor)` in tools/reference-env/analysis/minimap.ts (colors/geometry passed in from calibration, not hardcoded)
- [X] T050 [P] [US1] Implement geometry helpers `tileToMinimapPoint(tile, mapSize, minimapRect)` = `minimapRect.x + floor((x + 0.5) * side / mapSize)` (same for y), `visibleToMapping(visible, layout)`, `cropForRegion(mapping, region)` in tools/reference-env/analysis/geometry.ts
- [X] T051 [P] [US1] Implement `buildVolatileMask(frames: Buffer[], w, h)` → 1 byte per pixel, `maskToPng` via `writePng`, and `compareWithMasks` in tools/reference-env/analysis/volatile-mask.ts
- [X] T052 [US1] **Spikes S3 + S4 — reveal and cursor.** Implement `reveal(ctx)`: press `messageLineKey`, hold Ctrl (`keydown Control_L`), send the first cheat code one key at a time with `keyDelayMs`, release Ctrl, press `Return`, wait stable, grab minimap, require `!hasShroud` else try next cheat code, else `RefError(REVEAL_FAILED)`; (`Tab` and Ctrl-hold already confirmed). The game draws a software cursor (confirmed); measure and verify the park point (initial candidate (700, 590)). Check whether the game draws a software cursor in grabs with `-draw_mouse 0`: move the mouse over the viewport and compare; if visible, measure a park point outside the viewport with no hover change and store `cursorParkPoint` in calibration.json. Code in tools/reference-env/env/reveal.ts and tools/reference-env/env/cursor.ts; findings to research.md "Spike results"
- [X] T053 [US1] Implement capture store: `resolveMap(name, mapSearchDirs)` (NFC-aware file-name match), `captureDir(capturesDir, mapKey, level, source, kind, createdAt, visible)` per research.md R9, `writeCaptureAtomically(dir, files, record)` (validate with `validateRecord` before rename), in tools/reference-env/store/capture-store.ts
- [X] T054 [US1] Implement `positionView(ctx, level, target)`: switch level if needed using calibration control, click `tileToMinimapPoint`, park cursor, wait stable, read `findViewRect` → visible tiles; if the visible range does not contain the target and the map edge does not explain it → `RefError(POSITION_MISMATCH)`; set `clamped` when edge-limited, in tools/reference-env/env/position.ts
- [X] T055 [US1] Implement `yarn ref still`: `requirePrereqs` → lock → read map header (`MAP_UNSUPPORTED`, level 1 requires underground, target in bounds) → start display → stage map → apply settings → launch selected executable (loaddll log, `assertNoForbiddenDlls` with `allowHdMod` from calibration) → `navigateToAdventureMap` → `reveal` → `positionView` → grab full-screen PNG `still.png` plus 12 raw frames over 2 s for `volatile-mask.png` → build record (executable label per data-model.md, archives hashes, `readBackSettings`, tool versions, `git rev-parse HEAD`) → `writeCaptureAtomically` → always `killAll` + stop display + release lock in `finally`; overall timeout from config; print `{ ok, capture }`, in tools/reference-env/commands/still.ts
- [X] T056 [US1] Live test (skips unless `H3REF_LIVE=1` and doctor passes, with an explicit skip message): capture `Arrogance.h3m` level 0 at (10, 12) twice, assert both records validate, `visible` contains the target, runtime < 120 s each, and `compareWithMasks` reports 0 differing pixels in the viewport; also capture `По праву силы.h3m` (5, 5) and Arrogance level 1 at (0, 0) expecting `clamped: true`, in test/reference-env/live-still.test.ts

**Checkpoint**: MVP — agents can obtain reproducible stills unattended.

---

## Phase 5: User Story 2 - Animation clip (Priority: P2)

**Goal**: `yarn ref clip ... --duration 5000` stores distinct frames with a contiguous timeline.

**Independent Test**: 5 s clip of a water area → `clip.resolvesAllSteps` true, `frames.json` contiguous, water pixels change while static terrain stays constant.

### Tests for User Story 2

- [X] T057 [P] [US2] Unit tests for frame timeline (T058): identical consecutive frames merge, `tEndMs[i] = tStartMs[i+1]`, first frame starts at 0, `shortestStepMs` ignores the first and last (truncated) frames, `resolvesAllSteps` = `1000/grabFps <= shortestStepMs/2`, `frameAt(timeline, t)` picks the covering frame, in test/reference-env/frame-timeline.test.ts

### Implementation for User Story 2

- [X] T058 [P] [US2] Implement `FrameTimelineBuilder` (push raw frame + timestamp ms, md5 per frame, merge identical consecutive frames, finish → `{ frames, shortestStepMs, resolvesAllSteps }`) and `frameAt(timeline, t)` in tools/reference-env/analysis/frame-timeline.ts
- [X] T059 [US2] Implement `grabStream(display, rect, fps, durationMs, onFrame)` in tools/reference-env/env/grab.ts: ffmpeg `-f x11grab -framerate 60 -draw_mouse 0 -video_size WxH -i :N+x,y -t <s> -f rawvideo -pix_fmt rgb24 -`, split stdout into frames of `w*h*3` bytes, timestamp each by `performance.now()` relative to the first frame
- [X] T060 [US2] Implement `yarn ref clip`: same pipeline as `still` up to `positionView` (extract the shared steps from commands/still.ts into tools/reference-env/commands/session.ts and reuse them), then `grabStream` cropped to the viewport from calibration, write distinct frames as `frames/0000.png…` via `writePng`, `frames.json`, and a record with `clip` fields; validate `durationMs` 500–60000, in tools/reference-env/commands/clip.ts
- [X] T061 [US2] Live test (gated like T056): 5 s clip of a water tile region on `Arrogance.h3m` (choose the region during implementation by inspecting a still; record the coordinates in the test), assert timeline contiguous, `resolvesAllSteps` true, `distinctFrames` > 1, in test/reference-env/live-clip.test.ts

**Checkpoint**: clips usable for palette-rotation and animation-timing checks.

---

## Phase 6: User Story 3 - Map editor capture (Priority: P2)

**Goal**: `yarn ref editor ...` stores an original `h3maped.exe` still with overlays off.

**Independent Test**: two editor captures of the same region are pixel-identical in the map area and are labeled `source = editor`.

- [X] T062 [US3] **Spike S6 — editor control.** On a 1280×1024×24 display, launch staged `h3maped.exe` (loaddll log; add any DLL it needs to the whitelist in tools/reference-env/data/staging-whitelist.ts): check whether a map path argument (`Z:\...\Maps\Arrogance.h3m`) opens the map; otherwise measure File → Open and typing the path in the dialog. Measure: map view rect and 32 px grid origin, how to hide grid/passability/other overlays (menu items or registry values), level switch, editor minimap and its view indicator or scroll behaviour to position a tile, and whether the editor writes to its root (compare staging-root manifest before/after). Store under `editorLayout` in calibration.json; findings to research.md "Spike results"
- [X] T063 [US3] Implement `openMapInEditor(ctx, mapPath)`, `setOverlays(ctx, overlays)`, `positionEditorView(ctx, level, target)` returning visible tiles from the editor view (`positionSource: 'editor-view'`), in tools/reference-env/env/editor.ts
- [X] T064 [US3] Implement `yarn ref editor` (options per contracts/cli.md, default overlays off, `visibility: { method: 'editor', overlays }`, executable label `h3maped.exe (original)`, no volatile mask needed but still produce an all-zero mask for uniform comparison), reusing session steps from tools/reference-env/commands/session.ts, in tools/reference-env/commands/editor.ts
- [X] T065 [US3] Live test (gated like T056): two editor captures of `Arrogance.h3m` level 0 (10, 12) → identical map-area pixels, records validate, `source = editor`, in test/reference-env/live-editor.test.ts

**Checkpoint**: placement reference available without animation noise.

---

## Phase 7: User Story 5 - Capture lookup (Priority: P3)

**Goal**: `yarn ref find`, `list`, `prune` work on stored captures without launching anything.

**Independent Test**: with synthetic capture directories, `find` returns only containing captures newest first with correct `crop`, or `matches: []`.

- [X] T066 [P] [US5] Unit tests for lookup, list and prune on a temp captures dir with synthetic records (region containment, filters by source/kind, newest first, `limit`, map by name or key, invalid `record.json` skipped with a warning, prune refuses paths outside `capturesDir`, `--dry-run` deletes nothing) in test/reference-env/lookup.test.ts
- [X] T067 [US5] Implement `scanRecords(capturesDir)`, `findCaptures(query)` (uses `cropForRegion`), `listCaptures(filters)` with `sizeBytes`, `pruneCaptures({ ids | before, dryRun })` in tools/reference-env/store/lookup.ts
- [X] T068 [US5] Implement `yarn ref find`, `yarn ref list`, `yarn ref prune` (no lock, no Wine) per contracts/cli.md in tools/reference-env/commands/find.ts, tools/reference-env/commands/list.ts, tools/reference-env/commands/prune.ts

**Checkpoint**: fidelity checks in later features can locate reference pixels.

---

## Phase 8: Polish & Cross-Cutting Concerns

- [X] T069 Implement game-vs-editor registration for SC-003: `registerViewport(gameRgb, gameMask, editorRgb, editorMapping)` searching integer tile offsets within ±3 tiles and returning the offset with the fewest differing unmasked pixels, in tools/reference-env/analysis/register.ts, with unit tests on synthetic tile mosaics in test/reference-env/register.test.ts
- [X] T070 Implement `yarn ref selfcheck --map <file> --runs N --samples N`: N repeated stills of one target (SC-002: 0 differing unmasked pixels), then `samples` random in-bounds tiles on each level with a game still + editor still each, asserting registration offset 0 (SC-003); print `{ ok, reproducibility, positionAgreement }`, in tools/reference-env/commands/selfcheck.ts
- [X] T071 Live test wrapper for selfcheck (gated like T056, `--runs 5 --samples 10`) in test/reference-env/live-selfcheck.test.ts
- [X] T072 Concurrency check: start two `still` commands concurrently in a live test; assert the second waits for the lock and both captures succeed (or the second fails with `LOCKED` when `timeouts.lockWait` is set to 5 s), in test/reference-env/live-lock.test.ts
- [X] T073 [P] Update specs/001-reference-environment/quickstart.md with any command or option changes made during implementation and the measured spike outcomes (executable choice, message-line key)
- [X] T074 [P] If S0–S6 changed any decision (executable, cheat code, positioning), update the Clarifications/FR text in specs/001-reference-environment/spec.md and the matching sections of specs/001-reference-environment/research.md so no contradictory text remains
- [ ] T075 Run the full quickstart.md validation: `yarn build`, `yarn test`, `H3REF_LIVE=1 yarn test`, `yarn ref doctor`, the Story 1–5 commands, and confirm `git status --porcelain` shows no files from `reference-captures/`, `reference-env.config.json`, or the state directory (SC-007); record timings for SC-001 and SC-005 in research.md "Spike results"
- [X] T076 Mark TODO.md item 1 as done with a link to specs/001-reference-environment/ and a one-line note that the environment uses a local Wine install instead of Heroic/Proton/GOG

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (Phase 1)** → **Foundational (Phase 2)** → **US4 (Phase 3)** → **US1 (Phase 4)**
- **US2 (Phase 5)** and **US3 (Phase 6)** depend on US1 (shared session steps T060 refactor, positioning, staging); US2 and US3 can proceed in parallel after US1.
- **US5 (Phase 7)** depends only on Foundational (T010, T011, T018) plus T050 `cropForRegion` and T053 store; it can be built in parallel with US4/US1 using synthetic records.
- **Polish (Phase 8)**: T069–T071 need US1 + US3; T072 needs US1; T073–T076 last.

### Within phases

- T025 needs T015. T035 needs T034. T037 needs T025, T035. T040 needs T022–T025, T028, T035, T036. T041–T042 need T040. T044 needs T040.
- T049 needs T042. T052 needs T049. T054 needs T049, T050. T055 needs T051–T054, T041, T042.
- T060 needs T055, T058, T059. T063 needs T062. T064 needs T060 (session.ts), T063.
- Tests marked [P] in a story can be written before the implementation they cover.

### Parallel opportunities

- Phase 1: T003–T007 together.
- Phase 2: T008–T012, T014, T015–T024 (except wrappers depending on T015), T026–T029, T031.
- US4: T032, T033, T034, T036 together; spikes T040→T041→T042 are sequential (one game instance at a time).
- US1: T045–T048 and T050, T051 together; spike/integration tasks T049, T052, T054, T055 sequential.
- US5: entire phase can run alongside US4/US1 by a second agent (no game needed).

## Parallel Example: User Story 1

```bash
# Tests and pure modules, in parallel:
Task: "T045 Unit tests for minimap analysis in test/reference-env/minimap.test.ts"
Task: "T046 Unit tests for tile geometry in test/reference-env/geometry.test.ts"
Task: "T047 Unit tests for volatile mask in test/reference-env/volatile-mask.test.ts"
Task: "T048 Unit tests for capture store in test/reference-env/capture-store.test.ts"
Task: "T050 Geometry helpers in tools/reference-env/analysis/geometry.ts"
Task: "T051 Volatile mask in tools/reference-env/analysis/volatile-mask.ts"
# Then sequentially (needs the running game): T049 → T052 → T053 → T054 → T055 → T056
```

## Implementation Strategy

### MVP (US4 + US1)

1. Phases 1–2.
2. Phase 3: setup, doctor, spikes S0–S2; resolve the constitution gate (T044).
3. Phase 4: spikes S3–S5, `still`. **Stop and validate** with T056 and quickstart Story 1.

### Incremental delivery

1. MVP → stills usable by the foundation rewrite's terrain checks.
2. US2 clips → palette rotation / animation timing references.
3. US3 editor → placement references.
4. US5 lookup (can land earlier in parallel).
5. Polish: selfcheck (SC-002/SC-003), concurrency, docs.

### Notes

- Human involvement is limited to T001 (package install) and T044 only if the HD Mod fallback is selected.
- Commit after each task or logical group; never commit anything from `stateDir`, `reference-captures/`, `context/`, or `public/dev-assets/`.

## Implementation notes (2026-09-14)

Deviations from the task text, all reflected in code and research.md "Spike results":

- Tests are grouped by area instead of one file per task: `test/reference-env/foundation.test.ts`
  (T012, T014, T017, T019, T021, T027, T029, T031), `capture.test.ts` (T032, T033, T045–T048,
  T057), `lookup.test.ts` (T066), `register.test.ts` (T069), `live.test.ts` (T056, T061, T065,
  T071, T072; gated by `H3REF_LIVE=1`).
- UI coordinates are committed as plain numbers in `tools/reference-env/data/game-layout.ts` and
  `editor-layout.ts`; only probe hashes of game screens (scenario OK button, level toggle look)
  are local calibration (`<stateDir>/calibration.json`).
- T040 S0 selected the original executable directly (no virtual desktop), so the HD Mod fallback
  and T044's amendment were not needed; the fallback is not implemented (YAGNI).
- T041 S1: no registry overrides (clean prefix = game defaults); `settings-profile.ts` records it.
- T062–T064: the editor opens maps from the command line; it animates with per-launch frame
  choice, so `yarn ref editor --launches N` (default 3) builds the volatile mask across launches.
- T060: the shared capture pipeline is `tools/reference-env/commands/session.ts`
  (`runGameCapture`), the game session is `tools/reference-env/env/session.ts`.
- T071/T075: the reduced live selfcheck (`--runs 3 --samples 2`) passed position agreement 4/4 but
  failed reproducibility because random monsters are re-rolled per launch (open known deviation
  in spec.md). The full `--runs 5 --samples 10` run (~50 min) was not executed.
