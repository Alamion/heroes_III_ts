# Phase 1 Data Model: HotA Support

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md) | **Research**: [research.md](research.md)

Types are described by shape and rules, not as final signatures. Everything here lives in
`src/core` (DOM-free, Node-runnable) unless stated otherwise.

---

## 1. Archives

### `LodIndexKind`

`'plain' | 'obfuscated'`. Decided by the u32 at header offset 12: `0` or `0x7E0213` → plain,
anything else → obfuscated, and that value is the XOR key (R1, M2).

### `LodEntry` (existing, extended)

| Field | Rule |
| --- | --- |
| `name` | For a plain archive, the stored 16-byte name. For an obfuscated archive there is no stored name: the entry carries its `nameHash` and `name` is either resolved by a tool-side dictionary or rendered as `#<hex>`. Lookups never depend on it. |
| `nameHash` | New. `u32`. Always present: computed from `name` for plain archives, read from the record for obfuscated ones. |
| `offset`, `size`, `compressedSize` | For obfuscated archives, each is the stored value XORed with the key. Validated: all ≥ 0, `compressedSize === 0 ⇔ compression === 0`, entry within the file, entries non-overlapping. A violation is a typed `FormatError` (wrong key, honest failure), not a silent read. |
| `compression` | `0` raw, `2` LZMA, `3` zlib (plus the unused `1`). Only 0 and 3 are supported; 1 and 2 raise a typed "unsupported compression" error naming the entry. |

### Name hash

FNV-1a 32-bit (basis `0x811C9DC5`, prime `0x01000193`) over the bytes of the **lower-cased** name,
no trailing NUL, no path separators. Verified 5239/5239 (M1). `find`/`has`/`get` hash the requested
name, so an obfuscated archive needs no name table at runtime.

### `ArchiveSet`

An ordered list of opened archives with first-match-wins lookup.

| Rule | Detail |
| --- | --- |
| Order | HotA archive first, then the base archives in their existing order. Documented and deterministic (FR-004). |
| Lookup | `find(name)` returns the first archive that has the name; `read(name)` reads from that archive. |
| Identity | The ordered concatenation of each member's `archiveIdentity` (header + index hash). Used as the decode-cache identity; archive file size does not affect the cost. |
| Diagnostics | A name found in more than one archive is resolvable but recorded once at debug level, so overrides (`grastl.def`, `watrtl.def`, `clrrvr.def`, `icyrvr.def`, `game.pal`) are visible in logs. |

**State**: an archive set is immutable once built; changing the user's files builds a new set and a
new cache identity.

---

## 2. Text tables

### `ObjectsTxtRow` (existing, extended)

| Field | Change |
| --- | --- |
| `allowedTerrains`, `editorGroups` | Parsed from a mask of **9 or 12** characters. Width is read per file; every row of one file must agree, otherwise a typed error. 12 columns map to terrain ids 0–11 with the existing "leftmost = highest id" convention. |
| `group` | Range widens from 0–5 to 0–10. Values 6–8 are named by the ported source (creature generator, teleporter, guards); 9 and 10 are recorded as unidentified. |

`objtmplt.txt` inside the HotA archive is 9-wide, which is why the width is per file and never
inferred from the archive (M3).

---

## 3. Map format

### `H3mFormat`

Replaces the flat `'RoE' | 'AB' | 'SoD'` union:

```
{ code: 0x0e | 0x15 | 0x1c | 0x20, subVersion: number | null, label: string }
```

`subVersion` is null for base-game formats and the read value for `0x20`. Both are reported by the
inspection CLIs (FR-006).

### `H3mFeatures`

A table derived from `(code, subVersion)`, replacing scattered version comparisons. Existing flags
`ab`, `sod` stay; HotA flags are named for what they gate, each carrying a comment stating whether
it is *documented*, *ported* or *measured*:

| Flag | Gate |
| --- | --- |
| `hotaVersionTriple` | sub ≥ 8: three u32 HotA version numbers in the header |
| `hotaMirrorArena` | sub ≥ 1: `isMirrorMap`, `isArenaMap` |
| `hotaTerrainCount` | sub ≥ 2: `u32 terrainTypeCount` (12 in every measured map) |
| `hotaTownCountAndDifficulty` | sub ≥ 5: `u32 townTypeCount`, `i8 allowedDifficultyMask` |
| `hotaHireDefeated` | sub ≥ 7: `u8 canHireDefeatedHeroes` |
| `hotaForceVersion` | sub ≥ 8: `u8 forceMatchingHotaVersion` |
| `hotaHeaderReserved` | sub ≥ 9: `i32` reserved (0 in all 72 maps, meaning unknown) |
| `hotaCountedHeroes` | counted allowed-hero and predefined-hero lists (215 measured) |
| `hotaCountedArtifacts` | counted allowed-artifact mask (166 measured) |
| `hotaCombinedArtifactBan`, `hotaRoundLimit`, `hotaRecruitmentBlock` | map-options additions |
| `hotaScrollSpellSlots`, `hotaHeroLevelBlock` | predefined-hero additions |
| `hotaEventOccurrenceU16`, `hotaEventDifficulties` | global/town event changes |
| `hotaScriptSection` | sub ≥ 9: the event-system block |
| `hotaQuestTail` | sub ≥ 10: +4 bytes at the end of a quest record |
| `hotaSeerQuestTail`, `hotaSeerObjectTail` | sub ≥ 10: +4 bytes before the reward, +1 byte after the object |

**Rule**: required sub-versions are 9 and 10. Sub-versions 0–8 set the flags their sources describe
and are best-effort (FR-006a); an unknown sub-version, or one whose parse does not end at EOF,
fails with a typed error.

### Map tile (unchanged)

7 bytes: `terrainType, terrainView, riverType, riverDir, roadType, roadDir, extFlags`. Terrain ids
extend to 11; `terrainView` reaches 123 for ids 10/11 and keeps its existing maxima elsewhere;
ext-flag bits 0–6 only. No new per-tile data (M4, M7).

### `ScriptSection`

| Field | Rule |
| --- | --- |
| `active` | The `u8` flag. 68 of 72 maps have it clear, and then the section is one byte. |
| `body` | When active, a walked structure: four event lists, id counters, a variable table and id→name maps, with event bodies as trees of typed opcodes containing length-prefixed strings. The walker reads it; the feature stores only what rendering needs (nothing today) plus the consumed byte range. |
| Validation | No length prefix exists. The parse is accepted only if the whole file then ends exactly at EOF after the 124 trailing zero bytes. A walker failure is a typed error naming the section and offset — never a skip of a guessed length (R6). |

### Object bodies

Class ids stay within the existing 1–231 range; HotA adds **subtypes**. New body rules:

| Class / subtype | Body |
| --- | --- |
| 144, 145, 146 | Currently mapped to `'none'`; in HotA these carry bodies (e.g. 145/0 Ancient Lamp, 145/1 Sea Barrel, 145/2 Jetsam, 145/3 Vial of Mana, 146/0 Seafaring Academy, 144/12 Trapper Lodge). Measured subtype ranges 144:0–12, 145:0–3, 146:0–4. |
| 212 subtype 1000 | Quest Gate — carries a quest record (and its sub-10 tail). |
| 212 subtype 1001 | Grave — carries a reward block. |
| 36 subtype ≥ 1000 | Arena location — no `u32 radius`. |
| 83 Seer Hut | Sub-10 tails as in `H3mFeatures`. |
| 16 creature bank, 53 mine, 34 hero, 98 town | Wider subtype ranges (banks to 32, mines 0–7, hero classes to 23, towns 0–11) plus HotA preset/guard blocks. |

**Rule unchanged**: a class/subtype with no mapped body is an explicit `UNSUPPORTED_OBJECT` error
with file, offset and template name — never a silent skip.

---

## 4. Render data

### `TerrainSpriteSource`

New per-terrain field in the terrain table:

```
{ kind: 'def', defName: string } | { kind: 'tiles', prefix: string, count: number }
```

The ten existing terrains keep `kind: 'def'`. Highlands (id 10) is `{ tiles, 'hglnt', 124 }`,
Wasteland (id 11) `{ tiles, 'wstlt', 124 }`. Tile names are `<prefix><index padded to 3>.pcx`; each
tile is a 32×32 indexed LOD-PCX with its own palette (M1). The atlas builder accepts decoded PCX
tiles as inputs beside DEF frames; tile choice and mirroring still come from the map tile record.

Rivers and roads are unchanged — HotA adds none, and the new terrains reuse the clear and mud river
art respectively (M7).

### `TownForms`

Replaces the three-field town sprite record:

```
{ village, fort, citadel, castle, capitol }   // DEF names, per faction
```

| Rule | Detail |
| --- | --- |
| Coverage | Nine base factions, Cove, Factory, random town. Stems are irregular and spelled out (Fortress mixes `for`/`ftr`; Conflux is eight characters with no trailing zero). |
| Selection | By fortification level: capitol → castle → citadel → fort → village. |
| Base game | With no HotA archive, base-game maps keep exactly today's behaviour — their `Objects.txt` declares only the castle form, so the placed template continues to decide (US3). |
| Resolution | Several village DEFs exist only in the base archive, so a form resolves through the archive set, not through one archive. |

### Hero sprites

Classes extend to `ah00_…ah23_` (18 Cove Captain, 19 Cove Navigator, 20 Factory Mercenary, 21
Factory Artificer, 22/23 unreleased Bulwark). Every class also has a gendered `b` body; until a
measured source for a hero's gender exists, the non-suffixed body is rendered and this is recorded
as a candidate deviation. Flags are unchanged: eight `af0?.def` with the colour baked in.

### `HotaDefConventions`

A typed, name-keyed table:

| Set | Effect |
| --- | --- |
| Shadows at palette 2/3 | For these DEFs, palette index 3 behaves like base index 1 (`(c>>1)+(c>>2)`) and index 2 like base index 4 (`c>>1`), in addition to the base indices. |
| Flag colour at index 255 | For these DEFs, the player-flag slot is index 255 instead of 5. |
| Keep selection palette | For the one listed DEF, index 5 is not made transparent. |

**Rule**: selection is by DEF name, never by archive or heuristic, so a base-game sprite is never
re-interpreted (M7). The table is seeded from the MIT source and then **replaced by the result of our
own sweep** over every `av*`/`ah*` DEF in the HotA archive, which also settles whether the listed
stems cover their numbered family members (R10).

### Palettes

`game.pal` resolves through the archive set, so the HotA palette — which differs from the base one
only at indices 65 and 67, two player flag colours — wins when a HotA archive is loaded and is
absent otherwise. Rotation ranges (lava 246–254, mud river 228–239, lava river 240–248) are
re-verified against the HotA palette during implementation.

---

## 5. Verification entities

### `MapCoverageClass`

The key by which the coverage check groups maps (FR-020, R14):

```
{ formatCode, subVersion, levels, sizeClass, terrainIds, objectFamilies, nameEncoding, scriptActive }
```

| Rule | Detail |
| --- | --- |
| Sampling | At least one map per class must be opened and pass; remaining maps of a class are sampled. |
| Edge cases | The named ones are always included: the 252×252 two-level map, the non-ASCII file name, a map with an active script block, the sub-9 and sub-10 dev maps, and one map of each base-game generation. |
| Growth | A new class appears from the classification itself; no hand-maintained list. |
| Full sweep | A flag opens every available map instead of one per class. |
| Report | Per opened map: class key, parse result, unresolved object classes with class/subtype/position, timings. A non-zero unresolved count fails the check (FR-017). |

### `ReferenceBaseline`

The reference environment gains a second baseline:

```
{ id: 'complete' | 'hota', gameRoot, executable, calibration, captureNamespace }
```

| Rule | Detail |
| --- | --- |
| Isolation | Each baseline has its own game root, its own calibration probes and its own capture folder; a capture always records which baseline produced it. |
| Comparison | A fidelity view compares a render only against captures of the matching baseline; a mismatch is an error, not a silent comparison. |
| Governance | The `hota` baseline exists only once the constitution amendment lands (FR-024). |

### `HotaBudget`

Measured, approved numbers kept beside the existing budgets: cold start with the HotA archive set,
decode-cache size, total memory, and the 252×252 two-level HotA map (up to ~53 600 objects, 1666
templates). Base-game budgets are unchanged and keep gating the base-game case (FR-027).

---

## 6. Settings

### `hotaarchive`

One new optional file setting alongside `spritearchive`, `dataarchive` and `mapfile`: type `file`,
filter `*.lod`, default null, flowing to all four host manifests from the same definition.

| Rule | Detail |
| --- | --- |
| Unset | Behaviour is byte-identical to today (US3, FR-026). |
| Set | The archive goes to the front of the archive set. |
| Wrong file | Classified like any other file; a non-LOD or unreadable file produces the existing localized message, not a crash. |
| Missing while a HotA map is loaded | A clear diagnostic naming the missing archive (US1 scenario 4, SC-007). |
