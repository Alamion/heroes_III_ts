# Phase 0 Research: HotA Support

**Feature**: [spec.md](spec.md) | **Date**: 2026-09-22

All numbers below were measured on 2026-09-22 against the local installs (HotA 1.8.1 at
`/home/JRCD/.wine/drive_c/Games/Heroes3_HotA`, Complete at
`/home/JRCD/.wine/drive_c/Games/Heroes of Might and Magic III Complete`) and the maps in
`public/dev-assets/`. Measurement scripts were throwaway Node scripts run outside the repository;
no game content was copied into the repository. Where a statement could not be measured it is
marked as such.

Licence discipline for this feature (constitution I): `hota-lod-convert` (MIT OR Apache-2.0),
`freeheroes` (MIT), `mmarchive-cli` (MIT) and `h3m2json` (Unlicense) may be ported with attribution
in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md); `vcmi-hota-mod` is CC BY-SA data reused
with attribution and kept out of shipped builds; `vcmi`, `vcmiextract` and `hota-editor-hdat` are
study-only — behaviour may be understood from them and reimplemented in our own words, never
copied.

---

## Measurements

### M1 — HotA 1.8.1 archive (`HotA.lod`, 111 378 616 bytes)

- Header is the vanilla 92-byte header: magic `LOD\0`, version 200, 5232 entries. The u32 at
  **offset 12** is the XOR key: `0xB5A4D744` here.
- Entry records stay 32 bytes: `u32 nameHash` (not XORed), `i32 offset ^ key`, `i32 size ^ key`,
  `i32 compressedSize ^ key`, `u8 compression` (not XORed), 15 bytes of random filler.
- Self-consistency after de-XOR: no negative field, no entry past EOF, no overlap, no duplicate
  hash; first data offset 167 516 = 92 + 32 × 5232; last entry ends exactly at file size.
- Compression histogram `{0: 1363 raw, 3: 3869 zlib}`. **No LZMA (type 2), no type 1.** All 3869
  zlib entries inflate with `DecompressionStream`/`zlib` to their declared size; 0 failures. Total
  uncompressed 244 197 916 bytes (232.9 MiB).
- Entry names are a 32-bit **FNV-1a** hash (basis `0x811C9DC5`, prime `0x01000193`) of the
  lower-cased name, no trailing NUL. Verified against all 5239 pairs in
  `context/hota-lod-convert/data/hashes.txt` (5239/5239); FNV-1, upper case and NUL-terminated
  variants match 0/5239. All 5232 entries of the local archive are covered by that dictionary.
- Extensions: pcx 2213, def 1838, msk 1106, d32 49, txt 13, fnt 10, p32 2, pal 1.
- Notable entries: `Objects.txt` 278 015 B, `objtmplt.txt` 286 B, `EdObjts.txt` 322 280 B,
  `game.pal` 1048 B. **`artraits.txt` is absent** — the vanilla data archive stays required.
- Terrain tiles: `hglnt000…hglnt123.pcx` (124) and `wstlt000…wstlt123.pcx` (124), each exactly
  1804 B, stored raw, LOD-PCX with `size=1024, w=32, h=32` (12-byte header + 1024 indexed pixels +
  768-byte palette). There is no `hglntl.def`/`wstltl.def`.
- HotA overrides four vanilla sprite entries: `grastl.def`, `watrtl.def`, `clrrvr.def`,
  `icyrvr.def`, and ships its own `game.pal`, which differs from the vanilla one in exactly two
  entries: 65 (`27,85,216` vs `50,80,255`) and 67 (`49,145,25` vs `64,150,42`) — two player flag
  colours in the 64–71 range.

### M2 — archive detection across 16 local archives

| archive | u32 @12 | obfuscated |
| --- | --- | --- |
| HotA 1.8.1 `HotA.lod` | `0xB5A4D744` | yes |
| HotA 1.7.x `HotA.lod` (Complete install) | 0 | no — plain LOD |
| `h3sprite.lod`, `sprite.lod`, `lsprite.lod` | `0x7E0213` | no — uninitialised filler |
| all others (`h3bitmap.lod`, `HotA_lng.lod`, `h3ab_*.lod`, …) | 0 | no |

Rule: obfuscated **iff** `u32 @12` is neither `0` nor `0x7E0213`. `HotA_ext.lod` and
`HotA_l_ext.lod` are 92-byte empty stubs (0 entries).

The current check in [lod.ts:23,61](../../src/core/formats/lod/lod.ts) compares `header[12]` with
the constant 135, i.e. only the low byte of one build's key. On the real 1.8.1 archive
`header[12] === 68`, so the check does not fire and the parser dies with a misleading `TRUNCATED`
instead of the intended message. `test/fixtures/synthetic/lod.ts` bakes in the same wrong
assumption.

### M3 — HotA `Objects.txt` vs vanilla

| | HotA 1.8.1 | vanilla Complete |
| --- | --- | --- |
| rows (line 1 count) | 1883 | 1326 |
| fields per row | 9 | 9 |
| passable / active mask width | 48 / 48 | 48 / 48 |
| **terrain and editor-group mask width** | **12** | **9** |
| distinct class ids | 183 (max 231) | 167 (max 231) |
| distinct class:subclass pairs | 830 | 611 |
| `group` value range | 0–10 | 0–5 |

The 12 terrain columns are ids 0–11: id 8 (water) restricted as before, id 9 (rock) present but
never set, **ids 10 (Highlands) and 11 (Wasteland)** allowed wherever dirt is. `objtmplt.txt`
inside the same HotA archive is byte-identical to the vanilla one and still uses **9**-wide masks,
so mask width must be read per file, never assumed from the archive.

[objects-txt.ts](../../src/core/formats/text/objects-txt.ts) calls `bitString(..., 9)` and rejects
any other width, so it fails on every HotA row today.

### M4 — HotA map format (`0x20`), measured over 72 maps

A from-scratch walker parsed **72/72 HotA maps to the exact last byte** of the decompressed stream —
69 in the HotA install's `Maps` folder (all sub-version 10) and 3 in `public/dev-assets/` (1 sub-10,
2 sub-9) — plus 159/159 RoE/AB/SoD maps of the same install folder as a control.

Header of `0x20` (gunzipped offsets, little-endian):

```
u32 format = 0x20
u32 subVersion                                  # 9 or 10 in the wild
u32 hotaMajor, hotaMinor, hotaPatch             # sub >= 8 (1.8.0 for sub 9, 1.8.1 for sub 10)
u8  isMirrorMap, u8 isArenaMap                  # sub >= 1
u32 terrainTypeCount                            # sub >= 2 (measured 12 everywhere)
u32 townTypeCount, i8 allowedDifficultyMask     # sub >= 5 (measured 12; mask 31 or 24)
u8  canHireDefeatedHeroes                       # sub >= 7
u8  forceMatchingHotaVersion                    # sub >= 8
i32 unknown (0 in all 72 maps)                  # sub >= 9
… then the ordinary basic info (anyPlayers, size, two levels, name, description, difficulty, cap)
```

Further divergences from SoD: allowed heroes is `u32 count` + `ceil(count/8)` bytes (count = 215 in
every HotA map) instead of a fixed 20 bytes; the map-options block gains a 16-artifact combination
ban mask, an `i32 roundLimit` and 8 per-player recruitment bytes; allowed artifacts is
`u32 count` + `ceil/8` (count = 166); predefined heroes is `u32 count` (215) records with a u16
scroll spell after every artifact slot plus a trailing 6-byte block per hero; victory condition 12
carries a **u32** day count (the Corpus says u16 — the files say u32); global events read the
occurrence field as u16 + 16 zero bytes and gain `i32 affectedDifficulties` (sub ≥ 7).

**Tiles are unchanged**: 7 bytes per tile, same field order, no new bits (only ext-flag bits 0–6
ever set across all 72 maps). **Object templates are unchanged** in size and layout; the `type`
byte now takes values 0–10 (base game 0–5; 9 and 10 unidentified).

**Object class ids never exceed 231 and never leave the base-game range.** HotA expresses new
content as new *subtypes* of existing class ids, notably classes 144/145/146 (which the repo's
`bodyFamily()` currently maps to `'none'`, but which carry bodies in HotA), class 212 subtype 1000
(Quest Gate, carries a quest) and 1001 (Grave, carries a reward), class 36 subtype ≥ 1000 (arena
location, no radius field).

Corpus scale: largest map 252×252 two levels (127 008 tiles); most objects 53 576
(`[HotA] Noble Nemesis.h3m`); most templates 1666.

### M4a — implementation sweep (2026-09-23, during T019–T029)

Implementing the reader widened the corpus: the **base install's** `Maps` folder also holds HotA
maps, including sub-versions this project had not seen before. Over all three folders
(`public/dev-assets/`, the HotA install's `Maps`, the base install's `Maps`) the implemented reader
parses **449 of 453 maps to the exact last byte**:

| format | maps |
| --- | --- |
| RoE `0x0e` | 95 |
| AB `0x15` | 109 |
| SoD `0x1c` | 119 |
| HotA `0x20` sub 6 | 7 |
| HotA `0x20` sub 7 | 51 |
| HotA `0x20` sub 9 | 2 |
| HotA `0x20` sub 10 | 67 |

The four failures are exactly the maps with an active event-system block (M5), which fail with a
typed error until that walker exists.

Two layout facts were corrected against the file bytes during implementation:

- **Town.** Between the two 9-byte spell masks and the town-event count sit **53 bytes**, not the 2
  a first reading suggested: `u8 allowSpellResearch`, then `u32 specialBuildingsCount` (48 in the
  measured maps) and that many bytes. A town event then carries `i32 creatureGrowth8, i32 amount,
  i32 specialA, i16 specialB` (sub ≥ 5) and `u8 neutralAffected` (sub ≥ 7).
- **Global events before sub 7.** Sub 6 ends a global event with the same 14-byte block a town
  event carries; sub 7 replaced it with the `i32` difficulty mask. Measured on the seven sub-6
  maps and on sub-7 maps that carry events.

Sub-versions 6 and 7 are therefore no longer "best-effort with no local evidence": 58 maps exercise
them. Sub-versions 0–5 and 8 remain unexercised.

### M5 — the script section (sub ≥ 9)

- Position: immediately after the map-options block and immediately before the allowed-artifacts
  mask. One `u8 eventsSystemActive`; if 0 nothing follows (68 of 72 maps), if 1 a variable-length
  blob with **no length prefix and no terminator** follows.
- Measured bodies: `По праву силы.h3m` 3574 B (flag at offset 1140), `[HotA] Help!` 10 630 B,
  `[HotA] Ice Assault` 3371 B, `[HotA] Invasion` 4051 B. Each length is the unique value that makes
  the remainder of the file end exactly at EOF, so the measurements are exact.
- The length is **not discoverable without walking the content**: no u32 in the first 64 bytes of
  any sample equals the body length or a simple function of it. The content is four event lists
  (hero/player/town/quest) of variable-length records with embedded Pascal strings, then id
  counters, a variable table and id→name maps, with event bodies as trees of typed opcodes
  (behaviour understood from VCMI, which is GPL and therefore study-only).
- 4 of the 72 maps have the flag set — including `По праву силы.h3m`, which the spec names in an
  acceptance scenario.

### M6 — sub-version 10 vs 9

Three deltas, each required to reach EOF on the 70 sub-10 maps and absent from the sub-9 maps:

1. Quest record (Quest Guard class 215, Quest Gate class 212 subtype 1000): **+4 bytes** at the end
   of the record (after the three message strings, or immediately after a NONE mission type).
2. Seer Hut (class 83), per quest with a non-NONE mission: **+4 bytes** between the quest strings
   and the reward-type byte.
3. Seer Hut object: **+1 byte** after the closing 2-byte pad.

All observed values are zero; the semantics are unknown. Header-wise, sub 9 files carry HotA
version 1.8.0 and sub 10 files 1.8.1.

Note: the `public/dev-assets/` copy of `[HotA] The Devil Is in the Detail.h3m` is sub-version 9,
while the copy in the install's `Maps` folder is sub-version 10.

### M7 — HotA graphics data

- **Terrains**: ids 10 Highlands, 11 Wasteland. Maximum `terrainView` measured for both is **123**
  (124 tiles), versus 78 for grass-class terrains and 45/23/32/47 for dirt/sand/water/rock, which
  HotA leaves unchanged. The per-tile index and the mirroring bits come from the map, so VCMI's
  terrain *pattern* tables are only documentation of what the indices mean and are not needed at
  render time. No new river or road ids exist: Highlands reuses the clear river, Wasteland the mud
  river.
- **Towns**: five adventure forms per faction keyed to fortification level — village, fort (`f0`),
  citadel (`c0`), castle (`x0`), capitol (`z0`) — and this applies to the **base factions too**
  (HotA ships fort/citadel/castle/capitol repaints for all nine). Stems are irregular: Fortress
  mixes `for`/`ftr` (`avcftrt0`, `avcforf0`, `avcforc0`, `avcftrx0`, `avcforz0`), Conflux truncates
  to eight characters without the trailing zero (`avchfor0`, `avchfof0`, `avchfoc0`, `avchforx`,
  `avchforz`). New factions: Cove `avccove0/f0/c0/x0/z0`, Factory `avcface0/f0/c0/x0/z0`. Several
  village DEFs live only in the base archive, so town rendering depends on archive precedence.
  In the base game `Objects.txt` declares only the `x0` template for class 98, which is why the
  repo's current two-form rule is correct there and must be scoped as base-game-only.
- **Heroes**: classes extend to `ah18_…ah23_` (18 Cove Captain, 19 Cove Navigator, 20 Factory
  Mercenary, 21 Factory Artificer; 22/23 belong to the unreleased Bulwark faction), and every class
  gains a second gendered body with a `b` suffix (`ah00b_`). Which of the two is male differs per
  class. Flags are unchanged: the same eight `af0?.def` with the colour baked in; HotA repaints only
  `af01`.
- **DEF conventions**: `context/mmarchive-cli/defConfig.json` lists 41 DEF stems whose shadows live
  in palette indices 2 and 3 (index 3 behaving like base index 1, index 2 like base index 4) and 11
  DEFs whose player-flag colour sits at index 255 instead of 5, plus one DEF whose index 5 must not
  be made transparent. The tool keys these by **file name**, not by archive or heuristic.
- **D32/P32**: corrected while implementing (2026-09-23). Counting by *extension* undercounts
  them: by content magic the archive holds **74 `D32F` and 269 `P32F`** entries, many stored under
  a `.def` or `.pcx` name (`artifact.def`, `couatl.def`, `hpl*.pcx`, `bobu*.pcx`, `cmbk*.pcx`, …).
  The conclusion is unchanged and now rests on a full sweep: **none of them has an adventure-map
  name** (`av*`/`ah*`), so the map renderer needs no truecolour decoder. Both parsers now report
  the magic with a typed "interface art only" error instead of a confusing layout failure.
- **DEF packer quirk**: 30 of the archive's 1838 `.def` entries — including adventure-map sprites
  such as `avlhpn07`–`avlhpn11` (Highlands pines) and `ahplace.def` — declare a last-frame size
  that counts the 32-byte frame header, so the frame appears to overrun the file by exactly 32
  bytes. Accepting that one alternative reading (and only when it fits the file exactly) makes all
  **1813 palette DEFs decode**; anything else still fails as truncated.
- **`HotA.dat`**: an `HDAT` container of name/description/localisation strings used by the editor;
  it holds no sprites and no map data.

---

## Decisions

### R1 — HotA archive index

**Decision**: extend `LodArchive` with a second index shape. Detect obfuscation by reading `u32 @12`
and treating anything other than `0` and `0x7E0213` as the XOR key; de-XOR offset/size/compressed
size; keep the existing `LodEntry` shape by filling `name` from the hash. Port the layout, the
detection rule and the sanity asserts from `hota-lod-convert` (MIT OR Apache-2.0) with attribution.
Implement the FNV-1a-32 name hash ourselves (it is not in that source) so `find`/`get`/`has` work by
hashing the requested name — no dictionary is needed for lookups. Delete the `HOTA18_MARKER = 135`
check and the matching synthetic fixture.

**Rationale**: measured on the real archive (M1, M2); it is the minimum change that makes every
entry addressable, and lookup-by-hash keeps the runtime free of a 120 KB name table.

**Alternatives considered**: keeping a name dictionary in the runtime (rejected: needless size, and
it would have to ship a list of game file names); converting HotA archives to plain LODs up front
(rejected: writes derived game data to disk, contradicts constitution I).

### R2 — Entry names for tooling

**Decision**: names are not needed at runtime. The inspection CLIs (`yarn h3 lod list`) resolve
hashes through `context/hota-lod-convert/data/hashes.txt` when that local, git-ignored folder is
present, and otherwise print the hashes as `#<hex>`; `archive.lod:ENTRY` arguments always work,
because the name is hashed. Nothing is committed to the repository.

**Rationale**: keeps the repository free of game-derived name lists while leaving the dev workflow
intact; the dictionary is already in `context/` on this machine.

**Alternatives considered**: committing the MIT dictionary (it is third-party data, not game
content, so it would be defensible — kept as a fallback if the dev experience suffers).

### R3 — Multiple archives and precedence

**Decision**: introduce an ordered **archive set** in `core/formats/lod`: a list of opened archives
queried first-match-wins, with the HotA archive placed before the base archives. The runtime decode
paths take a set instead of a single archive, and the decode cache key combines the identity of
every archive in the set, in order.

**Rationale**: HotA overrides `grastl.def`, `watrtl.def`, `clrrvr.def`, `icyrvr.def` and `game.pal`
(M1), and several town village DEFs exist only in the base archive (M7), so both directions of the
merge are load-bearing. `tools/shared/game-sprites.ts` already uses exactly this first-match-wins
pattern, so the semantics are proven in the repo.

**Alternatives considered**: a HotA-specific special case in each decode function (rejected:
scattered rules, no single precedence definition).

### R4 — `Objects.txt` mask width

**Decision**: read the terrain and editor-group mask width from the row itself, accept exactly 9 or
12, require every row of one file to agree, and map the 12-column form to terrain ids 0–11 with the
same "leftmost column is the highest id" convention as today.

**Rationale**: measured (M3); `objtmplt.txt` proves the width cannot be inferred from the archive.

**Alternatives considered**: branching on "is this the HotA archive" (rejected by the counter-example
in the same archive).

### R5 — Map format versioning

**Decision**: replace the flat `H3mVersion` union with a version descriptor carrying format code and
sub-version, and extend `H3mContext` with a **feature table** derived from (format, sub-version):
the existing `ab`/`sod` flags stay, and HotA features become named flags (`hotaHeaderVersionTriple`,
`hotaCountedHeroes`, `hotaScriptSection`, `hotaQuestTail`, `hotaSeerTail`, …). Port the shape of the
feature table from FreeHeroes (MIT, sub-versions 0–3 and 5) with attribution, and fill 6–10 from the
measurements in M4/M6.

**Rationale**: every section reader already branches on context flags rather than a raw version, so
this keeps the existing structure and makes the sub-version deltas declarative and reviewable.

**Alternatives considered**: a separate HotA parser (rejected: duplicates the 90 % of the format that
is identical and risks base-game regressions, which US3 forbids).

### R6 — The script section

**Decision**: implement our own bounds-checked walker of the event-system block, written from an
understanding of the behaviour (VCMI is study-only) and validated against the four maps that carry
one. A parse is accepted only when the file ends exactly at EOF after the 124 trailing zero bytes;
if the walker cannot complete, the map fails with a typed `UNSUPPORTED_*` error naming the section
and offset. No length guessing, no trial-and-error skipping.

**Done (2026-09-23, T051/T052).** The grammar was derived for this project and the walker consumes
exactly the measured body of every map that has one — 3574, 10 630, 3371 and 4051 bytes — with no
length hint, after which each map still ends at its 124-byte trailer. Shape: four event lists
(hero, player, town, quest), five next-id counters, a variable table and five id tables; an event
holds an id, an action block and a name; an action block is a marker, a reserved byte, a count and
that many actions; actions, conditions and expressions are typed trees with embedded Pascal
strings. Six values that are constant in every measured block are asserted, because nothing here is
length-prefixed and a wrong opcode would otherwise desynchronise silently. Opcodes the four maps do
not exercise are implemented from the same understanding and marked in the source; an unknown code
raises `UNSUPPORTED_OBJECT` rather than guessing.

**Corpus effect**: all 453 local maps now parse to the exact last byte — 95 RoE, 109 AB, 119 SoD
and 130 HotA across sub-versions 6, 7, 9 and 10.

**Rationale**: `По праву силы.h3m` is named in an acceptance scenario (US2.3) and carries an active
script block, so skipping it is not optional. The exact-EOF rule is a strong, cheap invariant that
already holds for all 231 maps parsed in M4.

**Alternatives considered**: rejecting maps with the flag set (rejected: fails a named acceptance
scenario, and 4 of 72 HotA maps are affected); searching for the body length by trying every offset
and keeping the one that reaches EOF (rejected: that is exactly the guessed skip the constitution
forbids, and it costs a full re-parse per candidate).

### R7 — Terrain from PCX tiles

**Decision**: give the terrain data table a per-terrain **source**: either one DEF (all ten existing
terrains) or a numbered PCX tile set (`hglnt000…123`, `wstlt000…123`, 124 tiles each), and teach the
atlas builder to accept decoded PCX tiles as inputs alongside DEF frames. The tile index and the
mirroring bits keep coming from the map tile record, unchanged.

**Rationale**: measured (M1, M4, M7). No pattern matching is needed: the map stores the chosen tile.

**Alternatives considered**: synthesising a DEF in memory from the 124 PCX files (rejected: an extra
representation for no gain); pattern-based tile selection from VCMI's tables (rejected: unnecessary
for rendering an existing map, and GPL-sourced).

### R8 — Town forms

**Decision**: replace the three-field `TOWN_SPRITES` entry with a five-form record (village, fort,
citadel, castle, capitol) per faction, as a hand-written table with the irregular stems spelled out,
covering the nine base factions plus Cove and Factory plus the random town. Form selection is driven
by the town's fortification level. The base game keeps its measured behaviour, because its
`Objects.txt` only declares the castle form; the AGENTS.md rule is re-scoped as base-game-only.

**Rationale**: measured (M7); no naming formula fits the irregular stems.

**Alternatives considered**: deriving names by formula with exceptions (rejected: more moving parts
than a table of 13 rows).

### R9 — Heroes

**Decision**: extend the hero class table to `ah00_…ah23_`, keep the existing flag scheme unchanged,
and render the non-suffixed body by default. The gendered `b` bodies are supported by the data table
but only selected once a measured source for a hero's gender exists; until then the default is
documented as a known deviation candidate.

**Rationale**: measured (M7); the gender source was not found in HotA's text tables and is not worth
blocking the feature on.

### R10 — HotA DEF conventions

**Decision**: a typed data module lists the DEF names whose shadows live at palette indices 2/3 and
those whose flag colour sits at index 255, seeded from `mmarchive-cli` (MIT, attribution) and then
**verified by our own sweep** over every `av*`/`ah*` DEF in the HotA archive (count pixels at indices
2, 3 and 255 and compare with the list). The decoder picks the convention by DEF name.

**Rationale**: measured convention and measured detection method (M7); a heuristic would silently
mis-shade base-game sprites, which US3 forbids.

**Sweep result (2026-09-23, T041)** — the survey's framing was wrong, and the measurement replaced
it:

- **Shadows at 2/3 are not an exception, they are how HotA draws.** Decoding every adventure sprite
  of both archives found indices 2 or 3 in **699 of 1072** HotA sprites and in **2 of 1369**
  base-game ones, where they cover 1 and 25 pixels in total. So no name list is needed: the index
  itself is the signal, and `SHADOW_KINDS` covers every sprite. The mapping was corrected at the
  same time — index 3 behaves like base index 1 (light) and index 2 like base index 4 (dark), the
  opposite of what the table assumed before.
- **The flag colour at index 255 cannot be measured.** Index 255 is an ordinary colour elsewhere
  (1052 of 1369 base-game adventure sprites use it), and the sprites that follow the rule use index
  5 as well, so nothing in the pixels separates them. That list stays a short, ported,
  **unverified** table in `src/core/data/hota-def-conventions.ts`, and its risk is recorded there:
  a wrong entry would tint a sprite's index-255 pixels with the owner's colour.

### R11 — Palettes and player colours

**Decision**: nothing special. `game.pal` resolves through the archive set (R3), so the HotA palette
— including the two changed flag colours at indices 65 and 67 — wins automatically when the HotA
archive is loaded, and the base palette is used when it is not.

**Verified (2026-09-23, T037)**: the two palettes differ in exactly those two entries, neither of
which lies in a rotation range, and the rotating sprites HotA overrides keep their palettes
byte-for-byte (`watrtl.def` and `clrrvr.def`: no differing entry). The measured rotation ranges
therefore hold unchanged under HotA.

The same comparison turned up a fact that matters for rendering: HotA's `watrtl.def` has **80
frames where the base game has 33**, and its `icyrvr.def` is a full repaint (250 palette entries
differ). Both resolve through the archive set, so a HotA map may legitimately use a water view
index far above the base game's maximum — which is only available when the HotA archive is
loaded.

### R12 — Explicitly out of scope, with evidence

- **LZMA and compression type 1**: 0 entries in the local archive (M1). An entry using them produces
  a typed "unsupported compression" error naming the entry.
- **D32/P32 decoding**: all 51 entries are interface art (M7).
- **`HotA.dat`**: a text/description container, not needed for the adventure map (M7).
- **`EdObjts.txt`**: an editor-only table in a different, undocumented shape (no count line, mixed
  field counts, comments) with no established rendering role (M1).
- **HotA saves, random-map templates and campaigns**: later roadmap items.

### R12a — Object atlas page size (added 2026-09-23)

**Decision**: the object atlas page size is chosen from the GPU's `MAX_TEXTURE_SIZE`, clamped to
2048–4096, instead of being fixed at the 2048 that WebGL 1.0 guarantees. The size is part of the
decode-cache identity.

**Rationale**: measured — `test_map_hota.h3m` needs 4610 object frames and 29.3 M sprite pixels,
while six 2048² pages hold 25.2 M, so the object layer failed outright with `OBJECT_ATLAS_OVERFLOW`.
Six 4096² pages hold 100 M and leave headroom for the 252×252 HotA map. The page count stays 6
because WebGL 1.0 guarantees only 8 texture units (6 pages + palette + terrain).

**Alternatives considered**: raising the page count to 7 (rejected: it would use the last guaranteed
texture unit and still only just fits this one map); dropping sprites that do not fit and reporting
them as unresolved (rejected as the primary answer: it would fail the spec's "zero unresolved
objects" bar for the owner's own check map, though it remains the fallback if a map ever exceeds
even the larger pages); scoping the atlas to the visible region (the proper long-term fix for
constitution IV, but a renderer change well beyond this feature — recorded as a follow-up).

**Follow-up**: a region-scoped object atlas is the only thing that makes object GPU memory
independent of map size; until then the budget check must measure the HotA case (FR-027).

### R13 — Fidelity reference for HotA

**Decision**: add a second baseline to the reference environment — the HotA build (`h3hota.exe`) from
the separate 1.8.1 install — with its own game root, its own calibration probes and its own capture
namespace, so a capture is always labelled with the baseline it came from and HotA captures can
never be compared against base-game renders or vice versa. The constitution is amended in the same
change (Principle II and the "Formats in scope" list), together with the HotA budget numbers of R16.

**Rationale**: the owner chose captures from the HotA build over editor-only verification; the
constitution currently fixes Complete as the only baseline, so the amendment is part of the feature
(FR-024).

**Alternatives considered**: HotA editor captures only (rejected by the owner: no animation or
palette verification); reusing the base-game calibration (rejected: the HotA interface and menus
differ, and the existing probes are calibrated against the Complete build).

### R14 — The coverage check

**Decision**: a new check classifies every available map by (format code, sub-version, level count,
size class, terrain ids used, object class/subtype families used, file-name encoding, script flag)
and opens at least one map per class plus the named edge cases, reporting per opened map whether it
parses and whether every object class resolves. A flag runs it over every available map. The
classification reads only the header and the template table for most classes, so it is cheap.

**Rationale**: the owner's acceptance bar is "every distinct variant and edge case", and a
classification picks up a new variant automatically while a hand-written list rots.

### R15 — Hosts and settings

**Decision**: one new optional file setting (`hotaarchive`, filter `*.lod`) in the shared settings
definition, flowing to all four host manifests from the same source as the existing archive
settings, and appended to the archive set before the base archives when set. Absent setting = today's
behaviour, byte for byte.

### R16 — Budgets

**Decision**: measure the HotA case separately (cold start with a 111 MB archive, cache size, memory,
the 252×252 two-level map with up to ~53 600 objects) and record HotA-specific numbers in the
constitution amendment of R13. Base-game budgets are unchanged and keep gating the base-game case.
Note for the implementation: `archiveIdentity` already hashes only the header and index, so archive
size does not affect identity cost; the decode cache and the 248 new terrain tiles are the parts to
watch.

**Measured (2026-09-23, T075)** at 1920×1080, DPR 1, under 4× CPU throttling, with the HotA archive
set and `test_map_hota.h3m`:

| | measured | enforced | base-game budget |
| --- | --- | --- | --- |
| cold start | 6.1 s | 12 s | 10 s |
| warm start | 2.0 s | 3 s | 2 s |
| memory (JS heap + GPU) | 63 MB | 300 MB | 300 MB |
| object atlas | 8.4 MB | 128 MB | 64 MB |
| hidden frames / timers | 0 / 0 | 0 / 0 | same |
| idle cadence | 28 frames / 5020 ms | 29 | same |

The case turned out far cheaper than feared: only the two start-up numbers need headroom, because the
archive is about twice the size of the base pair and its index is obfuscated. Memory keeps the base
limit. The atlas limit is structural — six pages at the largest page size the GPU allows — and the
8.4 MB measured is with 4096² pages (R12a). Recorded in constitution 1.3.1.

---

## US3 verification (2026-09-23, T061–T064)

Evidence that HotA support is additive:

- **Renders**: the six base-game regions captured before any source change (both levels, three
  palette times, fixed seed) reproduce **byte for byte** after the whole feature —
  `test/real/base-render-unchanged.test.ts` compares the committed SHA-256 digests. An earlier
  mismatch in that test was the test's own viewport, not the renderer: rendering through the CLI,
  exactly as the baseline was taken, matched the stored digest immediately.
- **Fidelity**: `yarn verify fidelity --map test_map.h3m --all-regions` was run twice — once on the
  feature branch and once in a temporary worktree of the commit before the first source change.
  Both report **7 fail / 5 pass over the same 12 captures, and the seven failing captures are the
  same seven**, i.e. the accepted deviations of spec 003 (draw order in dense mountain clusters,
  reef frames and shadows) and nothing new.
- **Determinism and layers**: both pass.
- **Budgets**: the base-game warm start sits on its 2 s limit and crosses it on some runs — a
  pre-existing marginality the housekeeping note in `TODO.md` already records. Measured on the same
  machine: the feature branch had one marginal failure (Arrogance 2093 ms), a worktree of the
  pre-feature commit had three (test_map cold 18 750 ms, test_map warm 2866 ms, Pandora 2073 ms).
  The feature is therefore not the cause, and it did not make it worse.
- **Without game files**: in a worktree with no `public/dev-assets` and no reference-env config the
  suite is 48 files passed, 8 skipped, 290 tests passed, 29 skipped — every real-file suite skips
  with a named reason and nothing fails.

## US4 — the HotA reference baseline (2026-09-23, T066–T071)

The second baseline runs `h3hota.exe` under Wine on a virtual display, exactly as the Complete
edition baseline runs `Heroes3.exe`, with its own game root, its own calibration and its own
capture namespace (`reference-captures/hota/…`). Everything below was measured on the owner's
HotA 1.8.1 install.

### What HotA needs to start from a staged root

`h3hota.exe` exits with code 5, silently, unless `patcher_x86.dll` is present, and then stops with
a "binkw32new.dll is not found" box until that file is staged too. Both ship with HotA (the first
is on the Complete baseline's forbidden list because there it would come from HD Mod). With
`HotA.dll`, `HotA.dat`, `HotA_Data/`, the vanilla runtime DLLs and `Data/HotA*.lod` plus the base
archives, the game reaches its main menu, loads `test_map_hota.h3m` and reveals it with
`nwcwhatisthematrix` — the same cheat as the base game. HD Mod files (`HD_*`, `_HD3_*`, `HW_*`,
`h3hota HD.exe`) are never staged, and `yarn ref doctor --baseline hota` verifies that both from
the staged folder and from the modules the running game loaded.

`HotA_Setup.ini` is staged as a **copy** with `AutoUpdate=false`, so a capture run neither goes
online nor writes to the install. The same rule now covers every `.ini` of both baselines: a
symlinked ini would let the game write into the owner's game folder, which is exactly what
`yarn ref` must never do. A test asserts it (`test/reference-env/foundation.test.ts`).

### Silence

Captures run on the developer's machine, so a capture must never make a sound. Wine's audio
drivers (`winepulse`, `winealsa`, `wineoss`, `winecoreaudio`) are disabled for the whole prefix,
and HotA's own `Enable Bckgr Sounds` is set to false in the staged settings. Both are asserted by
tests. (The one time sound was heard in this session, it came from a hand-run `wine` command that
bypassed the tooling's environment, not from `yarn ref`.)

### Recognising HotA's screens: nothing on them holds still

The Complete edition draws its menus as still images, so a hash of a screen region identifies a
screen. HotA animates the main menu behind the buttons: over eight frames, **41 942 of the button
column's 124 200 pixels change**, and no sub-region of the menu is still. Two consequences:

- *Finding the menu during calibration* (no probes recorded yet) cannot use "the screen stopped
  changing". What separates a playing video from a drawn menu is **lit pixels that hold still**: a
  video's only constant areas are black letterbox. Measured over a launch: 0–3 such pixels while
  the logos and the intro movie play, then 90 000–146 000 from the frame the menu appears. The
  threshold is 20 000, roughly a factor of five from either side.
- *Recognising a screen later* uses a **stable-pixel mask** recorded during calibration: eight
  frames 350 ms apart, the pixels identical in all of them, hashed in that order. The masks are
  derived from game output, so they live in `~/.local/state/h3-reference/probes-hota/` and are
  never committed. A screen with fewer than 2000 stable pixels is refused as unrecognisable.

### Geometry: same pixels, different rectangle

HotA's adventure map at 800×600 uses **the same pixel mapping as the Complete edition**. Measured
by rendering our own terrain at every candidate offset against a revealed HotA screenshot: the
match is at camera offset (3432, 64) with **0.21 % of 228 226 compared pixels differing**, and the
next-best candidate differs on 92 %. That offset is exactly `originTile (107, 2)` with the vanilla
viewport `{8, 8, 592, 544}` and origin pixel `{0, 8}`.

What does differ is the view rectangle HotA draws on the minimap: **19×18 tiles instead of 19×17**,
while the view it stands for is still 17 rows tall (centring a view puts the target 9 columns and
8 rows in, as in the base game). The two uses were therefore separated: the rectangle's size is a
per-baseline profile value used to read the origin back, and the view's size stays shared. Without
that split, positioning is off by one row at a clipped map edge and by nothing elsewhere — which is
how the difference first showed up.

### Captures and fidelity

Seven stills and one clip of `test_map_hota.h3m` were taken, covering the Highlands and Wasteland
terrains at full-view density, three HotA factions across all five town forms, the base-game town
block, the novelty zone in the lower-left of the underground, and HotA's 80-frame water. Every one
passed the tooling's own mapping verification at zero shift (0.4 %–1.6 % of terrain pixels
differing, the rest exact).

`yarn verify fidelity --map test_map_hota.h3m --all-regions` then gives:

| View | Level | Outcome | Differing of 319 947 compared |
| --- | --- | --- | --- |
| water clip, 17 frames | 0 | **pass** | 0 (0.00 %) |
| Cove/Bulwark towns near the novelty zone | 1 | fail | 1 348 (0.42 %) |
| base-game town block | 0 | fail | 3 930 (1.23 %) |
| Wasteland | 1 | fail | 8 402 (2.63 %) |
| Cove/Castle town forms | 1 | fail | 13 745 (4.30 %) |
| Highlands | 1 | fail | 17 520 (5.48 %) |
| novelty zone | 1 | fail | 27 438 (8.58 %) |
| Factory/Cove/Bulwark town forms | 1 | fail | 44 918 (14.04 %) |

The clip result is the strongest single piece of evidence in this feature: across 17 frames of
HotA's own 80-frame water, **every pixel matches**, and the palette step advances by exactly one
per change at a measured 183.3 ms against the expected 180 ms (one 60 fps grab quantum).

The clip also exposed a real flaw in the checker, now fixed: a view whose animated objects never
change frame produced "object timing could not be measured", which was reported as a failure. It is
now reported as not measured, with a null interval, and only a measured-and-wrong interval fails.

### The open difference

The seven failing stills differ only on **object pixels** — flat terrain matches, and the terrain
views' failures sit on object silhouettes, their shadows and vegetation. Two obvious explanations
were tested and ruled out:

- **Not the shadow-index mapping.** Swapping HotA's indices 2 and 3 changes the Wasteland view's
  differing count by exactly zero, so those pixels are not drawn through index 2 or 3.
- **Not RGB565 quantisation.** Of 10 503 differing pixels, zero are explained by quantising either
  side to the other; only half are within one quantisation step.

The differences are small and systematic (our pixels are usually one or two steps brighter) and
concentrated where objects meet terrain. The likely remaining causes, in order: a HotA-specific
frame choice for objects the checker does not know animate, and a shadow rule that differs from the
base game's for HotA sprites. This is recorded as an open question, not an accepted deviation: it
needs owner review with the diff images in `check-reports/fidelity/` before it can be called one.

### Town forms measured against the game (2026-09-23, after US4)

The first thing the HotA captures were used for was the open object-pixel difference. Attributing
every differing pixel of the town view to the sprite that drew it (each draw-list entry's rect, top
one wins) put **all 47 019 of them on town sprites**, and the palette test was decisive: the colours
the game drew are **not in `avcbulf0.def`'s palette at all**, while 77.6 % of them are in
`avcbulc0.def`'s. The game was drawing a different form of the same town.

Rendering every town in the view as each of the five forms and counting differing pixels per town
against the capture settled the rule on twenty towns of four factions:

| Built | Form the game draws | Best-match pixels vs the next form |
| --- | --- | --- |
| nothing | village | 0 |
| fort | fort | 858–1 268 vs 4 285–11 820 |
| fort + citadel | citadel | 1 704–3 131 vs 3 294–12 560 |
| fort + citadel + castle | castle | 1 350–3 077 vs 2 494–15 996 |
| all, incl. capitol | capitol | 1 384–2 278 vs 1 762–3 026 |
| **fort + capitol, no castle** | **fort** | **858 vs 13 942 for the capitol form** |

Two defects followed, both now fixed:

- **The capitol form is the castle with a capitol on top**, so it needs both. Our rule checked the
  capitol bit first and drew the capitol form for a town with a Capitol but only a Fort. That
  combination cannot be built in play but the editor places it, and the owner's map has one — which
  is exactly why the check map holds every combination.
- **HotA 1.8.1 has a twelfth town** (sprite stem `bul`), and our table stopped at eleven factions,
  so all five of its forms fell back to the map template's sprite. The map header said so all along:
  sub-version 10 reports 12 town types, and `HotA.lod` ships `avcbule0/f0/c0/x0/z0.def`. It is not
  playable in 1.8.1, but the editor places it and the game draws it.

Both are covered by tests on synthetic maps (`test/core/formats/h3m-hota.test.ts`), which is why the
fixture can now place towns with a chosen building mask.

Effect on the HotA fidelity views: the town-forms view went from 44 918 to **16 227** differing
pixels (14.04 % → 5.07 %) and the Cove/Castle forms view from 13 745 to **9 610** (4.30 % → 3.00 %).
Base-game fidelity is unchanged at 7 fail / 5 pass.

### The open difference, narrowed

What remains after the town fixes is smaller and of one kind: thin outlines along object edges and a
band of terrain beside some objects, on every view with objects (0.42 %–8.58 %). Measured facts:

- It is **not** the shadow-index mapping. Swapping HotA's indices 2 and 3 changes the differing
  count by exactly zero on both the Wasteland view and the town view.
- It is **not** RGB565 quantisation: the game's own colours are quantised too (the reference's
  pixels sit in the quantised palette, not the raw one), and no differing pixel is explained by
  quantising either side to the other.
- The remaining pairs are neighbouring palette entries (e.g. `123,81,58` → `99,77,58`: one channel
  unchanged, the others off by one and three steps), not a uniform darkening — so it is a different
  palette **index**, not a different shading of the same one.

That points at the frame chosen for objects the checker does not know animate, or a HotA rule for
which pixels of a sprite are shaded. Still an open question for owner review, with the diff images
in `check-reports/fidelity/`.

## Risks and open questions

| # | Risk / unknown | Handling |
| --- | --- | --- |
| 1 | Script-section grammar is known only from a study-only source | Own walker validated by exact-EOF on the four maps that have one; honest typed failure otherwise (R6) |
| 2 | Sub-10 deltas are measured but their meaning is unknown, and unexercised object classes may hold more | Deltas are declared as named feature flags with a comment stating they are measured-not-understood; the coverage check would catch a new failure as a parse error, not a misread |
| 3 | HotA quirk DEF lists may be incomplete or stem-based | Verified by our own sweep before the table is committed (R10) |
| 4 | Sub-versions 0–8 are unavailable locally | Best-effort per FR-006a; a mismatch fails with a typed error |
| 5 | An unseen HotA build may use LZMA or a different key | Typed "unsupported compression" error; the key is read per file, never assumed constant |
| 6 | A third-party vanilla LOD could carry junk at bytes 12–15 other than `0`/`0x7E0213` | Only two junk values observed across 16 archives; the de-XOR sanity asserts catch a wrong key and produce a typed error instead of garbage |
| 7 | HotA hero gender source not found | Default to the non-suffixed body; documented (R9) |
| 8 | HotA fidelity may expose base-game rules that were only ever verified on base sprites | Measured: it does. Seven of eight HotA views differ on object pixels by 0.4 %–14 %, terrain and water are exact (US4 above). Cause not yet identified; awaiting owner review, not accepted silently |
