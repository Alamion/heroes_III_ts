<!--
Sync Impact Report
==================
Version change: (unversioned template) → 1.0.0
Bump rationale: initial ratification; all principles and sections defined for the first time.

Principles (all new):
  I.    User-Supplied Assets Only (NON-NEGOTIABLE)
  II.   Fidelity to the Complete Edition
  III.  Script-Verifiable by Default
  IV.   Screen-Bound Performance
  V.    Platform-Agnostic Core, Linux-First Development
  VI.   Layered, State-Driven Architecture
  VII.  Robust Parsing, Honest Failure
  VIII. Lean Dependencies and Small Footprint

Added sections:
  - Technical Constraints & Budgets
  - Development Workflow & Quality Gates
  - Governance

Removed sections: none

Templates / dependent files:
  ✅ .specify/templates/plan-template.md — reads constitution at runtime ("Constitution Check"); no edit needed
  ✅ .specify/templates/spec-template.md — no constitution-specific slots; no edit needed
  ✅ .specify/templates/tasks-template.md — no constitution-specific slots; no edit needed
  ⚠ AGENTS.md — outdated (references tmp/, Pixi/Preact/Zustand stack, Windows sync path);
    must be rewritten to align with this constitution (deferred, outside constitution scope)
  ⚠ .gitignore — context/ and reference captures not yet ignored (deferred)

Deferred TODOs:
  - Budget numbers in "Technical Constraints & Budgets" are initial targets; confirm or tune
    once the first measurement harness exists (amend as PATCH if only numbers change).
-->

# heroes_iii_dynam Constitution

## Core Principles

### I. User-Supplied Assets Only (NON-NEGOTIABLE)

- The project MUST NOT redistribute any third-party game content: LOD/SND/VID archives, DEF/PCX
  sprites, maps, saves, or anything derived from them (extracted frames, atlases, palettes,
  caches, reference screenshots). This applies to the git repository, build output, CI
  artifacts, and any published package (Workshop, KDE Store, etc.).
- At runtime the user MUST be the one who provides game files (file pickers, platform
  properties, drag-and-drop). Derived caches MAY exist only on the user's own machine.
- Development assets live in `public/dev-assets/`; reference material lives in `context/`;
  reference captures from the original game live in a local-only folder. All of them MUST be
  git-ignored.
- Automated tests that need real game files MUST skip with an explicit message when the files
  are absent. Everything else MUST use synthetic fixtures committed to the repo.
- Code licensing: the project is MIT. Code MAY be ported only from compatibly licensed sources
  (e.g. `homm3-parser`, MIT) with attribution recorded in a third-party notices file. Code from
  GPL sources (e.g. VCMI) or unlicensed sources (e.g. `context/heroes_iii_android` / h3lwp) MUST
  NOT be copied; they MAY be studied to understand file formats and behavior.
- Published names, descriptions, and icons MUST NOT use Ubisoft/3DO/NWC or HotA logos or imply
  official affiliation.

**Rationale:** the wallpaper must be publishable without legal exposure; the user owns their copy
of the game and supplies it.

### II. Fidelity to the Complete Edition

- The visual and behavioral baseline is **Heroes of Might and Magic III: Complete** (GOG
  release), run unmodified. HD Mod and HotA builds MUST NOT be used as the baseline for
  base-game features.
- Tile selection, mirroring, palette rotation ranges, animation frame order, animation speed,
  object placement, draw order, and player colors MUST match the baseline. Any intentional
  deviation (e.g. optional scaling, extra interactive features) MUST be documented in the
  feature spec and be switchable off where it affects the classic look.
- Scope order: (1) RoE/AB/SoD map files, (2) save files of the Complete edition, (3) HotA maps,
  saves, and assets. HotA work MUST NOT start until base-game map rendering passes its fidelity
  checks.
- Default presentation is native 32px tiles; scaled presentation is a user setting.

**Rationale:** "looks like the real game" is the product; a fixed, reproducible baseline makes
fidelity measurable.

### III. Script-Verifiable by Default

- Rendering MUST be a deterministic function of (loaded data, state, camera, time). Time MUST come
  from an injectable clock and any randomness from a seeded generator, so any frame can be
  reproduced exactly.
- Every visible feature MUST ship with at least one automated check that an agent can run
  headlessly on Linux without human involvement:
  - data-level checks (parsed values, tile/frame/palette choices, timings) against known values
    or the baseline; and/or
  - image-level checks (headless Chromium render of a region at time `t`) diffed against local
    reference captures from the baseline game, producing a machine-readable report and a diff
    image.
- The project MUST provide inspection CLIs (e.g. dump a DEF's groups/frames/timings, inspect a
  map tile/object, render a region to PNG) so behavior can be examined without opening a UI.
- A feature is not "done" until its checks exist and pass, or remaining differences are listed
  as known deviations in its spec.

**Rationale:** the developer should not be asked to eyeball intermediate results; mismatches with
the original must be detectable by tooling.

### IV. Screen-Bound Performance

- Per-frame CPU work, GPU memory, and draw calls MUST scale with the visible viewport, not with
  map size. A 252×252 two-level map MUST run within the same budgets as a 36×36 map.
- The renderer MUST NOT allocate a surface larger than the display (times device pixel ratio),
  MUST NOT create per-tile scene objects for the whole map, and MUST NOT create per-frame
  textures for palette animation (palette effects are done via palette lookup, not re-baking).
- Frames MUST be produced only when something visible changes (animation tick at original
  game timing, camera move, state change). When the platform reports the wallpaper hidden,
  paused, or occluded, rendering and animation timers MUST stop.
- Heavy work (archive decompression, sprite decoding, map parsing) MUST run off the main thread
  and its results MUST be cached locally (e.g. IndexedDB) keyed by source file identity.
- Budgets in "Technical Constraints & Budgets" are enforced by automated checks; a change that
  breaks a budget MUST NOT be merged without a constitution-compliant justification.

**Rationale:** it is a wallpaper that runs all day, including on old integrated GPUs; the
previous PoC crashed the machine by sizing everything to the map.

### V. Platform-Agnostic Core, Linux-First Development

- The core (formats, model, simulation, renderer) MUST NOT reference any platform API
  (Wallpaper Engine, Lively, KDE/Qt, Node fs). Format parsers and simulation MUST NOT depend on
  the DOM and MUST run in Node for tests and CLIs.
- Each target is a thin adapter responsible only for: obtaining user files, reading/writing
  settings, and lifecycle/visibility events. Targets: plain browser (also the dev harness),
  Wallpaper Engine, Lively Wallpaper, KDE Plasma wallpaper plugin.
- Every development, build, test, and verification step MUST work on Linux. Windows-only paths,
  tools, or scripts are forbidden in shared tooling; platform-specific install locations come
  from environment/config.
- The baseline game is run on Linux through Heroic Games Launcher with Proton (per
  h3hota.com/ru/x_linux) for capturing reference material.

**Rationale:** multiple wallpaper hosts must share one engine, and daily development happens on
Linux.

### VI. Layered, State-Driven Architecture

- The code is organized in one-directional layers: **Formats** (LOD, DEF, PCX, H3M, saves) →
  **Model/State** (normalized, version-independent world state) → **Simulation** (events that
  change state over time) → **Renderer** (reads state, never mutates it) → **Adapters/UI**.
- The world-state model MUST be able to represent everything a save file adds over a map
  (hero positions and armies, ownership/flags, visited and removed objects, day), even before
  save parsing exists.
- Interactive extras (idle/mouse scrolling, defeating monsters/heroes, capturing towns and
  mines) MUST be implemented as simulation events on the state, not as renderer special cases.
- Game data tables (object classes, animation timings, palette rotation ranges, player colors)
  MUST live in typed data modules, not scattered literals.

**Rationale:** the PoC mixed parsing, texture baking, and rendering in one component; clean layers
make saves, HotA, and interactivity additive instead of rewrites.

### VII. Robust Parsing, Honest Failure

- Parsers MUST be bounds-checked and MUST fail with typed errors carrying file name, byte offset,
  format version, and the structure being read.
- Parsers MUST NOT guess: no fixed "skip N bytes" for variable-length structures. Unsupported
  object types or versions MUST produce an explicit "unsupported" record or error, never silent
  misalignment.
- A malformed or unsupported input MUST NOT crash or hang the host. The app renders what it can
  and surfaces a clear, non-intrusive diagnostic.
- Errors MUST NOT be swallowed silently; logging goes through the project logger, stripped or
  level-gated in production builds.

**Rationale:** the wallpaper will meet thousands of community maps of varying versions and quality.

### VIII. Lean Dependencies and Small Footprint

- Every runtime dependency MUST be justified in its spec/plan by gzipped size, license, and what
  it replaces. Prefer zero-dependency, tree-shakable code.
- No UI framework or general-purpose rendering engine in the wallpaper runtime unless a plan
  demonstrates the budget still holds and the need cannot be met more simply.
- Strict TypeScript everywhere (all strict flags, no `any` without a justified local comment).
- Start simple (YAGNI): build what the current spec needs, while respecting the layer boundaries
  in Principle VI.

**Rationale:** bundle size and load time are first-class product metrics.

## Technical Constraints & Budgets

- **Minimum hardware:** Intel HD Graphics 3000-class GPU, WebGL 1.0, 4 GB system RAM. Rendering
  MUST NOT require WebGL 2 or extensions not broadly available on that class.
- **Runtime environments:** Chromium-based hosts shipped by current Wallpaper Engine (CEF), Lively
  Wallpaper, and KDE Plasma (Qt WebEngine), plus current desktop Chromium for development.
- **Language & tooling:** TypeScript (strict), yarn, Vite, Vitest; headless Chromium
  (Playwright) for image-level checks.
- **Initial budgets** (measured at 1920×1080, DPR 1, largest supported map, in automated checks
  with CPU throttling to approximate minimum hardware; tune by amendment once measured):
  - Wallpaper runtime JS: ≤ 100 KB gzipped (excluding user-supplied game files).
  - Warm start (cached decoded data) to first frame: ≤ 2 s. Cold start (no cache): ≤ 10 s.
  - Total memory (JS heap + GPU textures): ≤ 300 MB.
  - GPU surface: never larger than display size × DPR.
  - While hidden/paused: 0 rendered frames, no animation timers running.
  - While visible and idle (only ambient animation): frame production limited to the original
    game's animation cadence.
- **Formats in scope now:** LOD (base game), DEF, PCX, H3M RoE/AB/SoD. **Next:** Complete edition
  save files. **Later:** HotA LOD (incl. 1.8+ encrypted), HotA H3M, HotA saves.

## Development Workflow & Quality Gates

- Features follow the Spec Kit flow: specify → (clarify) → plan → tasks → implement. Each plan
  MUST include a Constitution Check against every principle above.
- **Local-only folders** (git-ignored): `public/dev-assets/` (game files for dev), `context/`
  (third-party reference code and docs), and the reference-capture folder from the baseline game.
- **Reference capture:** the baseline game (Complete edition via Heroic + Proton) is used to
  capture screenshots/recordings of chosen maps and regions; captures are indexed by map, region,
  and timestamp so image-level checks can locate them.
- **Merge gates** (all MUST pass): strict type-check; unit tests; budget checks; fidelity checks
  for every feature touched; no game assets or derived data in the diff; no Windows-only
  tooling introduced.
- Commit messages, code, and documentation are in English.
- `AGENTS.md` is the runtime development guide for coding agents and MUST stay consistent with
  this constitution; when they conflict, this constitution wins and `AGENTS.md` is fixed.

## Governance

- This constitution supersedes all other project practices and guides. Plans, reviews, and
  agent work MUST verify compliance; any violation MUST be justified in the plan's complexity
  tracking or the change is rejected.
- **Amendments:** proposed as a change to this file with a Sync Impact Report, approved by the
  project owner, and accompanied by updates to dependent guidance (`AGENTS.md`, templates) in
  the same change or an explicitly tracked follow-up.
- **Versioning (semantic):** MAJOR — removing or redefining a principle in an incompatible way;
  MINOR — adding a principle/section or materially expanding guidance; PATCH — wording,
  clarifications, or budget number tuning that does not change intent.
- **Compliance review:** at the end of each feature (before merge), re-check the Constitution
  Check in its plan against the actual implementation; record any accepted deviations there.

**Version**: 1.0.0 | **Ratified**: 2026-09-13 | **Last Amended**: 2026-09-13
