# Feature Specification: Map Folder and Map Rotation

**Feature Branch**: `007-map-folder`

**Created**: 2026-09-25

**Status**: Draft

**Input**: User description: "Work with a folder of maps, not only one map (and derivatives — for example
the time between maps or a filter by map size)." Roadmap: TODO.md item 5, "Map rotation" (settings keys
`mapsource`/`mapfolder`/`maprotation` were reserved for it by spec 004 FR-018a).

## Clarifications

### Session 2026-09-25

- Q: Are the defaults taken while writing the spec accepted (Wallpaper Engine/Lively maps live inside the
  wallpaper folder, listing method researched in the plan; underground filter included; instant switch without
  a cross-fade; random order only; sub-folders included)? → A: Yes, all accepted by the owner.
- Q: In which unit and up to what limit is "new map every N" entered? → A: Minutes, 0–1440 (one day);
  the existing "new random place every N minutes" limit is raised from 120 to 1440 as well.
- Q: Is the name of the shown map displayed anywhere? → A: Only outside the picture: the browser panel shows
  it; other hosts expose it in the log and the test-hook state; nothing is drawn over the wallpaper.
- Q: With several monitors and the folder source, does every screen show its own map or the same one? → A:
  Every screen independently picks and rotates its own map; a shared map across screens belongs to the later
  "multi-screen" feature.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - A random map from a folder at every start (Priority: P1)

The user points the wallpaper at a folder of maps (typically the game's own `Maps` folder, a few hundred
files) instead of a single map. Every time the wallpaper starts, it shows a map picked at random from that
folder, so the desktop is different from day to day without any further action.

**Why this priority**: This is the core of the feature: a folder as the map source. Everything else
(rotation, filters) builds on a known list of maps.

**Independent Test**: With the three archives supplied and a folder of maps chosen, restart the wallpaper
several times: each start shows a map from the folder, and over a handful of starts different maps appear.
In a host simulation with a fixed seed, the chosen map is reproducible.

**Acceptance Scenarios**:

1. **Given** the archives are supplied and the map source is "folder" with a folder of valid maps, **When**
   the wallpaper starts, **Then** it shows one map from that folder, chosen at random, with the usual
   starting view (level and place settings apply to it).
2. **Given** a folder that also contains other files (saves, text files, sub-folders, campaigns), **When**
   the wallpaper builds its list, **Then** only single-scenario map files are candidates and the others are
   ignored without an error.
3. **Given** a folder in which some maps cannot be opened (damaged, unsupported format, or HotA maps while
   no HotA archive is supplied), **When** such a map is picked, **Then** the wallpaper skips it, picks
   another one, and does not show an error as long as at least one map in the folder can be shown.
4. **Given** a folder with no usable map at all, **When** the wallpaper starts, **Then** the user sees one
   clear message saying the folder holds no map that can be shown (and why: empty, all filtered out, or
   all unreadable), in the user's language.
5. **Given** the map source is "single map" (the default), **When** the user upgrades from the previous
   version, **Then** their existing single-map setup keeps working unchanged.

---

### User Story 2 - Maps change over time (Priority: P2)

The user sets "a new map every N minutes". While the wallpaper runs, it moves on to another map from the
folder at that interval, without a black screen or loading placeholder in between. The user can also ask
for "next map now" from the host's settings, like the existing "new random place now".

**Why this priority**: Rotation is what makes a folder worth having for users who never restart their
machine; it depends on User Story 1.

**Independent Test**: With a folder of at least three maps and a short interval, watch the wallpaper (or
run the host simulation with a fast clock): the map changes at the interval, the old map stays on screen
until the new one is ready, and no map repeats until every usable map has been shown once.

**Acceptance Scenarios**:

1. **Given** a folder source and an interval of N minutes (N > 0), **When** N minutes of visible running
   time pass, **Then** the wallpaper switches to another map from the folder.
2. **Given** an interval of 0 (the default), **When** the wallpaper runs, **Then** the map changes only at
   start and on "next map now".
3. **Given** a folder of several usable maps, **When** maps are rotated, **Then** no map is shown twice
   before every usable map has been shown once, and the map just shown is never picked again right away.
4. **Given** the next map is still loading, **When** the switch is due, **Then** the current map stays on
   screen and animated until the next one is ready; the switch itself happens at once, with no empty or
   placeholder frame in between.
5. **Given** the wallpaper is paused or hidden (covered, locked, host pause), **When** the interval would
   elapse, **Then** no map is loaded while hidden; the interval counts running time only, as the existing
   "new random place every N minutes" does.
6. **Given** a new map is shown, **When** it appears, **Then** the level and place settings apply to it as
   at start (a random place and level are drawn when those settings say "random"), and the "new random
   place every N minutes" timer continues to work on the new map.

---

### User Story 3 - Only maps of the sizes I like (Priority: P2)

The user limits the folder to certain map sizes — for example only large and extra-large maps, because
small maps show the black area around the map at high resolutions, or only small maps because they load
fastest. Maps outside the chosen sizes are never picked.

**Why this priority**: The folder of a typical install mixes every size from S to XL (and up to G with
HotA); the user explicitly asked for a size filter. It is cheap once the list of maps exists.

**Independent Test**: With a folder containing maps of several sizes and a filter excluding some, run the
rotation through the whole list (host simulation, fast clock): only maps of the allowed sizes are ever
shown.

**Acceptance Scenarios**:

1. **Given** a size filter from a smallest to a largest allowed size, **When** a map is picked, **Then** its
   size is within that range (the standard sizes: S 36, M 72, L 108, XL 144, and HotA's H 180, XH 216,
   G 252; non-standard sizes count as the nearest standard size not smaller than them).
2. **Given** a filter that no map in the folder satisfies, **When** the wallpaper starts or rotates, **Then**
   the message of User Story 1 scenario 4 says that all maps were filtered out and which filter caused it.
3. **Given** the user changes the filter while a map is shown, **When** the shown map no longer matches,
   **Then** the wallpaper moves to a matching map; when it still matches, it stays.
4. **Given** an underground filter set to "only two-level maps", **When** a map is picked, **Then** it has an
   underground level; with "any" (the default) every map qualifies.

---

### User Story 4 - The folder is remembered and followed (Priority: P3)

In the browser version the user chooses or drops a folder once; on the next visit the same maps are
available without choosing again. On the wallpaper hosts the folder is part of the settings. When the user
adds or removes maps in the folder, the wallpaper notices at the latest on the next start.

**Why this priority**: Convenience; the feature works without it by choosing the folder again.

**Independent Test**: In the browser, choose a folder, reload the page: the rotation continues from the
same set of maps. On a host, add a map to the folder and restart: it becomes a candidate.

**Acceptance Scenarios**:

1. **Given** the browser version and a folder chosen by picker or drop, **When** the page is reloaded,
   **Then** the maps are still available without choosing again (as the single map already is).
2. **Given** a host with a folder setting, **When** a map is added to or removed from the folder and the
   wallpaper restarts, **Then** the list reflects the change; a removed map that was about to be shown is
   skipped without an error.
3. **Given** the user switches the map source back to "single map", **When** the setting is applied,
   **Then** the single-map setting is used again with its old value.

---

### Edge Cases

- A folder with a single usable map: rotation keeps showing it (no error, no reload loop); "next map now"
  re-draws the place only.
- Very large folders (thousands of maps, including sub-folders): the start must not wait for every map to
  be read; the wallpaper shows the first usable map as soon as it is found.
- Sub-folders: maps in sub-folders of the chosen folder are included (the game's `Maps` folder is often
  organised into sub-folders by users); the depth limit is set in the plan.
- Duplicate maps (the same file under two names or in two sub-folders) are treated as distinct entries;
  the no-repeat rule works per entry.
- A map that parses but has an invalid size or is empty: treated as unreadable and skipped.
- Files that change while the wallpaper runs (a map being edited in the map editor): a map that fails to
  read is skipped; the wallpaper never renders a half-written file.
- Several monitors: every screen's wallpaper instance picks and rotates its own map independently (no
  synchronisation between screens in this feature; see the roadmap's multi-screen item).
- Non-ASCII file and folder names (Cyrillic) work on every host, as they do for a single map.
- The HotA archive is supplied later than the folder: HotA maps skipped earlier become candidates again.
- A random map object and the random-place timer on the new map behave as on a map loaded at start.
- Host settings from the previous version are kept; a stored folder path that no longer exists produces the
  "no usable map" message, not a crash.

## Requirements *(mandatory)*

### Functional Requirements

**Map source**

- **FR-001**: Every host (browser, Wallpaper Engine, Lively, KDE Plasma) MUST offer a map source setting
  with two values: "single map" (default; today's behaviour) and "folder".
- **FR-002**: With the folder source, the user MUST be able to choose a folder of maps through the host's
  usual way of choosing files or folders; hosts that cannot read outside their own folder (Wallpaper Engine,
  Lively) MUST document where the maps have to be placed, as they already do for the archives.
- **FR-003**: The wallpaper MUST treat as candidates only single-scenario map files (`.h3m`, case-insensitive)
  found in the folder and its sub-folders, and MUST ignore every other file silently.
- **FR-004**: A candidate that cannot be read or rendered with the supplied archives (damaged, unsupported,
  HotA without the HotA archive) MUST be skipped and logged, and another candidate picked; the user sees an
  error only when no candidate can be shown.
- **FR-005**: The "no usable map" state MUST be one localised message (English and Russian) naming the
  reason: folder empty or unreadable, all maps filtered out (with the filter), or all maps unreadable.
- **FR-006**: Existing settings (archives, single map, level, place, interval, scale, objects) MUST keep their
  keys, values and behaviour; upgrading an installed wallpaper MUST NOT lose or change a user's setup.

**Choosing and rotating**

- **FR-007**: At every start with the folder source, the wallpaper MUST pick a random usable candidate.
- **FR-008**: A "new map every N minutes" setting MUST exist on every host (number field, 0 = never, the
  default; range 0–1440 minutes; same entry rules as the place interval: invalid text → 0, out-of-range
  values clamped, fractions rounded), shown only with the folder source.
- **FR-008a**: The upper limit of the existing "new random place every N minutes" setting MUST rise from 120
  to 1440 minutes on every host; stored values keep their meaning.
- **FR-009**: The map interval MUST count visible running time only; while hidden or paused, no map is
  loaded.
- **FR-010**: A "next map now" action MUST exist on every host, next to "new random place now", following the
  existing action pattern (no stored value).
- **FR-010a**: The name of the shown map MUST be available outside the picture: the browser panel shows it, every
  host logs each map shown and exposes it in the controller state; nothing is drawn over the wallpaper.
- **FR-011**: Rotation MUST show every usable candidate once before any is repeated (per session), and MUST
  never show the same map twice in a row when at least two usable candidates exist.
- **FR-012**: The next map MUST be prepared while the current one keeps running; the switch MUST replace the
  picture at once without any empty, black or placeholder frame.
- **FR-013**: A newly shown map MUST get its starting view exactly as at start (level and view-mode settings,
  random draws where they say "random"); the place interval keeps running on the new map.
- **FR-014**: All random choices (map order, skip replacement) MUST come from the project's seeded random
  source, so a host simulation with a fixed seed reproduces the sequence.

**Filters**

- **FR-015**: A size filter MUST let the user set the smallest and the largest allowed map size among the
  standard sizes (S, M, L, XL, H, XH, G); the default allows every size.
- **FR-016**: An underground filter MUST offer "any" (default), "only two-level maps" and "only one-level
  maps".
- **FR-017**: A change of a filter MUST take effect without a restart: the current map stays when it still
  matches, otherwise the wallpaper moves to a matching map.
- **FR-018**: Filtering MUST NOT require fully loading every map; reading a map's header is enough to know its
  size, level count and whether it needs the HotA archive.

**Remembering and following the folder**

- **FR-019**: The browser version MUST remember the chosen folder's maps across reloads, as it remembers the
  single map today, and MUST offer both a folder picker and dropping a folder onto the page.
- **FR-020**: On hosts with a folder path setting, the list of candidates MUST be rebuilt at every start and
  whenever the folder setting changes; a candidate that has disappeared by the time it is picked is skipped.
- **FR-021**: Switching the source back to "single map" MUST use the single-map setting unchanged.

**Performance and verification**

- **FR-022**: Start-up with the folder source MUST stay within the project's start-up budget: the first map
  appears no later than with the single-map source plus the time to find the first usable candidate; the
  wallpaper MUST NOT read every map of the folder before showing the first one.
- **FR-023**: A map switch MUST NOT raise the idle frame cost after the switch completes, and memory held by the
  previous map MUST be released (no growth over repeated switches).
- **FR-024**: The feature MUST ship with headless checks runnable on Linux without a human: selection and
  rotation rules (filters, no-repeat, skip on failure, seeded reproducibility), the switch without an empty
  frame, the "no usable map" messages, memory stability over many switches, and every host simulation
  (`yarn verify hosts`) extended with the folder source and the new settings.
- **FR-025**: Host manifests (Wallpaper Engine properties, Lively properties, KDE configuration, browser panel)
  MUST be generated from the shared settings definition, as today; the new settings are visible only when the
  folder source is selected, where the host supports conditional visibility.

### Key Entities

- **Map source**: the user's choice between a single map and a folder; the reserved settings keys
  `mapsource` and `mapfolder` hold it.
- **Map catalogue**: the list of candidate maps found in the folder, each with its name, location, and — once
  its header is read — size, level count, the archives it needs and whether it could be read.
- **Map filter**: the allowed size range and the underground rule.
- **Rotation**: the per-session order of candidates (shuffled, no repeats until exhausted), the map interval
  (reserved key `maprotation`), the time counted so far, and the "next map now" action.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the game's own `Maps` folder (225 maps in the owner's Complete install, 453 with HotA) as the
  source, the first map appears within the same start-up budget as the single-map source (2 s warm start,
  measured by `yarn verify budget` extended with a folder case).
- **SC-002**: Over 100 consecutive switches in a host simulation, no switch shows an empty or placeholder
  frame, and memory after the last switch is within 10 % of memory after the first.
- **SC-003**: With a fixed seed, two runs of the rotation over the same folder produce the same map sequence;
  over one full cycle every usable map appears exactly once.
- **SC-004**: With any combination of filters, 100 % of the shown maps satisfy the filters (checked over a
  full rotation cycle of the local map folders).
- **SC-005**: A folder where half of the maps are unreadable still rotates through all readable maps with no
  error shown to the user.
- **SC-006**: Every host keeps a user's existing single-map settings after the upgrade (checked by the host
  simulations with settings stored by the previous version).
- **SC-007**: The owner can set up a rotating folder on each of the four hosts following the README alone.

## Assumptions

- "Single-scenario map" means `.h3m`; campaigns (`.h3c`) and saves are out of scope (saves are their own
  roadmap item).
- The level, place and interval settings of spec 004 apply unchanged to every map shown; the level setting
  "underground" on a one-level map behaves as it does today.
- The switch between maps is instant (no cross-fade); a transition effect can come later.
- The map order is random (shuffled). A sequential (alphabetical) order is not required.
- The rotation state (which maps were shown) lives only for the session; after a restart a fresh shuffle
  starts.
- Maps are small (the owner's 225 maps take 8.6 MB), so remembering a folder's maps in the browser's own
  storage is acceptable.
- Wallpaper Engine reads files only inside the wallpaper folder and its folder picker accepts images and videos
  only (spec 004 research); the maps folder on that host therefore lives inside the wallpaper folder (next to
  the archives in `game/`), and how the page lists the folder there is a question for the plan's research.
  Lively passes single chosen files, so there the folder is supplied as one `.zip` of maps (research R1, R3);
  a `.zip` of maps is accepted as a folder on every host.
  Wallpaper Engine and Lively are verified later in a session on Windows, as in spec 004.
- The existing "new random place now" action and "new random place every N minutes" setting stay; the new map
  interval is independent of them.
