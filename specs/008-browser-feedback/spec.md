# Spec 008: Browser version after the first user feedback

**Branch**: `008-browser-feedback` · **Created**: 2026-09-27 · **Status**: implemented

The first feedback from users of the published browser version (v0.1.0, GitHub Pages), reported in
Opera and Firefox:

1. "[HotA] Beltway and several other maps look very wrong in the browser, objects are mixed up" —
   the HotA archive was not loaded, and nothing said that a HotA map needs it.
2. "Rework loading files in the browser: HotA cannot be loaded without drag and drop, files cannot
   be loaded one by one."
3. Many `compression type 2 (LZMA) is not supported` errors from `HotA.lod`; the user had HotA 1.8.0,
   and the whole archive failed with `CORRUPT_FILE`.

Scoped as a fix set on top of 0.1.0, not a new roadmap item: no clarify/plan/tasks round.

## Requirements

### HotA map without HotA.lod

- **FR-001**: When the map shown (single map, or the map of a folder) is a HotA map and the HotA
  archive is missing or failed, the controller raises `HOTA_ARCHIVE_NEEDED` (level warn, the map's
  name) and sets `snapshot.hotaNeeded`. The message is sticky — it does not fade — on every host,
  because wallpaper hosts have no panel and the map is wrong without the archive. It disappears as
  soon as the HotA archive is loaded, or the map changes to a base-game one.
- **FR-002**: The message is not raised while the HotA archive is being read or decoded.
- **FR-003**: The browser panel shows the same text at its top and a note at the HotA archive slot;
  the panel comes back once when the condition starts. With the folder source, the panel names how
  many HotA maps are skipped for want of the archive (`folder.hotaSkipped`).

### Files in the browser

- **FR-004**: Every slot (sprite archive, data archive, HotA archive, map, and the folder of maps)
  has its own picker, shows the current file's name (or "not chosen"; the HotA slot says "only for
  HotA maps"), and a remove button when filled. Multi-select ("Choose files…") and dropping stay.
- **FR-005**: A file picked for a slot but of another kind is reported (`WRONG_KIND`, warn) and still
  loaded into the slot of its kind.
- **FR-006**: Removing a slot empties it, unloads it from the engine (data archive: objects hidden;
  HotA archive: the loaded archives are decoded again without it; sprite archive or map: the
  placeholder returns) and forgets the remembered copy. A load of that slot still in flight is dropped.
- **FR-007**: Removing the folder keeps the folder source and waits for another folder or `.zip`;
  the remembered folder is forgotten. A `.zip` of maps can be chosen with a button too.
- **FR-008**: The browser remembers the HotA archive with the other files (spec 005 US3 said so; the
  remembered-files store never read it back).

- **FR-011** (owner, 2026-09-27): browser shortcuts (arrows, U, R, N, O, H) follow the physical key
  (`KeyboardEvent.code`), so they work on any layout — on a Russian one `key` is "г", "к", "т", "щ",
  "р". Combinations with Ctrl, Alt or Meta are left to the browser (Ctrl+R used to draw a new place
  and block the reload).

### HotA archives of other versions

- **FR-009**: Obfuscated-index entries of compression type 2 are decoded: HotA's framing (a 0 byte,
  a raw LZMA1 stream, a 16-byte footer: uncompressed size and stored size + 5, both i64) with lc 3,
  lp 0, pb 2 and a 16 MiB dictionary. Framing, footer and stream errors are typed `DECOMPRESS_FAILED`
  errors of that entry.
- **FR-010**: One entry never fails the whole archive:
  - an index entry of an unknown compression type or with data past the end of the file is left out
    with a warning, unless more than half of the entries are bad (then the archive is cut or wrong);
    negative fields and a type that disagrees with the stored size still fail at once, because that is
    how a wrong XOR key shows;
  - a read that fails falls through to the next archive of the set holding the same name (HotA
    overrides base sprites), with a warning;
  - entries the map can do without — object sprites, HotA terrain tiles — are skipped with a warning
    (`ENTRY_UNREADABLE`) when no archive can deliver them; required entries (base terrain sprites,
    `Objects.txt`, `artraits.txt`, `game.pal`) still fail with the first error.

## Checks

- Unit: `test/core/lzma.test.ts` (a liblzma vector, round trips of every packet kind through the
  synthetic encoder `test/fixtures/synthetic/lzma.ts`, typed errors), `test/core/formats/hota-lod.test.ts`
  (LZMA entries, corrupt framing and footer, a bad index entry left out),
  `test/core/formats/archive-set.test.ts` (fallback and skip), `test/runtime/hota-lzma-decode.test.ts`
  (a synthetic HotA archive with LZMA tiles, an unknown type and a damaged override decodes in front of
  the base archive), `test/adapters/controller-files.test.ts` (FR-001–FR-007).
- Real files: `test/real/hota-archives.test.ts` reads every entry of each `HotA*.lod` in
  `public/dev-assets/` (HotA 1.8.0: 2970 LZMA entries) and of the configured install.
- Host simulations (`yarn verify hosts`): invariant 22 on every host (FR-001, FR-002, FR-009,
  FR-010 with `test/fixtures/synthetic/hota-archive.ts`), invariant 23 in the browser (FR-003, FR-004,
  FR-006, FR-008 through the real buttons and file choosers, across reloads), invariant 24 in the
  browser (FR-011: Russian-layout key events toggle objects, draw a place, hide the panel; Ctrl+R is
  not taken). Invariant 12 now reads
  the placeholder only, since the panel lists the optional HotA slot.
