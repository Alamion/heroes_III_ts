# Feature Specification: HotA Support

**Feature Branch**: `005-hota-support`

**Created**: 2026-09-22

**Status**: Draft

**Input**: User description: "A new spec for HotA format support. Important points: 1. Existing map support must be kept — every map that worked before must still work fully after this spec. 2. At the end of the spec we must be able to open the HotA maps in `public/dev-assets/` and in `/home/JRCD/.wine/drive_c/Games/Heroes3_HotA/Maps/`, including but not limited to HotA 1.8.1 support. Plus: `test_map_hota.h3m` was built for HotA with many terrains, town forms and objects, laid out roughly like `test_map.h3m`, with most HotA novelties in the lower-left corner of the underground level."

## Overview

The wallpaper currently reads base-game archives and maps (RoE/AB/SoD) and renders terrain,
rivers, roads, objects, heroes and towns. Horn of the Abyss (HotA) is the expansion the majority
of the community plays: it ships its own archive (`HotA.lod`, obfuscated since 1.8), its own map
format (version `0x20` with sub-versions), two new terrains, two new factions and a large set of
new adventure-map objects. Today a HotA map is rejected and a HotA archive cannot be read at all.

This feature makes HotA maps first-class: the user supplies the HotA archive alongside their base
archives, and any HotA map they own shows on the wallpaper exactly as the base-game maps do.
Base-game support must not regress in any way.

## Clarifications

### Session 2026-09-22

- Q: How is the map set that the acceptance check must cover defined? → A: An automatic coverage
  set — the check classifies the available maps by their properties (format version, sub-version,
  level count, size class, terrain set, object classes present, file-name encoding) and requires at
  least one map of every distinct class, plus the named edge cases, to pass; the remaining maps are
  sampled rather than all required.
- Q: Which HotA map sub-versions must be supported, given that only 9 and 10 exist locally? → A:
  Sub-versions 9 and 10 are required and verified against the owner's maps; sub-versions 0–8 are
  implemented best-effort from the surveyed sources and, where a map does not match, fail with a
  typed error naming file, offset, version and structure rather than misreading.
- Q: Which HotA files does the user supply, and how are duplicate entry names resolved? → A: One
  additional archive (`HotA.lod`) on top of the base archives, with HotA winning over the base game
  on a name collision; the HotA language archive is only brought in if a needed table turns out to
  be missing from the main one.
- Q: What is shown when an object class cannot be resolved to a sprite? → A: Nothing is drawn on
  the wallpaper (the terrain under it stays visible, so there is no hole), while the object is
  counted and named in the diagnostics and in the check report and marked visibly in the dev
  harness; a non-zero count fails acceptance.
- Q: What happens if the HotA case (a ~111 MB archive and a 252×252 map) does not fit the current
  budgets? → A: The base-game budgets stay untouched and the HotA case gets its own measured,
  approved numbers (cold start, cache size, memory) via a constitution amendment; exceeding a
  budget without that approval is not allowed.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Open a HotA map as a wallpaper (Priority: P1)

A player who runs HotA 1.8.1 points the wallpaper at their HotA install: their base archives, the
HotA archive and a HotA map. The map appears on the desktop — correct terrain, rivers, roads,
objects, towns and heroes, animated at the game's cadence — with no error, no blank holes, and the
same controls and settings as a base-game map.

**Why this priority**: this is the whole feature. Without it, the largest part of the audience
cannot use their own maps.

**Independent Test**: load `public/dev-assets/test_map_hota.h3m` with the HotA archive in the dev
harness and in each host package; the map renders on both levels, including the HotA-novelty zone
in the lower-left corner of the underground level, and the inspection CLIs report the map's
version, size, terrains and objects.

**Acceptance Scenarios**:

1. **Given** the base archives, the HotA archive and `test_map_hota.h3m`, **When** the wallpaper
   starts, **Then** the map renders on both levels with no unresolved object and no error notice.
2. **Given** the same files, **When** the view is moved over the HotA-novelty zone of the
   underground level, **Then** the new terrains, town forms and HotA objects there are drawn with
   their correct sprites, frames and player colours.
3. **Given** a HotA map, **When** it is inspected with the map CLIs, **Then** the reported version,
   sub-version, size, level count, terrains and object list match the map as the HotA editor shows
   it.
4. **Given** a HotA map but no HotA archive, **When** the wallpaper starts, **Then** it reports a
   clear, non-intrusive diagnostic naming the missing archive instead of failing silently or
   crashing.

---

### User Story 2 - Every kind of map the user owns opens (Priority: P1)

The user points the wallpaper at a whole HotA `Maps` folder, which in practice mixes all four map
generations. Whatever kind of map they pick from it opens, regardless of generation.

**Why this priority**: this is the acceptance bar the owner set, and it is what proves backward
compatibility at the same time. The local folder holds 48 RoE (`0x0e`), 55 AB (`0x15`), 62 SoD
(`0x1c`) and 72 HotA (`0x20`, 70 of sub-version 10 and 2 of sub-version 9) maps.

**Independent Test**: a batch check classifies the available maps into coverage classes, opens at
least one map of every class plus the named edge cases, and reports one line per map; the run
passes when every map it opened parses and all of that map's tiles and objects resolve.

**Acceptance Scenarios**:

1. **Given** the maps of the local HotA maps folder and of `public/dev-assets/`, **When** the batch
   check runs, **Then** every coverage class is represented by at least one map that parses without
   error and reports zero unresolved object classes.
2. **Given** a map file of a HotA sub-version the parser does not know, **When** it is opened,
   **Then** the failure names the file, the byte offset, the version and the structure being read,
   and the host keeps running.
3. **Given** `По праву силы.h3m` (non-ASCII name, HotA format), **When** it is opened by name from
   the CLIs and by file picker in the hosts, **Then** it loads like any other map.

---

### User Story 3 - Base-game maps are unchanged (Priority: P1)

Every map, check and capture that worked before this feature still produces the same result
afterwards.

**Why this priority**: the owner named it first. HotA support must be additive.

**Independent Test**: the existing determinism, fidelity, layer, budget, package and host checks
run unchanged on the base-game maps and keep their previous verdicts; renders of the same region
at the same time and seed are byte-identical to renders made before the change.

**Acceptance Scenarios**:

1. **Given** `test_map.h3m` and the base archives only, **When** the full check suite runs,
   **Then** every check keeps the verdict it had before this feature (the accepted deviations of
   spec 003 stay accepted, nothing new fails).
2. **Given** a base-game map and a region, **When** it is rendered at a fixed time and seed before
   and after the change, **Then** the two images are identical.
3. **Given** the base archives without any HotA archive, **When** the wallpaper starts on a
   base-game map, **Then** start-up time, memory and frame cadence stay within their current
   budgets.

---

### User Story 4 - HotA appearance matches the game (Priority: P2)

The HotA content the wallpaper draws looks like HotA itself, not an approximation: terrain
transitions, town forms, object frames, animation timing, shadows and player colours.

**Why this priority**: fidelity is the product, but it can only be judged once the maps open at
all (P1). It is also the part that needs a new reference baseline.

**Independent Test**: HotA reference captures taken from the HotA game build are diffed against
renders of the same region at the same time, producing a machine-readable report and a diff image,
the same way base-game fidelity is checked today.

**Acceptance Scenarios**:

1. **Given** a HotA reference capture of a region of `test_map_hota.h3m`, **When** the same region
   is rendered at the capture's time and seed, **Then** the fidelity report passes with the same
   thresholds used for base-game views.
2. **Given** a region containing the new terrains, **When** it is rendered, **Then** tile choice,
   mirroring and transitions match the capture.
3. **Given** a region containing towns of each faction in each of their forms, **When** it is
   rendered, **Then** each town shows the sprite form matching its buildings, as in the capture.

---

### User Story 5 - The HotA archive is a normal setting on every host (Priority: P2)

On every supported host the user selects the HotA archive the same way they already select their
base archives, and the choice is remembered.

**Why this priority**: without it the feature only exists in the dev harness.

**Independent Test**: the host simulations run with a HotA archive plus a HotA map for each host
and assert the settings round-trip, the file is read and the map renders.

**Acceptance Scenarios**:

1. **Given** each of the four hosts, **When** the user picks a HotA archive in its settings,
   **Then** it is remembered across restarts and used on the next start.
2. **Given** a host where the user leaves the HotA archive unset, **When** a base-game map is
   loaded, **Then** behaviour is exactly as it is today.

---

### Edge Cases

- A HotA archive from a version older than 1.8 (unobfuscated) or newer than 1.8.1 is selected.
- The selected HotA archive uses a compression method the runtime cannot decompress; affected
  entries must be reported by name rather than producing corrupt sprites.
- A HotA map references an object class present in a HotA version newer than the supplied archive.
- A HotA map is opened with a HotA archive of a different version than the one it was built for.
- Names for archive entries cannot be recovered for some entries (hashed names with no known
  pre-image); those entries must remain listable and addressable rather than disappearing.
- Both the base archive and the HotA archive contain an entry of the same name (`Objects.txt`,
  `game.pal`, shared sprites) — which one wins must be defined and deterministic.
- A 252×252 two-level HotA map (`[HotA] The Devil Is in the Detail.h3m`) at minimum hardware.
- HotA-specific rendering rules (shadow and flag colour conventions that differ from the base
  game) applied to a base-game sprite, or vice versa.
- A map with no HotA content at all stored in the HotA map format.
- Loading a HotA map while the HotA archive is being decoded for the first time (cold cache).

## Requirements *(mandatory)*

### Functional Requirements

#### Archives

- **FR-001**: The system MUST read the HotA archive format used by HotA 1.8.x, including its
  obfuscated index, and list, address and extract its entries.
- **FR-002**: The system MUST keep reading base-game archives exactly as before; archive-type
  detection MUST be based on the archive's own header data, not on a guessed byte position.
- **FR-003**: The system MUST recover human-readable entry names where the archive stores hashed
  names, and MUST still expose entries whose name cannot be recovered in a stable, addressable
  form.
- **FR-004**: The user supplies exactly one HotA archive (the main HotA archive) in addition to the
  base archives. When several supplied archives contain an entry of the same name, the system MUST
  resolve it by a documented, deterministic precedence in which the HotA archive overrides the
  base-game archives.
- **FR-004a**: If a data table needed to render HotA content proves to be absent from the main HotA
  archive, the additional source it requires MUST be named in the feature's research and added as
  an explicit, separately selectable input rather than assumed present.
- **FR-005**: An archive entry the system cannot decompress MUST produce a typed, named diagnostic
  and MUST NOT corrupt other entries or stop the rest of the archive from loading.

#### Map format

- **FR-006**: The system MUST parse HotA map files of format `0x20` of sub-versions 9 and 10, which
  are the sub-versions present in the user's maps, and MUST expose the map's version and
  sub-version for inspection.
- **FR-006a**: The system SHOULD parse HotA sub-versions 0–8 as far as the surveyed sources
  describe them; because no map of those sub-versions is available locally, they are best-effort
  and a mismatch MUST surface as a typed error (FR-009), never as a misread map.
- **FR-007**: The system MUST parse HotA-only map content that affects what is displayed:
  the new terrains, the new factions, new object classes and their per-object details, and any
  additional map sections these versions introduce.
- **FR-008**: The system MUST keep parsing RoE, AB and SoD maps with identical results to before
  this feature.
- **FR-009**: Map parsing MUST remain bounds-checked with typed errors carrying file name, byte
  offset, format version and the structure being read, and MUST NOT skip variable-length sections
  by a guessed size.
- **FR-010**: An unsupported map version or object type MUST produce an explicit "unsupported"
  record or error, never a silent misread.

#### Rendering

- **FR-011**: The system MUST render the HotA terrains, including their transition-tile selection
  and mirroring rules, alongside the existing terrains on the same map.
- **FR-012**: The system MUST render HotA rivers, roads and the map border on HotA maps with the
  same rules as base-game maps.
- **FR-013**: The system MUST render towns of every faction, including the HotA factions, in each
  of the sprite forms the game uses for a town's fortification level; the base-game town rule MUST
  be re-verified and corrected if the existing two-form rule is incomplete.
- **FR-014**: The system MUST render HotA heroes, flags and player colours consistently with the
  base game's player colours.
- **FR-015**: The system MUST apply HotA's own sprite conventions (its shadow and flag colour
  conventions) to HotA sprites while keeping base-game conventions for base-game sprites.
- **FR-016**: Every object class present in `test_map_hota.h3m`, in `[HotA] The Devil Is in the
  Detail.h3m` and in the maps of the user's HotA maps folder MUST be rendered with its correct
  sprite, footprint, draw order and animation.
- **FR-017**: An object class the system cannot resolve MUST NOT be drawn on the wallpaper, leaving
  the terrain beneath it visible, and MUST NOT distort the draw order or stop the render. Each such
  object MUST be counted and named (class, sub-type, map position) in the diagnostics and in the
  check report, MUST be marked visibly in the dev harness, and a non-zero count MUST fail the
  acceptance check of FR-020.
- **FR-018**: Object draw order, animation cadence and palette animation on HotA maps MUST follow
  the same measured rules as on base-game maps unless a HotA-specific rule is measured and
  documented.

#### Verification

- **FR-019**: The inspection CLIs MUST work on HotA archives and HotA maps with the same commands,
  output shape and exit codes they use today.
- **FR-020**: The system MUST provide a check that, over the maps in `public/dev-assets/` and a
  configured maps folder, groups them into coverage classes by their properties (format version,
  sub-version, level count, size class, terrain set, object classes present, file-name encoding),
  opens at least one map of every class plus the named edge cases, and reports per opened map
  whether it parses and whether every object class resolves. A map class that appears for the first
  time MUST be picked up by the classification itself, not by a hand-maintained list, and the check
  MUST be able to run over every available map on demand.
- **FR-021**: The reference-capture tooling MUST be able to capture stills and clips from the HotA
  game build, with its own calibration, kept separate from the base-game baseline and its
  captures.
- **FR-022**: HotA views MUST be covered by image-level fidelity checks against HotA captures,
  using the same report format and thresholds as base-game fidelity checks.
- **FR-023**: All existing checks (layers, determinism, fidelity, budgets, packages, hosts) MUST
  keep passing with their current verdicts.
- **FR-024**: The project constitution MUST be amended to define the HotA reference baseline
  (which HotA build, which install, how its captures are labelled and how they relate to the
  Complete baseline) and the HotA budget numbers of FR-027, and the amendment MUST ship with this
  feature.

#### Hosts, settings and budgets

- **FR-025**: Each of the four hosts MUST let the user supply a HotA archive as a setting, with the
  choice remembered across restarts, using the same mechanism as the existing archive settings.
- **FR-026**: Leaving the HotA archive unset MUST leave every host's behaviour unchanged from
  today.
- **FR-027**: The existing budgets MUST keep holding for the base-game case, unchanged. The HotA
  case (a ~111 MB archive and a 252×252 two-level HotA map) MUST be measured separately and MUST
  get its own budget numbers — at minimum cold start, cache size and memory — recorded with
  evidence and approved by a constitution amendment; a HotA budget MUST NOT be exceeded without
  that approval.
- **FR-028**: No HotA content (archive entries, sprites, palettes, maps, captures or anything
  derived from them) may enter the repository, build output or any package; HotA files MUST come
  from the user at runtime.
- **FR-029**: Attribution for any ported third-party code and reused third-party data MUST be
  recorded in the project's third-party notices, and sources whose licence forbids copying MUST
  only be studied.

### Key Entities

- **HotA archive**: a user-supplied container of HotA sprites, palettes and data tables, with an
  obfuscated index and hashed entry names; supplied in addition to, not instead of, the base
  archives.
- **Archive set**: the ordered collection of archives the user supplied, with the precedence rule
  that decides which archive answers a name.
- **HotA map**: a map file of format `0x20` with a sub-version, holding the same kinds of content
  as a base-game map plus HotA terrains, factions and object classes.
- **HotA terrain**: a terrain whose tiles come from a numbered tile set with its own transition
  index scheme, rather than from the base game's terrain sprite groups.
- **Town form**: the adventure-map appearance of a town, selected by faction and fortification
  level; HotA factions and forms extend the base-game set.
- **HotA reference capture**: a still or clip taken from the HotA game build, labelled as a HotA
  baseline and never mixed with Complete-edition captures.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Every coverage class found among the maps in `public/dev-assets/` and in the user's
  HotA maps folder (four map generations, HotA sub-versions 9 and 10, one and two levels, sizes up
  to 252×252, non-ASCII file names at the time of writing) is represented by at least one map that
  opens with zero unresolved object classes, and no coverage class is left without a passing map.
- **SC-002**: `test_map_hota.h3m` renders on both levels, and the HotA-novelty zone in the
  lower-left corner of the underground level shows every terrain, town form and object placed
  there, with none drawn as a fallback.
- **SC-003**: Every check that passed before this feature still passes, and renders of base-game
  regions at a fixed time and seed are identical to the pre-feature renders.
- **SC-004**: HotA fidelity checks cover the new terrains, every town faction and form, and the
  HotA-novelty zone, and pass at the same thresholds as the base-game checks; any remaining
  difference is listed as an accepted deviation with owner approval.
- **SC-005**: On each of the four hosts, a user can select a HotA archive and a HotA map and see
  the map on their desktop, with the choice surviving a restart.
- **SC-006**: With a HotA archive and the 252×252 HotA map, the wallpaper stays within the
  approved HotA budgets for start-up, memory, GPU surface and idle frame cadence on the minimum
  hardware profile, and the base-game case stays within its own unchanged budgets.
- **SC-007**: A user who supplies a HotA map without the HotA archive, or an archive the system
  cannot fully read, gets a diagnostic that names what is missing, and the wallpaper keeps running.

## Assumptions

- The user runs HotA 1.8.1; the local install at `/home/JRCD/.wine/drive_c/Games/Heroes3_HotA`
  (HotA 1.8.1, separate from the Complete install used as the base-game baseline) is the
  development reference. Older HotA archives are handled where they cost nothing extra but are not
  a success criterion.
- The user supplies the base archives as today plus the HotA archive; the HotA data file
  (`HotA.dat`) is only brought in if the object tables prove incomplete without it.
- HotA map sub-versions below 9 are supported as far as the surveyed third-party sources describe
  them; sub-versions 9 and 10 are required because the user's own maps use them.
- Truecolour sprite formats introduced by HotA are assumed to be interface art only, unused on the
  adventure map; this is verified during the feature, and implementing them is out of scope if the
  assumption holds.
- Decompression methods beyond those actually used by the 1.8.1 archive are out of scope until an
  archive needs them; affected entries are reported rather than guessed.
- HotA save files, HotA random-map templates and HotA campaign files are out of scope (saves are a
  later roadmap item).
- The reference baseline for HotA content is the HotA game build itself, captured from the local
  1.8.1 install, requiring a constitution amendment; the Complete edition remains the baseline for
  base-game content.
- `test_map_hota.h3m` (format `0x20`, sub-version 10, built by the owner) is the primary HotA check
  map, playing the role `test_map.h3m` plays for the base game, with HotA novelties concentrated in
  the lower-left corner of the underground level.
- The existing world-state model can represent HotA content without a redesign; new content becomes
  new data in the existing typed tables.
