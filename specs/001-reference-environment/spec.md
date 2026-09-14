# Feature Specification: Reference Environment

**Feature Branch**: `001-reference-environment`

**Created**: 2026-09-13

**Status**: Draft

**Input**: User description: "let's do first item from TODO.md" — TODO item 1: set up a reference
environment (Heroic Games Launcher, Proton, GOG Complete edition, a capture workflow), following
<https://h3hota.com/ru/x_linux> and <https://h3hota.com/ru/download>.

## Context

Constitution Principles II (Fidelity to the Complete Edition) and III (Script-Verifiable by
Default) require that the wallpaper's output be compared against the original game without a
human eyeballing results. That comparison needs a reproducible source of truth: the unmodified
Complete edition running on the Linux development machine, driven by scripts that produce
screenshots and short animation clips of known maps at known positions, stored locally with an
index that later image-level checks can query.

This feature delivers that environment and capture workflow. It does not deliver the wallpaper's
image-diff checks themselves (those belong to the features that render things), but it defines
the capture format those checks consume.

## Clarifications

### Session 2026-09-13

- Q: How is fog of war removed for captures? → A: With the in-game cheat code `nwctheone`,
  typed by the tooling after the map loads; no map or game files are modified.
- Q: Where does the game installation come from (no purchased GOG copy)? → A: A locally
  downloaded Complete + HD Mod + HotA bundle already installed into a Wine prefix at
  `/home/JRCD/.wine/drive_c/Games/Heroes3_HotA/` (machine-local path, set via configuration).
  Heroic Games Launcher and a GOG login are not used. *(Folder superseded on 2026-09-14, see
  below.)*
- Q: Which executable is the capture source, given the bundle has no top-level `Heroes3.exe` or
  `h3maped.exe`? → A: Game captures use the original SoD `Heroes3.exe` found at
  `_HD3_Data/Heroes3.exe`, run as a local copy next to `Data/` (bundle files untouched, HotA/HD
  Mod not loaded). Editor captures use `h3hota_maped.exe`, recorded as the HotA editor in each
  capture record; they serve placement checks only. *(Superseded on 2026-09-14, see below.)*
- Q: Where does the game window live during captures? → A: On a separate virtual display that
  is never shown on the developer's screen; the one-time setup installs the system package that
  provides it.

### Session 2026-09-14

- Q: Which installation is used? → A: `/home/JRCD/.wine/drive_c/Games/Heroes of Might and Magic
  III Complete/` — a Complete edition (base game data, official campaigns) with HotA and HD Mod
  installed on top. It contains the original `Heroes3.exe` (sha256 `1362ec7c…becf`), the original
  map editor `h3maped.exe`, and `Heroes3_HD.exe` + `HD_Launcher.exe`.
- Q: Which executable produces game captures? → A: Try in order, first that works wins:
  (1) original `Heroes3.exe` on the virtual display — on the developer's Wayland desktop it
  started but ignored mouse and keyboard, which may be a desktop-session input issue that the
  virtual display avoids; (2) HD Mod `Heroes3_HD.exe` (launched the way `HD_Launcher.exe` does)
  with a pinned "vanilla" HD Mod profile (800×600, no scaling, HD+ features, cosmetic fixes and
  higher-FPS adventure map off). Option (2) needs a constitution amendment before its captures
  count as baseline, and its records are labeled HD Mod.
- Q: Which editor produces editor captures? → A: The original `h3maped.exe`.
- Q: Does the fog-of-war cheat work? → A: Yes, verified by the developer: `nwctheone` and
  `nwcwhatisthematrix` reveal the map; `nwcrevealourselves` does not.
- Q: Which cheat works in the original executable (feasibility probe)? → A: `nwcwhatisthematrix`
  (typed with Ctrl held in the Russian build); `nwctheone` only works under HD Mod.
- Q: Is the original executable usable on the virtual display (feasibility probe)? → A: Yes —
  it accepts scripted mouse and keyboard input on Xvfb; the HD Mod fallback is not needed.
- Q: Should game starts be fixed or random? → A: Both. Launches are otherwise random (town,
  hero, bonus — which also changes map content around random towns), so `fixed` is the default
  for dev runs; `random` stays available for tests that need it.
- Q: How are random map objects (re-rolled every launch) handled? → A: Tiles holding random
  objects are "floating": automated reproducibility checks exclude them, and their look is checked
  less often and visually. The list of such tiles comes from the map's object data once the
  foundation's H3M object parser exists (passed to `selfcheck --floating-tiles` until then). If
  specific random outcomes must be verified, a separate object atlas (as in the PoC, on its own
  git branch) is inspected directly instead of relying on a map.
- Q: How is the view positioned and read back? → A: Verified by the developer: a left click on
  the minimap centers the adventure-map view on the clicked point. The visible area is drawn on
  the minimap as a dashed red rectangle, which gives the actual view.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Agent captures a still of a map region from the original game (Priority: P1)

A coding agent working on terrain rendering needs to know what tile area (x, y, level) of
`Arrogance.h3m` looks like in the original game. It runs one command naming the map, the level,
and the tile coordinates. The command starts the unmodified Complete edition, opens the map,
brings the requested tile area into view, takes a screenshot of the adventure-map viewport,
closes the game, and stores the image in `reference-captures/` together with a record describing
exactly what was captured. The developer is not asked to do anything.

**Why this priority**: still captures are the minimum needed for any image-level fidelity check
(terrain, rivers, roads, static objects). Without them no later feature can prove fidelity.

**Independent Test**: on a machine where the one-time setup is done, run the capture command for
a named map and tile position twice; both runs finish without human input, produce an image plus
index record, and the two images of the viewport are identical except for pixels that the
record marks as animated/volatile.

**Acceptance Scenarios**:

1. **Given** the reference environment is set up and `Arrogance.h3m` is available, **When** the
   agent requests a capture of surface level, tile (10, 12), **Then** a screenshot whose viewport
   shows that tile at a documented, fixed screen position is saved under `reference-captures/`
   with an index record (map, map file identity, level, tile region, timestamp, game build,
   game settings, capture resolution).
2. **Given** the same request is run again later, **When** the capture finishes, **Then** the
   new capture is stored alongside the old one (not overwriting it) and both are findable by map
   and region.
3. **Given** a map file with a non-ASCII name (`По праву силы.h3m`), **When** a capture is
   requested, **Then** it succeeds and the index refers to the map unambiguously.
4. **Given** the requested tile area lies near a map edge where it cannot be centered, **When**
   the capture runs, **Then** the record states the actual visible tile range rather than the
   requested one.

---

### User Story 2 - Agent records a short animation clip (Priority: P2)

An agent verifying palette rotation (water, lava) or object animation timing needs the original
game's frames over time. It runs a command naming the map, level, tile area, and duration. The
game is launched and positioned as in Story 1, then the viewport is recorded as a sequence of
frames with per-frame timestamps and stored with an index record.

**Why this priority**: animation order and speed are explicit fidelity items in the
constitution, but they are checked after static placement, so stills come first.

**Independent Test**: record a 5-second clip of a water area; the stored clip contains frames
with timestamps, the frame rate and duration in the record match the stored data, and the water
visibly changes between frames while static terrain pixels stay constant.

**Acceptance Scenarios**:

1. **Given** the environment is set up, **When** the agent requests a 5-second clip of a region,
   **Then** a clip with at least the original game's animation cadence in frame resolution
   (every distinct animation step is observable) is stored with duration, frame rate, and the
   same positional metadata as a still.
2. **Given** a clip was recorded, **When** a later check asks for "frame at time t", **Then** the
   stored data lets it select the frame nearest to t without re-running the game.

---

### User Story 3 - Agent captures the map editor view (Priority: P2)

An agent checking object placement wants a view without animation noise. It runs a capture
command against the original map editor (`h3maped.exe`) for a map, level, and tile area; the
editor opens the map, scrolls to the region, and a still is stored with its own index record
marked as an editor capture.

**Why this priority**: editor views make placement comparisons exact, but game captures already
cover the essential need.

**Independent Test**: capture the same region from the game (Story 1) and from the editor; both
are stored, distinguishable by source in the index, and the editor capture shows the same
objects in the same tile positions without animation differences across two runs.

**Acceptance Scenarios**:

1. **Given** the environment is set up, **When** an editor capture of a region is requested,
   **Then** it is stored with source = editor, and two consecutive editor captures of the same
   region are pixel-identical in the map area.
2. **Given** the editor overlays UI elements (grid, selection, passability markers), **When** a
   capture is taken, **Then** the record states which overlays were enabled, and the default
   capture has them turned off.

---

### User Story 4 - Developer performs one-time setup and verifies it (Priority: P1)

The developer follows a written setup guide once: point the configuration at the existing
local game installation and its Wine prefix, apply the fixed game settings, and install the
capture tooling. Then they run a single "doctor" command that verifies everything an agent needs
and reports each problem with the fix. After that, agents never need the developer for captures.

**Why this priority**: Stories 1–3 depend on it; it is the only step allowed to involve a human
(obtaining and installing the game files cannot be automated).

**Independent Test**: on a fresh Linux user account, follow the guide, run the doctor command,
and get an all-green report; break one prerequisite (e.g. move the game folder) and the doctor
names that exact problem.

**Acceptance Scenarios**:

1. **Given** a freshly configured machine, **When** the doctor command runs, **Then** it reports
   pass/fail for: game installation found, the selected game executable present and matching its
   recorded hash, Wine available, fixed game settings applied, `h3maped.exe` present,
   required maps reachable, capture tooling available, `reference-captures/` git-ignored.
2. **Given** HotA and HD Mod are installed in the same game folder (as in the local bundle),
   **When** the doctor runs and captures are taken, **Then** HotA code is never loaded, and HD Mod
   code is loaded only if the HD Mod fallback was selected (and then only with the pinned vanilla
   profile, which the doctor verifies).
3. **Given** a prerequisite is missing, **When** any capture command runs, **Then** it fails
   quickly with the same diagnostic the doctor would give, instead of hanging.

---

### User Story 5 - Fidelity check looks up captures (Priority: P3)

A future image-level check needs "the latest still of `Arrogance.h3m`, surface, covering tiles
(x0..x1, y0..y1)". It queries the capture index and gets the matching captures and the mapping
from tile coordinates to pixel coordinates in each image, so it can crop and compare the right
area.

**Why this priority**: the consumer of captures arrives with the rendering features; the index
format must exist now, but its query convenience can be minimal.

**Independent Test**: after several captures, a lookup for a map + region returns only captures
that fully contain the region, newest first, each with a tile-to-pixel mapping that places a
known landmark tile at the correct pixels.

**Acceptance Scenarios**:

1. **Given** captures of several maps and regions exist, **When** a lookup by map and tile region
   runs, **Then** it returns the captures containing that region with their pixel mapping, or an
   explicit "no capture" result.

---

### Edge Cases

- The game shows intro videos, a main menu, or a "scenario info" dialog before the map; the
  workflow must pass through them deterministically.
- Fog of war / shroud: in the game, unexplored tiles are hidden. The cheat code reveals them; if
  the reveal does not take effect, the capture fails rather than storing a shrouded image.
- The original `Heroes3.exe` does not accept input even on the virtual display; the calibration
  records this and selects the HD Mod fallback.
- Hero, UI panels, mouse cursor, or hover highlights overlap the viewport; the cursor must not
  appear in captures, and the viewport rectangle excluded from UI must be documented.
- Map has an underground level; the capture must switch to the requested level.
- The desktop session is locked, the screen blanks, or the developer is typing during a capture;
  none of this may affect the capture, because the game runs on its own virtual display.
- The virtual display cannot be started (package missing, display number taken); the command
  fails with a doctor-style diagnostic.
- The game crashes or hangs; the command must time out, clean up the game process, and report
  failure without leaving the machine in a broken state.
- Two capture commands run at the same time; the second must wait or refuse, never interleave.
- The game or editor is changed by an update (HotA auto-update is enabled in the bundle's
  settings); the doctor must detect a changed executable or archive hash.
- A map version the base game cannot open (e.g. HotA map); the command reports it clearly.
- Captures accumulate and grow large; the developer can list and prune them.

## Requirements *(mandatory)*

### Functional Requirements

**Setup and verification**

- **FR-001**: The project MUST provide a written setup guide for Linux covering the expected
  layout of a locally installed Complete edition (with HotA/HD Mod on top) in a Wine prefix, the Wine
  build used, fixed game settings, and capture tooling, with the exact versions verified to work
  recorded in the guide. The guide MUST NOT depend on GOG or Heroic Games Launcher.
- **FR-002**: Machine-specific locations (game folder, Wine prefix, Wine binary) MUST come from local configuration or environment, never hardcoded in shared files; the
  local configuration file MUST be git-ignored and a committed example MUST document it.
- **FR-003**: The project MUST provide a doctor command that checks every prerequisite listed in
  Story 4 and prints a pass/fail line with a remediation hint for each, plus a machine-readable
  result.
- **FR-004**: Game captures MUST be produced by the original `Heroes3.exe` without HotA/HD Mod
  loaded, or — only if that executable cannot be driven on the virtual display — by HD Mod
  `Heroes3_HD.exe` with the pinned vanilla profile, labeled as such in every record. HotA code
  MUST never be loaded. Editor captures MUST be produced by the original `h3maped.exe`. The
  tooling MUST NOT modify the installed game folder's files. Every record MUST include an identity (content hash) of
  the executable and main data archives used.
- **FR-005**: Game settings that affect visuals or timing (resolution, windowed/full-screen
  mode, animation and scroll speed options, hero/creature movement speed) MUST be fixed to
  documented values and applied or verified by the tooling before each capture.

**Capturing**

- **FR-006**: Agents MUST be able to request a still capture of the game's adventure-map view by
  map file, level, and tile coordinates, with no human interaction after one-time setup.
- **FR-007**: Agents MUST be able to request an animation clip by map file, level, tile
  coordinates, and duration; clips MUST keep per-frame timing so a frame at time t can be
  selected later.
- **FR-008**: Agents MUST be able to request a still capture of the map editor view by map file,
  level, and tile coordinates, with editor overlays off by default.
- **FR-009**: Reaching a given map position MUST be deterministic: the same request MUST result
  in the same tiles at the same pixel positions on every run.
- **FR-009a**: Game captures MUST support two start modes: `fixed` (default) sets town, hero and
  starting bonus for every player to documented choices before the scenario starts, so maps
  whose content depends on random starts (e.g. terrain and objects around random towns) look the
  same on every run; `random` leaves the game's own random choices on. The record MUST state
  the mode and the fixed choices used. Reproducibility checks (FR-021, SC-002) apply to `fixed`
  mode only.
- **FR-010**: The full requested region MUST be visible (not hidden by fog of war/shroud),
  achieved by entering the cheat code `nwcwhatisthematrix` (fallback `nwctheone`) after the map loads, typed with Ctrl held so the Russian build produces Latin letters (the tooling MUST verify
  the region is revealed and fail otherwise), and the capture MUST exclude the mouse cursor and hover effects from the viewport.
- **FR-011**: Every capture MUST record the visible tile range and the tile-to-pixel mapping of
  the viewport, taken from the actual view (the minimap's view rectangle for game captures), not
  only from the request. Game positioning is done by clicking the minimap at the target tile.
- **FR-012**: Capture commands MUST run the game and editor on a separate virtual display that
  is never shown on the developer's screen, sending input only to that display; they MUST NOT
  change the desktop's resolution, focus, or input, and MUST work while the developer uses the
  machine. Screenshots MUST be taken from that virtual display.
- **FR-013**: Capture commands MUST enforce a timeout, terminate the game/editor on failure or
  completion, and prevent concurrent captures from interfering.
- **FR-014**: Captures MUST be lossless (no compression artifacts), at the game's native pixel
  scale with no smoothing or scaling.

**Storage and index**

- **FR-015**: Captures MUST be stored under the git-ignored `reference-captures/` folder,
  organized so they are findable by map, level, region, source (game/editor), kind
  (still/clip), and timestamp; new captures MUST never overwrite older ones.
- **FR-016**: Each capture MUST have a machine-readable record containing at least: map name and
  file identity, level, requested and actual tile region, tile-to-pixel mapping, source, kind,
  timestamp, duration and frame timing (clips), executable/archive identities, game settings,
  capture resolution, how visibility was achieved, and tooling version.
- **FR-017**: The project MUST provide a lookup that, given map + level + tile region (and
  optionally source/kind), returns matching captures newest first, or an explicit empty result.
- **FR-018**: The project MUST provide a way to list captures and remove selected ones.
- **FR-019**: No capture, record, prepared map/scenario derived from game files, or game file
  MUST be committed; the doctor MUST verify that the storage folders are git-ignored.

**Automation contract**

- **FR-020**: All commands MUST be runnable non-interactively on Linux, exit with non-zero status
  on failure, and emit a machine-readable summary suitable for agents.
- **FR-021**: The workflow MUST be covered by an automated self-check: capturing the same still
  twice and confirming that the non-volatile viewport pixels match (reproducibility check), which
  skips with a clear message when the game is not installed.

### Key Entities

- **Reference Environment Configuration**: machine-local settings — game folder, compatibility
  layer and prefix, selected game executable, fixed game settings profile.
- **Capture Request**: map file, level, target tile region, source (game/editor), kind
  (still/clip), duration for clips.
- **Capture**: stored image or frame sequence produced for a request.
- **Capture Record**: metadata of a capture (see FR-016); the unit the index is built from.
- **Capture Index**: the collection of capture records, queryable by map, level, region, source,
  kind, and time.
- **Doctor Report**: list of prerequisite checks with status and remediation hints.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After one-time setup, an agent obtains a still capture of any requested region of
  `Arrogance.h3m` (both levels) with zero human interactions, in under 2 minutes per capture.
- **SC-002**: Repeating the same still request 5 times yields identical non-volatile, non-floating viewport
  pixels in all 5 captures (100% reproducibility).
- **SC-003**: For 10 randomly chosen tile positions on a map, the tile-to-pixel mapping in the
  records places the requested tile at the correct pixels in 10 of 10 captures (verified
  against editor captures or known landmarks).
- **SC-004**: A 5-second clip resolves every distinct animation step of water palette rotation
  (no step missing between consecutive frames).
- **SC-005**: The doctor command completes in under 30 seconds and, for each of the prerequisite
  failures listed in Story 4, names the failing prerequisite correctly.
- **SC-006**: A fresh setup by following the guide takes a developer under 1 hour of hands-on
  time (excluding download time).
- **SC-007**: Zero game-derived files appear in git status after running all capture commands.
- **SC-008**: The developer can keep using the desktop normally during a capture run with no
  stolen focus, input, or visible game windows.

## Assumptions

- The game comes from a locally installed Complete edition with HotA/HD Mod on top, in a Wine
  prefix (currently `/home/JRCD/.wine/drive_c/Games/Heroes of Might and Magic III Complete/`,
  system Wine 11 Staging); installing it is the only manual step and is outside the tooling.
- The development machine runs Linux (Fedora) with a Wayland KDE Plasma session; captures use a
  virtual display (FR-012), whose system package is installed once during setup (it is not
  present yet).
- Running the baseline under plain Wine from a local install is allowed by constitution v1.1.0.
  Using HD Mod for game captures is not yet allowed; it requires an amendment if the fallback is
  selected.
- The original game renders at its native 800×600; that is the fixed capture resolution. HD Mod
  resolutions are out of scope.
- Reference maps come from `public/dev-assets/`; the tooling copies them into the game's map
  folder as needed, locally only.
- Known deviations found during implementation (see research.md "Spike results"): in `fixed`
  start mode AI heroes and starting army sizes remain random (outside the viewport); the map
  editor also animates objects but fixes their frames per launch, so editor volatile masks are
  built from several launches and two editor captures may still differ in a few animated pixels
  (50 of ~407 000 measured) — Story 3's "pixel-identical" holds outside the masks, not absolutely.
- Random map objects (random monsters, and presumably random artifacts/resources/dwellings) are
  re-rolled at every game start even in `fixed` mode (measured: 39–63 differing pixels on one
  random-monster tile; libfaketime did not pin them, see research.md). Decision: such tiles are
  floating — excluded from SC-002 and checked less often, visually (see Clarifications).
- Only still/clip capture and indexing are in scope; image diffing against the wallpaper's
  renders, save-file captures, and HotA captures are out of scope for this feature.
- Capture tooling may use system packages available on Fedora; any new project dependency is
  development-only and does not affect the wallpaper runtime budget.
