# Contract: CLIs and checks

**Feature**: [../spec.md](../spec.md) | **Evidence**: [../research.md](../research.md) R2, R13, R14, R16

Shapes, exit codes and report locations follow the existing conventions: one JSON document on
stdout, logs on stderr, exit 0 ok / 1 failure / 2 usage / 3 missing files (4 skip for `verify`),
reports under git-ignored `check-reports/<check>/<timestamp>/`.

## Inspection (`yarn h3`)

| Command | Change |
| --- | --- |
| `lod list \| extract \| …` | Accept obfuscated archives; names resolved from the local dictionary when present, otherwise `#<hex>`; `archive.lod:ENTRY` works by hashing |
| `map info` | Reports `format` and `subVersion` (`0x20 sub 10`), the HotA version triple when present, and whether the script section is active |
| `map objects \| object` | Report HotA subtypes; an unresolved class/subtype is listed with its position instead of aborting the document |
| `map tiles \| tile` | Report terrain ids 10/11 by name |
| `render` | Works on HotA maps when a HotA archive is in the resolved file set |
| `def dump \| png` | Applies the HotA convention when the DEF name is in the convention table; a flag reports which convention was applied |

Game-file lookup gains the HotA archive: bare names resolve from `public/dev-assets/`, the
configured bundle's `Data`/`Maps`, and the HotA install's `Data`/`Maps` when configured.

## `yarn verify maps` (new)

```
yarn verify maps [--dir PATH]... [--all] [--require] [--json]
```

| Behaviour | Contract |
| --- | --- |
| Default | Classify every discoverable map, open at least one per coverage class plus the named edge cases |
| `--all` | Open every discoverable map instead of one per class |
| `--dir PATH` | Search exactly these folders (repeatable); without it, dev assets and both configured installs |
| Class key | format code, sub-version, level count, size class, terrain ids, object families, file-name encoding, script-active flag |
| Edge cases always included | 252×252 two-level map, non-ASCII file name, active script block, sub-9 and sub-10 dev maps, one map per base-game generation |
| Pass | Every opened map parses to exact EOF **and** reports zero unresolved object classes |
| Fail | Any parse error or any unresolved object class; the report lists file, class key, error or unresolved list |
| Skip (4) | No maps discoverable (no install configured, no dev assets) |
| Report | `check-reports/maps/<timestamp>/report.json` with per-map rows and a class summary |

## Existing checks

| Check | Change |
| --- | --- |
| `verify layers` | Unchanged rules; new modules must respect them |
| `verify determinism` | Also run on a HotA map; base-game runs unchanged |
| `verify fidelity` | Gains a baseline dimension: a view is compared only against captures of its own baseline (`complete` or `hota`); mismatched baselines are an error, not a silent comparison |
| `verify budget` | Adds the HotA case (HotA archive set, 252×252 two-level HotA map) measured against the HotA budget numbers; base-game numbers unchanged |
| `verify packages` | Unchanged; must keep rejecting game content, including anything HotA-derived |
| `verify hosts` | Adds a run with a HotA archive plus a HotA map per host, and a run with the setting unset that must behave exactly as today |
| `verify all` | Includes `maps` |

## Reference environment (`yarn ref`)

| Command | Change |
| --- | --- |
| `ref doctor \| setup \| calibrate` | Take a baseline argument (`--baseline complete\|hota`, default `complete`); the HotA baseline builds its own game root from the HotA install and records its own probes |
| `ref still \| clip \| editor \| find` | Same arguments plus the baseline; captures are stored under the baseline's namespace and records carry the baseline id |
| `ref list \| prune` | Report and filter by baseline |
| Governance | The `hota` baseline is refused until the constitution amendment is in place |

Base-game capture behaviour, verification rules (`MAPPING_UNVERIFIED`, `LEVEL_UNKNOWN`,
`LEVEL_MISMATCH`) and the floating-tile handling are unchanged.
