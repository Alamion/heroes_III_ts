# Feature Specification: View-scoped object graphics

**Feature Branch**: `testing` (no branch change requested)
**Created**: 2026-11-27
**Status**: First scenario accepted; wallpaper-host rollout in progress
**Input**: After the KDE fix, implement the region-scoped object atlas in TODO.

## User Scenarios & Testing

### User Story 1 - Large maps without unseen graphics (Priority: P1)

As a wallpaper user, I want a large map to display the same objects and animation
as before without retaining graphics from parts of the map I cannot see.

**Why this priority**: Current object graphics grow with map contents and can exceed
the minimum supported hardware's limits.

**Independent Test**: Open the primary HotA map, move between distant dense views and
both levels, and compare the shown scenes with the existing renderer while measuring
resident graphics. This is the first complete scenario and maintainer review point.

**Acceptance Scenarios**:

1. **Given** identical visible contents in two maps, **When** one map adds many unseen
   object types, **Then** the shown view's resident object graphics do not increase.
2. **Given** a shown view, **When** the user selects a distant place or another level,
   **Then** the previous complete scene stays visible until the replacement is ready,
   and the replacement contains all intersecting objects and their animation frames.
3. **Given** several rapid place changes, **When** loading finishes, **Then** only the
   latest requested place is shown; an older result never overwrites it.

### User Story 2 - Existing wallpaper lifecycle remains reliable (Priority: P2)

As a user on any supported host, I want folder rotation, remembered data, resizing,
scaling, archive changes and graphics recovery to continue working.

**Independent Test**: Exercise existing host invariants with large base-game and HotA
maps, including a folder switch while an older region is being prepared.

**Acceptance Scenarios**:

1. **Given** folder rotation, **When** the next map is ready, **Then** terrain, objects
   and selected place change together without a blank or terrain-only frame.
2. **Given** repeated navigation and rotation, **When** regions are revisited, **Then**
   retained memory and disk data remain bounded rather than growing per visited place.
3. **Given** a graphics reset or new archive, **When** recovery finishes, **Then** only
   graphics consistent with the current files and requested view are shown.

### Edge Cases

- A sprite reaches into the viewport from an anchor outside it.
- Heroes have separate bodies and flags; towns and moved HotA sprites retain offsets.
- A view contains no objects, missing/unreadable sprites or unusually dense graphics.
- A pending request is superseded by a map, level, archive, scale or viewport change.
- The wallpaper is hidden/paused while work completes, or its graphics context is lost.
- The viewport shows map edges or uses fractional presentation scaling.

## Requirements

### Functional Requirements

- **FR-001**: Object graphics residency must depend on the visible region and a bounded
  safety margin, not unseen map contents or the other level.
- **FR-002**: Selection must include complete sprites intersecting the visible view,
  even when their anchors are outside; all frames needed for their animation must exist.
- **FR-003**: Object placement, ordering, shadows, flags, colors, random outcomes and
  animation phases must remain identical for identical files, view, seed and time.
- **FR-004**: Keep the last complete scene until a newly requested region is ready;
  apply matching region graphics and presentation together.
- **FR-005**: Reject obsolete work and bound transient replacement resources.
- **FR-006**: Preserve map-folder atomic swaps, caching, visibility/pause and recovery.
- **FR-007**: Retain clear diagnostics for missing, unreadable or over-budget graphics.
- **FR-008**: Expose resident object graphics metrics through existing diagnostics so
  the view-bound property can be checked automatically on Linux.

### Key Entities

- **Requested view**: latest user-selected place, level, size and scale.
- **Resident region**: region and level covered by the currently usable object graphics.
- **Replacement**: prepared graphics tied to files, map, random seed and requested region.

## Success Criteria

### Measurable Outcomes

- **SC-001**: Adding object types outside the selected region changes resident object
  graphics bytes by zero when the region's contents are unchanged.
- **SC-002**: Identical deterministic views retain identical pixels; the existing
  reference corpus has no new unexplained regressions.
- **SC-003**: Both levels and ten rapid distant-view changes finish on the latest view,
  with no intermediate blank or partially populated replacement.
- **SC-004**: Existing published size/startup/memory budgets and host invariants pass
  for both base-game and HotA cases, including the minimum supported graphics profile.
- **SC-005**: Repeating the same navigation cycle twenty times does not grow retained
  graphics or region storage after the configured bounds are reached.

## Assumptions

- No new user setting is needed: this is an internal fidelity-preserving improvement.
- Existing archives and maps remain user-supplied; no game-derived test files are committed.
- A complete region may temporarily take time to prepare; keeping the previous complete
  view is preferable to showing the new terrain with missing objects.
- Whole-map parsing and normalized object metadata remain necessary; the target is
  resident/decoded graphics, not removal of the map's logical state.
- Deliver User Story 1 for review before expanding into the lifecycle/catalogue matrix.
- Owner refinement after accepting the first scenario: optimize the current non-interactive
  wallpaper hosts, while preserving animation. The browser currently supports dragging/scrolling;
  keep its eager graphics strategy for now. Future interaction on wallpaper hosts may require
  another residency/prefetch policy, selected by callers without changing formats or drawing.
  This feature does not implement that future interaction or prefetch mode.
