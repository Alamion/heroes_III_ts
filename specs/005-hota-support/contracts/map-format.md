# Contract: HotA map format (`0x20`)

**Feature**: [../spec.md](../spec.md) | **Evidence**: [../research.md](../research.md) M4–M6, R5, R6

## Version handling

```
parseH3m(bytes) →
  code = u32 @0
  code ∈ {0x0e, 0x15, 0x1c} → base-game path, unchanged in every byte
  code === 0x20            → subVersion = u32 @4; HotA path
  otherwise                → UNSUPPORTED_VERSION naming the code and the known labels
```

| Sub-version | Contract |
| --- | --- |
| 9, 10 | Required. Must parse to exact end of file. |
| 0–8 | Best-effort from the ported sources. A parse that does not end at EOF fails with a typed error naming the section and offset — never a partial map. |
| > 10 | `UNSUPPORTED_VERSION` naming the sub-version. |

The parsed map reports `{ code, subVersion }`; `yarn h3 map info` prints both.

## Header additions (in order, after `u32 format`)

```
u32 subVersion
u32 hotaMajor, hotaMinor, hotaPatch      # sub >= 8
u8  isMirrorMap, u8 isArenaMap           # sub >= 1
u32 terrainTypeCount                     # sub >= 2
u32 townTypeCount, i8 difficultyMask     # sub >= 5
u8  canHireDefeatedHeroes                # sub >= 7
u8  forceMatchingHotaVersion             # sub >= 8
i32 reserved                             # sub >= 9  (0 in all measured maps; meaning unknown)
```

then the ordinary basic info (`anyPlayers`, size, two levels, name, description, difficulty, level
cap).

## Section deltas from SoD

| Section | Delta |
| --- | --- |
| Victory condition 12 | day count is **u32**, not u16 |
| Allowed heroes | `u32 count` + `ceil(count/8)` bytes (measured count 215) instead of fixed 20 bytes |
| Map options | + 16-artifact combination ban mask, `i32 roundLimit`, 8 per-player recruitment bytes |
| Script section | sub ≥ 9, see below |
| Allowed artifacts | `u32 count` + `ceil(count/8)` (measured 166) |
| Predefined heroes | `u32 count` records; u16 scroll spell after every artifact slot; trailing 6-byte block per hero |
| Tiles | **unchanged**: 7 bytes, same order; terrain ids extend to 11; ext-flag bits 0–6 only |
| Object templates | **unchanged** in layout; `type` values 0–10 accepted (9, 10 unidentified) |
| Global/town events | occurrence read as u16 + 16 zero bytes; `i32 affectedDifficulties` (sub ≥ 7) |
| File end | 124 zero bytes, then exact EOF |

## Script section (sub ≥ 9)

Position: immediately after the map-options block, immediately before the allowed-artifacts mask.

```
u8 eventsSystemActive
  0 → nothing follows
  1 → walked structure: four event lists (hero / player / town / quest),
      id counters, a variable table, id→name maps; event bodies are trees of
      typed opcodes with length-prefixed strings
```

| Rule | Contract |
| --- | --- |
| No length prefix | The body has neither a length nor a terminator; it must be walked. |
| No guessing | Skipping by a searched or assumed length is forbidden (constitution VII). |
| Failure | A walker that cannot proceed raises a typed error with section and offset; the map is reported unsupported and the host keeps running. |
| Validation | Every map parse is accepted only when it ends exactly at EOF after the 124 zero bytes. Known bodies for regression: 3574, 10 630, 3371, 4051 bytes in the four local maps that carry one. |

## Object bodies

| Class / subtype | Contract |
| --- | --- |
| 144 (0–12), 145 (0–3), 146 (0–4) | Have bodies in HotA; the base-game `'none'` mapping must not be applied to HotA maps |
| 212 / 1000 | Quest Gate — quest record (with the sub-10 tail) |
| 212 / 1001 | Grave — reward block |
| 36 / ≥ 1000 | Arena location — no `u32 radius` |
| 83 Seer Hut | sub 10: +4 bytes before the reward type per non-NONE quest, +1 byte after the object |
| Quest records | sub 10: +4 bytes at the end of the record (also when the mission type is NONE) |
| 16, 34, 53, 98 | Wider subtype ranges: banks to 32, hero classes to 23, mines 0–7, towns 0–11, plus HotA preset/guard blocks |
| anything unmapped | `UNSUPPORTED_OBJECT` with class, subtype, template name and offset — never a skip |

## Errors

Every failure is a `FormatError` with `format: 'h3m'` and `file`, `offset`, `structure`, plus
`version`, rendered as `HotA sub N` for HotA maps and as the version name (`RoE`, `AB`, `SoD`) for
the base game. Existing codes are reused: `TRUNCATED`, `UNSUPPORTED_VERSION`,
`UNSUPPORTED_OBJECT`, `INVALID_VALUE`, `TRAILING_DATA` (raised when a parse does not end at EOF).
