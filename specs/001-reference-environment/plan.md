# Implementation Plan: Reference Environment

**Branch**: `001-reference-environment` | **Date**: 2026-09-13 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/001-reference-environment/spec.md`

## Summary

Scripted, invisible capture of reference material from the original game. A `yarn ref` CLI
(TypeScript run directly by Node 22, no npm dependencies) stages the original SoD `Heroes3.exe`
with the Complete data archives in a local staging root and a dedicated Wine prefix, runs it on
an Xvfb virtual display, drives it with `xdotool` (menus → map → `nwctheone` → position), grabs
stills and deduplicated animation clips with `ffmpeg`, reads the actual view back from the
minimap view rectangle, and stores each capture with a JSON record under the git-ignored
`reference-captures/`. The original map editor `h3maped.exe` provides placement captures. A doctor
command verifies prerequisites, hashes, and that HotA is never loaded (HD Mod only as a
documented fallback).

Already confirmed by the developer (2026-09-14): `nwctheone`/`nwcwhatisthematrix` reveal the
map; a minimap click centers the view; the view is a dashed red rectangle on the minimap. Still
resolved by spikes at the start of implementation: whether the original `Heroes3.exe` accepts
input on Xvfb or the HD Mod fallback is needed (S0), settings values (S1), menu coordinates
(S2), message-line key (S3), cursor behaviour (S4), minimap geometry and rectangle detection
(S5), editor control (S6).
See [research.md](research.md).

## Technical Context

**Language/Version**: TypeScript (strict, erasable syntax only), executed by Node 22.22 native
type stripping

**Primary Dependencies**: none new in npm. System (dev machine only): Wine 11 (installed),
ffmpeg (installed), `xorg-x11-server-Xvfb` and `xdotool` (to install; Fedora 42 repos)

**Storage**: files — `reference-captures/` (git-ignored) for captures + `record.json`;
`~/.local/state/h3-reference/` for Wine prefix, staging roots, calibration, lock

**Testing**: Vitest unit tests with synthetic buffers/fixtures; live self-check gated by
`H3REF_LIVE=1`, skipping with a message when the doctor fails

**Target Platform**: Linux development machine (Fedora 42, KDE Plasma Wayland); game under Wine
on Xvfb

**Project Type**: developer CLI tooling inside the existing repo (not part of the wallpaper
runtime)

**Performance Goals**: still ≤ 2 min end to end (SC-001); doctor ≤ 30 s (SC-005); clip grab at
60 fps

**Constraints**: never visible on or interfering with the desktop session; no writes to the
game bundle or `~/.wine`; nothing game-derived committed (including calibration signatures);
one capture at a time

**Scale/Scope**: tens to low hundreds of captures; maps ≤ 144×144 for exact minimap readback
(larger maps only arrive with HotA, out of scope)

## Constitution Check

*Checked against constitution v1.1.0 (amended in this feature: baseline obtained from a local
install and run under plain Wine; HotA editor allowed for labeled placement-only captures).*

| Principle | Status | Evidence |
|---|---|---|
| I. User-Supplied Assets Only | ✅ | Captures in git-ignored `reference-captures/`; prefix, staging roots and calibration in `~/.local/state/` outside the repo; `reference-env.config.json` git-ignored; doctor checks ignore rules; no game data in fixtures (synthetic buffers only). |
| II. Fidelity to the Complete Edition | ✅ (conditional) | Game captures from original `Heroes3.exe` + original archives via whitelist staging; load log proves HotA never loaded; hashes in every record; editor captures from original `h3maped.exe`; native 800×600, no scaling. **Gate**: if Spike S0 selects the HD Mod fallback, Principle II is violated until a constitution amendment is approved (task in Phase 2); records are labeled HD Mod either way. |
| III. Script-Verifiable by Default | ✅ | This feature is the enabler: non-interactive CLI, JSON output, `selfcheck` for reproducibility and position agreement; unit tests for all pure logic. Rendering determinism clauses apply to the wallpaper, not to the original game (its wall-clock timing is recorded in clip timelines instead). |
| IV. Screen-Bound Performance | N/A | Dev tooling; nothing ships in the wallpaper runtime. |
| V. Platform-Agnostic Core, Linux-First | ✅ | Linux-only tooling, paths from config/env, no Windows host paths; core `src/` untouched; baseline under Wine per v1.1.0. |
| VI. Layered Architecture | ✅ | Tooling lives in `tools/`, outside the wallpaper layers; game data tables (settings profile, navigation steps, layout types) in typed data modules. |
| VII. Robust Parsing, Honest Failure | ✅ | Minimal H3M header reader is bounds-checked with typed errors; every step has a timeout and typed error code; failures clean up and leave no partial record. |
| VIII. Lean Dependencies | ✅ | Zero new npm packages; system tools are dev-only and justified in research R2/R3/R10. |

**Gate result (pre-research)**: pass after amendment 1.1.0. **Post-design re-check**: pass — the
data model and contracts introduce no committed derived data (calibration is local), no runtime
dependencies, and keep the bundle read-only.

**Post-implementation compliance review (2026-09-14):** Spike S0 selected the original `Heroes3.exe`,
so the Principle II gate was never triggered and no HD Mod code exists; constitution v1.1.0 holds.
Accepted deviations (random map objects as floating tiles, editor per-launch animation frames) are
recorded in spec.md.

## Project Structure

### Documentation (this feature)

```text
specs/001-reference-environment/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── cli.md
│   └── capture-record.schema.json
├── checklists/requirements.md
└── tasks.md             # /speckit-tasks
```

### Source Code (repository root)

```text
tools/reference-env/
├── cli.ts                  # argument parsing, JSON output, exit codes
├── log.ts                  # level-gated stderr logger
├── errors.ts               # typed RefError + codes
├── config.ts               # ReferenceConfig resolution (env → file → defaults)
├── model/                  # CaptureRequest, CaptureRecord, FrameTimeline, DoctorReport types + validators
├── data/
│   ├── settings-profile.ts # registry values, cheat text, message-line key
│   ├── staging-whitelist.ts# files linked into the staging roots
│   └── navigation.ts       # step definitions (coordinates filled from calibration)
├── env/
│   ├── xvfb.ts             # start/stop virtual display
│   ├── wine.ts             # prefix, launch, loaddll log, wineserver -k
│   ├── staging.ts          # staging roots, map placement, bundle manifest
│   ├── input.ts            # xdotool wrapper
│   ├── grab.ts             # ffmpeg still/raw/clip grabs
│   └── lock.ts
├── analysis/
│   ├── stability.ts        # wait-until-stable
│   ├── minimap.ts          # shroud check, view-rectangle detection
│   ├── volatile-mask.ts
│   ├── frame-timeline.ts   # dedup + timeline
│   ├── register.ts         # game-vs-editor 32 px registration (selfcheck)
│   └── h3m-header.ts       # size, underground, version
├── commands/               # doctor, setup, calibrate, still, clip, editor, find, list, prune, selfcheck
└── store/                  # capture dirs, atomic write, lookup, prune

test/reference-env/         # Vitest unit tests + live self-check (H3REF_LIVE=1)
reference-env.config.example.json
```

Repo changes: `package.json` script `ref`; `tsconfig.node.json` includes `tools/**/*.ts`;
`vite.config.ts` test include adds `test/reference-env/**`; `.gitignore` adds
`reference-env.config.json`; AGENTS.md commands section gains `yarn ref …`.

**Structure Decision**: a separate `tools/reference-env/` tree, because this is developer tooling
that must not be entangled with the wallpaper `src/` that the foundation rewrite (TODO item 2)
will replace. Tests stay under the existing `test/` root.

## Implementation Order

1. Skeleton: config, errors, logger, CLI, doctor (static checks), setup (prefix + staging).
2. Spikes S1–S4 via `calibrate --only game`: settings, navigation, cheat, cursor.
3. Spike S5 positioning discovery → `still` with minimap readback.
4. Store + `find`/`list`/`prune`.
5. `clip` with frame timeline.
6. Spike S6 → `editor`.
7. `selfcheck`, live test gating, doctor completion (load log, bundle-unchanged, calibration).
8. Docs: setup guide section in quickstart/AGENTS.md; update spec clarification if S3 changes the
   cheat code.

## Complexity Tracking

No violations with the original executable. Potential violation: HD Mod fallback (S0) — needed
only if the original `Heroes3.exe` cannot be driven under Wine; the simpler alternative (original
exe) is always tried first. Resolution path: constitution amendment, not a silent exception.
