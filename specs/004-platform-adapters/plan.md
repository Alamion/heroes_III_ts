# Implementation Plan: Platform Adapters

**Branch**: `004-platform-adapters` | **Date**: 2026-09-17 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/004-platform-adapters/spec.md`

## Summary

Turn the engine into a wallpaper on four hosts — plain browser (published to GitHub Pages), Wallpaper
Engine, Lively and a KDE Plasma 6 plugin — with one host-neutral `WallpaperController` (settings, file
detection and reading, overlay messages in English/Russian, view placement, pause/visibility, coalesced
updates) and a thin bridge per host. The engine gains generic hooks only: injectable worker factory, user
scale ×1–×3, view placement (random default / centre / relative slider coordinates), frame limit, cache
clearing and last-wins loads. File-based hosts get a classic build with a Blob worker because `file://`
pages cannot load modules or URL workers. Settings and strings have one definition from which the WE
`project.json`, Lively properties and KDE config are generated. `yarn package` builds reproducible packages
with no game content; `yarn verify packages` and `yarn verify hosts` check them headlessly with simulated
hosts; `yarn accept kde` drives the real Plasma session. Browser and KDE are accepted on Linux; Wallpaper
Engine and Lively are built and simulated here and verified in a follow-up session on Windows against the
open questions in [research.md](research.md). KDE unknowns are measured first in spikes S2–S3.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `erasableSyntaxOnly`), ES2022 output; QML (Qt 6 / Plasma 6)
for the KDE plugin shell; Node 22 for tooling. Unchanged otherwise.

**Primary Dependencies**: runtime — none (WebGL 1.0, Worker, IndexedDB, `DecompressionStream`, Web Locks
when present). Dev — unchanged (Vite, Vitest, TypeScript, `playwright-core`). Host-side, not bundled:
Qt WebEngine / Plasma `org.kde.taskmanager` (present with Plasma), GitHub Actions `actions/checkout`,
`actions/setup-node`, `actions/upload-pages-artifact`, `actions/deploy-pages` (CI only).

**Storage**: IndexedDB `h3dynam` decode cache gains `clear()`; new IndexedDB `h3dynam-files` (browser only,
remembered user files); `localStorage["h3dynam:settings"]` (browser only). Host settings live in each host.
Reports in git-ignored `check-reports/{packages,hosts,accept}/`. No Windows-side tooling.

**Testing**: Vitest (Node) for settings validation, string parity, path→URL mapping, file-kind
classification on synthetic fixtures, view placement, coalescing/last-wins, controller state machine (with
a fake engine), manifest generators, archive writers; headless Chromium for host simulations, frame
equality with `HeadlessRenderer`, budgets on packages; `kpackagetool6` install into a temporary root;
real-host acceptance via `yarn accept kde` and quickstart §5 (Windows hosts: follow-up session).

**Target Platform**: desktop Chromium (web), Wallpaper Engine CEF, Lively WebView2, KDE Plasma 6.x Qt
WebEngine 6.x; all development, packaging and checks on Linux.

**Project Type**: single project — browser library + adapters + Node CLIs (unchanged), plus a QML package
template under `packaging/kde/`.

**Performance Goals**: constitution budgets per package: runtime JS ≤ 100 KB gz including the embedded
worker, warm start ≤ 2 s (includes re-reading user files by URL in hosts), cold ≤ 10 s, 0 frames paused or
hidden, settings effect ≤ 1 s without re-decode (SC-004).

**Constraints**: CSP without `'unsafe-inline'` (host listeners are separate `listener.js` files); map
classification never inflates a whole map on the main thread; no game content in any package (Principle I); no platform API in `src/core` or
`src/runtime` beyond generic browser APIs; `file://` hosts: classic scripts, XHR for local files, Blob
worker; WE storage best-effort (shared origin, may be wiped); Lively cannot pass Chromium flags; KDE
persistent profile must be a single object per process; no third-party network requests (CSP).

**Scale/Scope**: 4 hosts, 9 settings, 2 languages, ~12 message codes; maps up to 252×252×2; archives ~50 MB
read per host start; 2 screens for KDE sharing.

**Thresholds fixed by this plan**: settings coalescing window 150 ms; message auto-fade 10 s; browser panel
auto-hide 4 s; game-file size heuristic in packages > 2 MB; runtime size limit 102 400 gz bytes per package;
user scale 1–3 integer; slider range 0–100 step 1.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
| --- | --- | --- |
| I. User-Supplied Assets | Packages built only from repo sources; `verify packages` rejects game extensions, LOD/H3M magics, files > 2 MB; preview images generated from committed SVG/code; users supply files through host settings, picker or drop; browser remembered copies and caches stay on the user's machine and can be forgotten; Lively copies user files into the user's own wallpaper folder (host behaviour, local); names/descriptions checked for affiliation wording. | Pass |
| II. Fidelity to Complete | Adapters do not draw; ×1 frame equality with the engine checked per host (SC-006); scaling ×2/×3 is integer, nearest, default off (documented deviation, switchable, FR-010); random view position is presentation only. | Pass |
| III. Script-Verifiable | Controller state and engine stats exposed to checks via test hook; host simulations, package checks and budgets run headless on Linux; seeds and clocks injectable for frame equality; KDE acceptance partly scripted; Windows open questions listed for the follow-up session. | Pass |
| IV. Screen-Bound Performance | Pause/hidden on every host maps to engine inactive (0 callbacks); WE fps limit honoured; surface stays display × DPR at any user scale (scale changes world px per device px, not surface size); decoding stays in the worker (Blob worker in classic builds); Web Locks avoid duplicate decode across screens; budgets measured on packages. | Pass |
| V. Platform-Agnostic, Linux-First | Host APIs only in `src/adapters/<host>` and `packaging/`; engine additions are host-neutral; packaging, checks and KDE acceptance run on Linux; no Windows-only tooling is added (Windows hosts are verified by using the packages there, findings fixed in shared code). | Pass |
| VI. Layered, State-Driven | `view-placement` pure in `core/render`; `file-kind` in `runtime`; adapters import runtime/core only; layers check extended so a host adapter cannot import another host adapter, and tools may import only the DOM-free `settings.ts`/`strings.ts` of the shared kit; settings/strings are typed data modules in `adapters/shared`. | Pass |
| VII. Robust Parsing, Honest Failure | Classification reuses bounds-checked parsers; every load problem becomes a localized, non-intrusive message and a log entry; hosts never crash on bad files; unknown/old settings ignored with a debug log. | Pass |
| VIII. Lean Dependencies | No runtime dependency; archive writers and manifest generators in tools using Node built-ins; CI actions are not shipped. | Pass |

**Post-design re-check (after Phase 1)**: data model, contracts and quickstart add no runtime dependency
and no platform API below adapters. The classic build embeds the worker once (size counted per package).
**Pass** — no Complexity Tracking entries.

## Project Structure

### Documentation (this feature)

```text
specs/004-platform-adapters/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   ├── settings.md        # one settings definition → WE / Lively / KDE / browser manifests
│   ├── host-bridge.md     # controller API, per-host bridges, test hook, invariants
│   ├── engine-api.md      # engine/runtime/core additions
│   └── cli.md             # yarn package, verify packages|hosts, accept kde
├── checklists/requirements.md
└── tasks.md               # /speckit-tasks
```

### Source Code (repository root)

```text
src/core/render/view-placement.ts        # new: pure placement (random/centre/coords)
src/runtime/
├── engine.ts                            # + workerFactory, setUserScale, placeView, setFrameLimit, forgetCache, load generations
├── scheduler.ts                         # + minFrameIntervalMs
├── cache.ts                             # + clear()
├── worker.ts / decode.ts                # + Web Locks around decode
└── file-kind.ts                         # new: classifyFile
src/adapters/
├── shared/                              # host-neutral wallpaper kit (DOM allowed)
│   ├── settings.ts                      # definition, validation, defaults
│   ├── strings.ts                       # en/ru tables, language pick
│   ├── file-url.ts                      # host path → URL, readUserFile (XHR/fetch)
│   ├── overlay.ts                       # placeholder + messages
│   ├── remembered-files.ts              # browser IndexedDB h3dynam-files
│   ├── controller.ts                    # WallpaperController
│   ├── worker-factory-classic.ts        # Blob worker from embedded source
│   └── overlay.css
├── web/            index.html, main.ts, panel.ts
├── wallpaper-engine/ index.html, listener.ts (top-level classic), main.ts
├── lively/         index.html, listener.ts, main.ts
├── kde/            index.html, bridge.ts, main.ts
└── dev-harness/    unchanged (dev + render page for checks)
packaging/
├── kde/            metadata.json.tmpl, contents/ui/main.qml, SharedProfile.qml, qmldir,
│                   config.qml.tmpl, contents/config/main.xml.tmpl (filled by the generator)
└── previews/       preview.svg (original art, no game content)
.github/workflows/pages.yml              # new: checks + deploy web package from testing
vite.config.ts                           # + build flavours: harness | web (esm) | host (classic, per host entry)
tools/package/                           # new: cli.ts, build.ts, manifests/{wallpaper-engine,lively,kde}.ts, previews.ts
tools/shared/archive.ts                  # new: deterministic zip and tar.gz writers
tools/checks/
├── packages/                            # new: static package checks
├── hosts/                               # new: host simulations (web, wallpaper-engine, lively, kde)
├── budget/                              # measures packages; size rule per package
├── layers.ts                            # + host adapters may not import each other
└── all.ts                               # + packages, hosts
tools/accept/                            # new: kde.ts (local DBus/kpackagetool6)
test/core/render/view-placement.test.ts
test/runtime/{file-kind,scheduler,cache}.test.ts
test/browser/engine-adapters.test.ts
test/adapters/{settings,strings,file-url,controller}.test.ts
test/tools/{archive,manifests}.test.ts
test/fixtures/synthetic/                 # + wrong-kind/HotA-version/truncated map and archive generators
project.json                             # removed (generated into the WE package)
```

**Structure Decision**: single project; `src/adapters/shared` is an adapter-layer kit (DOM allowed), each host
folder is a thin bridge importing only `shared`, `runtime` and `core`. QML and host manifest templates live in
`packaging/` (not TypeScript, not imported by code). The dev harness remains the target of determinism and
fidelity checks; the budget check moves to packages.

## Phase outline for tasks

1. **Spikes S2–S3** (KDE) with a minimal plugin; record in research "Measurements"; adjust R3/R4/R10/R11 if a
   fact differs.
2. **Engine and runtime additions**: view placement, user scale, frame limit, cache clear, load generations,
   worker factory, Web Locks, `classifyFile`; unit tests; determinism/fidelity unchanged.
3. **Shared kit**: settings, strings, file URLs/reading, overlay, controller state machine; unit tests with a fake
   engine.
4. **Browser adapter (US2, P1)** + web build + Pages workflow + `verify hosts --host web`.
5. **Classic build + Wallpaper Engine adapter (US1, P1)**: listener, manifest generator, package, simulation.
6. **Packaging and static checks (US5)**: `yarn package`, archive writers, previews, `verify packages`, budget on
   packages, layers rule, remove root `project.json`.
7. **KDE plugin (US3)**: QML shell, generated config, bridge, profile singleton, visibility, `kpackage-valid`,
   simulation, `yarn accept kde`.
8. **Lively adapter (US4)**: listener, manifests, zip, simulation.
9. **Real-host acceptance on Linux**: browser and KDE (quickstart §5); Wallpaper Engine and Lively packages ready
   with the Windows open questions in research.md for the follow-up session.
10. **Polish**: AGENTS.md (state, layout, commands, host facts), TODO.md, user docs per host (FR-023, en/ru),
    compliance review.

## Compliance Review (after the Linux implementation, 2026-09-17)

| Principle | Implementation | Status |
| --- | --- | --- |
| I | Packages are built from repository sources only; `verify packages` rejects game extensions, LOD/gzip signatures, files > 2 MB, external URLs and affiliation wording; previews are procedural; the hygiene test covers `packaging/`, `tools/package`, `src/adapters`; the root proof-of-concept `project.json` is gone. Browser copies of user files stay in the user's IndexedDB and can be forgotten. | Pass |
| II | Adapters never draw: host simulations compare the ×1 frame of every package with the engine render page pixel by pixel; ×2/×3 are whole-pixel enlargements (browser test), ×1 is the default. | Pass |
| III | `yarn verify packages` and `yarn verify hosts` run headless on Linux (synthetic and real files); the controller is unit-tested with a fake engine; `yarn accept kde` scripts the Plasma steps. KDE accepted on the real session; real Wallpaper Engine and Lively acceptance is pending the Windows session. | Pass (Windows acceptance pending) |
| IV | Paused, hidden and covered states reach zero pending callbacks in every host simulation; WE frame limit in the scheduler; surface ≤ viewport × DPR at any scale; decoding stays in a worker (Blob worker in classic builds); Web Locks share one decode between pages; budgets measure package sizes and package start-up. | Pass |
| V | Host APIs only in `src/adapters/<host>` and `packaging/kde`; engine additions are host-neutral; all tooling runs on Linux; no Windows-side scripts. | Pass |
| VI | View placement is pure in `core/render`; file-kind in `runtime`; `yarn verify layers` enforces host isolation and the DOM-free settings/strings used by tools. | Pass |
| VII | Wrong-kind, unsupported, truncated, unreadable and missing files become localized messages and log entries in every host simulation; the page stays responsive. | Pass |
| VIII | No runtime dependency; packages ship 56–60 KB gzip of JS each (worker included). | Pass |

## Complexity Tracking

None.
