# Feature Specification: Platform Adapters

**Feature Branch**: `004-platform-adapters`

**Created**: 2026-09-17

**Status**: Draft

**Input**: User description: "Делаем пункт 3.2 плана - адаптеры для Wallpaper Engine, Lively и KDE
Plasma." — TODO item 3.2: platform adapters for the plain browser (file picker / drag-and-drop),
Wallpaper Engine, Lively Wallpaper and the KDE Plasma wallpaper plugin; pause/visibility handling;
a scale setting (32 px tiles by default); packaging without any game files.

## Context

Specs 002 and 003 delivered the engine: it takes a sprite archive (`H3sprite.lod`), a data archive
(`h3bitmap.lod`) and a map, and draws terrain, rivers, roads, objects, heroes and towns with the
original animation, caching decoded data locally. Today the only way to see it is the developer
harness, which needs a development server and the developer's own asset folder. Nobody can use it
as a wallpaper yet.

This feature makes the engine usable as a desktop wallpaper on the four target hosts. Each host
gets a thin adapter that only (a) obtains the user's game files, (b) reads and applies settings,
and (c) forwards lifecycle events (visible/hidden, paused/resumed, resized). Everything the user
sees is still drawn by the shared engine; no host gets its own rendering.

A settings file for Wallpaper Engine already exists in the repository from the old proof of
concept (a sprite archive, an optional HotA archive and a map). It predates the data archive and
the no-HotA scope; it is replaced by this feature.

## Clarifications

### Session 2026-09-17

- Q: On which real hosts can the owner check the packages? → A: All four (browser, KDE Plasma,
  Wallpaper Engine, Lively). Update 2026-09-17: Wallpaper Engine and Lively are verified in a follow-up
  session run directly on Windows after this spec is implemented and committed on Linux; this spec keeps
  only the expected solution pattern and the open questions for them.
- Q: Where does the wallpaper take its map from? → A: One user-chosen map; a map folder with a random
  map per start or timed rotation comes in a later phase, so settings must allow adding it without
  breaking existing ones.
- Q: Where does the browser version live? → A: A publishable static folder, published automatically to
  GitHub Pages from the `testing` branch.
- Q: How is the initial camera position set? → A: A mode: random position (default), map centre, or
  given coordinates; coordinates are entered with sliders, not number fields.
- Q: Which languages do settings labels, placeholder and messages use? → A: English and Russian,
  chosen from the host or system language, English as fallback.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Use it as a wallpaper in Wallpaper Engine (Priority: P1)

A Windows user who owns Heroes III Complete installs the wallpaper in Wallpaper Engine, opens its
properties, points the three file settings at `H3sprite.lod`, `h3bitmap.lod` (both from the game's
`Data` folder) and a map from the game's `Maps` folder, and the desktop shows the animated map.
They can change the map, the level, the scale and the starting view from the same properties panel
without reinstalling. When a fullscreen game or application covers the desktop, the wallpaper stops
working and resumes where it was.

**Why this priority**: Wallpaper Engine is the largest audience for a web wallpaper and the host the
project was started for.

**Independent Test**: With the Wallpaper Engine host behaviour simulated in a headless browser
(property events carrying local file paths, pause events), the packaged wallpaper loads the files,
draws the same frame as the engine does for the same inputs, reacts to every setting, and produces
no frames while paused. Owner acceptance on a real Wallpaper Engine install confirms it.

**Acceptance Scenarios**:

1. **Given** a fresh install with no files set, **When** the wallpaper starts, **Then** it shows a
   calm placeholder that names the settings still missing, and draws no map.
2. **Given** all three files are set, **When** the wallpaper starts, **Then** the map appears at the
   configured level, view and scale, animated at the original timing.
3. **Given** the wallpaper shows a map, **When** the user picks another map file, **Then** the new map
   replaces the old one without restarting the host, and the archives are not decoded again.
4. **Given** the wallpaper shows a map, **When** the host reports it paused, **Then** no frames are
   produced and no animation timers run until it is resumed; after resuming, animation continues
   from the current time.
5. **Given** a file setting points at a file that is not the expected kind (e.g. a HotA map or a
   different archive), **When** it is loaded, **Then** the wallpaper keeps showing what it could load
   (or the placeholder) with a short, non-intrusive message naming the file and the problem.

---

### User Story 2 - Try it in a plain browser (Priority: P1)

Anyone opens the published web page (or a locally unpacked copy) in a desktop Chromium-based
browser, chooses or drags in the two archives and a map, and sees the animated map. On the next
visit the same files are remembered and the map appears without choosing them again. They can
scroll the map, switch level and change scale from a small settings panel that hides itself.

**Why this priority**: it is the simplest way to try the project, the reference adapter the others
follow, and the one fully verifiable on Linux.

**Independent Test**: In a headless browser, supply synthetic archive and map fixtures through the
file picker and by simulated drag-and-drop; check the rendered frame, reload the page and check that
the same frame appears without supplying files again; clear the remembered files and check the
placeholder returns.

**Acceptance Scenarios**:

1. **Given** a first visit, **When** the user drops all three files at once onto the page, **Then** each
   file is recognised by its content (not only its name) and the map appears.
2. **Given** files were supplied on an earlier visit, **When** the page is opened again, **Then** the
   map appears from the remembered files without user action.
3. **Given** the map is shown, **When** the browser tab is hidden or minimised, **Then** rendering and
   animation timers stop, and resume when it is shown again.
4. **Given** remembered files, **When** the user chooses "forget files", **Then** the remembered copies
   and decoded caches for them are removed from the machine and the placeholder is shown.

---

### User Story 3 - Use it as a KDE Plasma wallpaper (Priority: P2)

A Linux user on KDE Plasma installs the wallpaper plugin, selects it in "Configure Desktop and
Wallpaper", chooses the three files with the standard file dialogs in the plugin's settings page, and
the desktop shows the animated map on every screen that uses this wallpaper. Settings (level, view,
scale) are set in the same page and applied when confirmed.

**Why this priority**: the development platform is Linux, and KDE is the only native Linux host in
scope; it can be exercised on the development machine.

**Independent Test**: The plugin package passes the host's package validation; the page it embeds
receives files and settings through the same bridge contract as the other hosts, verified headlessly
with that bridge simulated; owner acceptance on a real Plasma session confirms installation,
settings and pause behaviour.

**Acceptance Scenarios**:

1. **Given** the plugin is installed and files are chosen, **When** the desktop is shown, **Then** the
   map is drawn at the configured level, view and scale.
2. **Given** two screens use the wallpaper, **When** both are visible, **Then** each draws its own view
   and decoded data is shared, not decoded twice.
3. **Given** a window is maximised or the screen is locked or turned off (as far as the host reports
   it), **When** the wallpaper is no longer visible, **Then** it stops rendering and animation timers.

---

### User Story 4 - Use it in Lively Wallpaper (Priority: P3)

A Windows user who prefers Lively Wallpaper imports the wallpaper package, supplies the two
archives and a map through Lively's customisation panel, and sees the animated map, with the same
settings and pause behaviour as in Wallpaper Engine.

**Why this priority**: a free alternative host with a smaller audience; reuses most of the Wallpaper
Engine and browser work.

**Independent Test**: With Lively's property and pause behaviour simulated in a headless browser,
the packaged wallpaper loads files, applies settings and stops rendering while paused. Owner
acceptance on a real Lively install confirms it.

**Acceptance Scenarios**:

1. **Given** the package is imported and files are supplied through the customisation panel, **When**
   the wallpaper starts, **Then** the map appears with the configured settings.
2. **Given** Lively pauses the wallpaper (fullscreen application, battery, etc.), **When** it is paused,
   **Then** no frames are produced until it resumes.

---

### User Story 5 - Build and publish the packages (Priority: P2)

The project owner runs one command on Linux and gets, for each host, a package ready for that host
(a folder for Wallpaper Engine publishing, an importable archive for Lively, an installable plugin
archive for KDE, a static folder for the web). A check confirms that no package contains game files
or anything derived from them, that each package is complete, and that each stays within the size
budget.

**Why this priority**: without packages nothing reaches users; the no-game-content guarantee is
non-negotiable (constitution Principle I).

**Independent Test**: Run the packaging command in a clean checkout with no game files present and
again with development game files present; both produce identical packages, the content check
passes, and the size check reports each package's runtime size.

**Acceptance Scenarios**:

1. **Given** development game files exist locally, **When** packages are built, **Then** none of them
   contains any game file, map, capture, extracted frame, palette or cache, and the check proves it.
2. **Given** a package, **When** its names, descriptions and preview image are inspected, **Then** they
   use no Ubisoft/3DO/NWC/HotA logos or wording implying official affiliation.

---

### Edge Cases

- Only some of the three files are supplied: the placeholder lists the missing ones; with the sprite
  archive and map but no data archive the terrain is drawn without objects and the message says so
  (the engine already supports this).
- A supplied file is corrupt, truncated, a HotA map, or the wrong archive: a short message names the
  file and reason; the host is never crashed or hung; the previous good map stays if there was one.
- A host path contains non-ASCII characters or spaces (e.g. `По праву силы.h3m`, `Program Files`): the
  file still loads.
- A supplied file is changed or replaced on disk under the same path: the adapter notices on the next
  start (or when the host reports the setting changed) and does not reuse stale decoded data.
- A host setting still refers to a file that has since been deleted: treated like a missing file.
- Settings from an older package version (e.g. the old HotA archive property): ignored without error.
- The configured level does not exist on the chosen map (underground on a one-level map): the surface
  is shown. A map smaller than the screen: the whole map is shown and position sliders have no effect.
- A scale that would leave less than one tile visible or exceed the surface: limited to the valid range.
- Screen resolution, DPR or monitor layout changes while running: the drawing surface follows the
  new size without exceeding it.
- The host restores the wallpaper after sleep/hibernate: rendering resumes and time jumps do not
  cause a burst of catch-up frames.
- The host sends many setting changes in a row (dragging a slider): only the last value is applied and
  no reload storm occurs.
- The local cache is unavailable (private mode, quota exceeded, host blocks storage): the wallpaper
  still works, decoding again on each start, and says nothing unless the start budget is broken.
- The host gives no pause or visibility information: the page's own visibility signal is used as a
  fallback.

## Requirements *(mandatory)*

### Functional Requirements

**Shared adapter behaviour**

- **FR-001**: Every host adapter MUST obtain the sprite archive, the data archive and one map only
  from the user (host settings, file dialogs, file picker or drag-and-drop); no package MUST contain
  or download game content.
- **FR-002**: Every adapter MUST recognise a supplied file by its content (archive with sprite entries,
  archive with the data tables, map) so a file given to the wrong setting or dropped without a name
  still works or yields a clear message.
- **FR-003**: Every adapter MUST expose the same settings with the same meaning and defaults:
  map level (surface by default), initial view position (see FR-003a), scale (native
  32 px tiles by default, integer multiples ×2 and ×3 as options), and objects on/off (on by default).
  Changing a setting MUST take effect without restarting the host and without decoding files again
  (changing a file setting re-reads only that file; a new map rebuilds only that map's objects). The
  browser additionally offers a language choice; wallpaper hosts take the language from the host
  (FR-003b).
- **FR-003a**: The initial view position MUST be chosen by a mode: **random** (default), **map centre**,
  or **coordinates**. Random picks a new position on the configured level at every start and every map
  change, from a seeded generator whose seed checks can fix. Coordinates are set with two sliders
  (horizontal and vertical) that express the position relative to the map size (0–100 %), so the same
  slider range fits every map size; the result is clamped so the view stays within the map border.
  Slider changes apply live (FR-003) and do not re-roll a random position.
- **FR-003b**: All user-facing text (setting labels and options, placeholder, load messages, browser
  panel, package descriptions and per-host instructions of FR-023) MUST exist in English and Russian.
  The language MUST follow the host's language where the host provides one, else the system/browser
  language, falling back to English. A check MUST fail when any text key lacks either language.
- **FR-004**: Every adapter MUST stop producing frames and stop all animation timers whenever its host
  reports the wallpaper hidden, paused, occluded, or when the page itself becomes hidden, and MUST
  resume on the reverse signal.
- **FR-005**: Every adapter MUST keep the drawing surface equal to the displayed size times the device
  pixel ratio, following resolution, DPR and layout changes.
- **FR-006**: While files are missing or a load is in progress, every adapter MUST show a quiet
  placeholder naming what is missing or loading; load problems MUST be shown as a short,
  non-intrusive message naming the file and the reason, and MUST be logged through the project logger.
- **FR-007**: Decoded data MUST be cached on the user's machine keyed by file identity, so a second start
  with unchanged files meets the warm-start budget, and a changed file is never served from a stale
  cache entry.
- **FR-008**: Adapters MUST contain no rendering, parsing or game logic: they call the shared engine
  only through its public interface. The layer check MUST enforce that adapters are not imported by the
  core or runtime; tools MAY import only the DOM-free settings definition and string tables of the shared
  adapter kit (to generate host manifests), nothing else from adapters.
- **FR-009**: The fidelity of what is drawn MUST be unchanged by the adapters: at scale ×1 a packaged
  wallpaper MUST produce the same pixels as the engine for the same files, view, level and time.
- **FR-010**: Scaled presentation (×2, ×3) MUST enlarge tiles by whole pixels without smoothing, and
  MUST be switchable back to native 32 px (constitution Principle II: documented, switchable
  deviation).

**Plain browser**

- **FR-011**: The browser adapter MUST accept files through a file picker and through drag-and-drop of
  one or several files at once.
- **FR-012**: The browser adapter MUST remember the supplied files on the user's machine so the next
  visit starts without user action, and MUST offer a "forget files" action that removes the
  remembered copies and their decoded caches.
- **FR-013**: The browser adapter MUST offer mouse drag and keyboard scrolling, a level switch, and a
  settings panel that hides when not in use; it MUST work as a static site with no server-side logic.
- **FR-013a**: The browser package MUST be published automatically to GitHub Pages whenever `testing`
  is updated, only after the package checks (FR-020, FR-021) pass on the same commit; it MUST work
  under the Pages sub-path, and user files MUST never leave the user's browser (no uploads, no
  third-party requests).

**Wallpaper Engine**

- **FR-014**: The Wallpaper Engine package MUST declare file settings for the sprite archive, the data
  archive and the map (without a file-type restriction, which blocks selection of some files), plus
  the shared settings of FR-003, and MUST drop the old HotA archive setting.
- **FR-015**: The Wallpaper Engine adapter MUST load files from the local paths the host provides
  (including paths with spaces and non-ASCII characters) and MUST honour the host's pause events and
  its frame-rate limit (never exceeding it, never exceeding the original animation cadence).

**Lively Wallpaper**

- **FR-016**: The Lively package MUST let the user supply the two archives and a map through Lively's
  own customisation panel, expose the shared settings of FR-003, and honour Lively's pause behaviour.

**KDE Plasma**

- **FR-017**: The KDE package MUST be a Plasma 6 wallpaper plugin with a settings page that uses the
  standard file dialogs for the three files and exposes the shared settings of FR-003.
- **FR-018**: The KDE plugin MUST stop rendering when Plasma reports the wallpaper not visible (as far
  as the host exposes it) and MUST share decoded data between screens rather than decode per screen.

- **FR-018a**: The map source MUST be a single user-chosen map in this feature. The settings layout on
  every host MUST leave room for a later map-folder source (random map per start or timed rotation)
  so that adding it does not rename, remove or change the meaning of existing settings.

**Packaging and checks**

- **FR-019**: One command MUST build all packages on Linux, reproducibly (same sources → same package
  contents), with no Windows-only tools.
- **FR-020**: A headless check MUST verify each package: required files present, no game files or
  derived data (by extension, by known game-file signatures and by size heuristics), no official
  logos or affiliation wording in metadata, and runtime size within budget.
- **FR-021**: A headless check per host MUST simulate that host's file, settings and lifecycle
  behaviour against the built package and verify: files load, each setting has its effect, paused or
  hidden produces zero frames and no timers, the ×1 frame matches the engine frame (FR-009).
- **FR-022**: Each host MUST have a short written acceptance procedure on the real host (install,
  supply files, change each setting, pause/resume, change map). Acceptance on all four hosts is
  required. Browser and KDE are accepted on Linux within this feature; Wallpaper Engine and Lively are
  accepted in a follow-up session on Windows, driven by the open questions listed in research.md. No
  remote-control tooling for Windows is built; shared checks MUST NOT depend on a Windows machine.
- **FR-023**: User-facing documentation MUST explain, per host, where to find the three files in a
  Heroes III Complete installation and state that the files are never uploaded anywhere.

### Key Entities

- **User files**: the sprite archive, the data archive and a map supplied by the user; identified by
  content and file identity; never shipped; may be remembered locally (browser) or referenced by path
  (hosts).
- **Wallpaper settings**: level, view mode (random/centre/coordinates) with two relative sliders, scale, objects on/off; one shared definition
  with per-host presentation; defaults as in FR-003.
- **Host lifecycle signals**: visible/hidden, paused/resumed, resized, settings changed, frame-rate
  limit; each adapter maps its host's signals onto these.
- **Package**: the per-host distributable (web folder, Wallpaper Engine folder, Lively archive, KDE
  plugin archive) with its metadata, preview image and the shared runtime.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user with the game installed gets the animated map on the desktop within 3 minutes of
  installing the wallpaper, following only the bundled instructions, on each of the four hosts (owner
  acceptance per FR-022).
- **SC-002**: A second start with unchanged files shows the first frame within 2 s; a first start
  within 10 s (constitution budgets, measured under the existing throttled budget check). Where the host
  has wiped browser storage (possible in Wallpaper Engine), the first-start limit applies; persistence in
  Wallpaper Engine and Lively is confirmed in the Windows session (research WE-5, LV-5).
- **SC-003**: While paused or hidden, 0 frames are produced and no animation timers are pending, on
  every host simulation.
- **SC-004**: Changing any non-file setting shows its effect within 1 s and never decodes the archives
  again; changing the map never decodes the archives again (only the map and its objects are rebuilt).
- **SC-005**: 100% of built packages pass the no-game-content check; the runtime in each package stays
  within 100 KB gzipped.
- **SC-006**: At ×1 scale the packaged wallpaper frame is pixel-identical to the engine frame for the
  same inputs on each host simulation.
- **SC-007**: Every malformed, missing or wrong-kind file from the edge case list produces a message
  and no host crash or hang in the automated checks.
- **SC-008**: With the host or system language set to Russian, 100% of user-facing text on every host
  simulation is Russian; with any other language, it is English.

## Assumptions

- The repository is hosted on GitHub and Pages can be enabled for it; the published page carries no
  analytics or other third-party requests.
- **Scope**: one map at a time (clarified). Rotating or random maps from a folder (planned for a later
  phase, see FR-018a), save files (item 3.3),
  idle/mouse scrolling in wallpaper hosts and other interactive extras (item 3.4), HotA files
  (item 3.5) and publishing to the Workshop/KDE Store/Lively gallery are out of scope (the web version is the exception, FR-013a); packages are only made ready
  for publishing.
- Wallpaper hosts show a static view (no scrolling) in this feature; scrolling stays in the browser
  adapter, which also replaces the developer harness for users (the harness stays for development).
- Target host versions: current Wallpaper Engine (Chromium-based web wallpapers), current Lively
  Wallpaper (Chromium-based web wallpapers), KDE Plasma 6 with its web engine available.
- Real Windows hosts cannot run in the automated Linux checks; those simulate host behaviour from each
  host's documented interface. The owner has all four real hosts; Wallpaper Engine and Lively are checked on
  Windows in a follow-up session (the project is moved there after this feature is committed).
- Local decoded caches and remembered browser copies of the user's own files are allowed by
  Principle I (they stay on the user's machine).
- Scale options are integer multiples only; fractional scaling would blur pixel art and is not offered.
- Coordinate sliders are relative (0–100 %) rather than tile numbers, because host sliders have fixed
  ranges while maps range from 36 to 252 tiles. A player's start town or hero is not offered as a view
  mode in this feature.
