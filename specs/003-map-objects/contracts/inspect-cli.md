# Contract: Inspection CLI (changes in spec 003)

Base contract and conventions (one JSON document on stdout, exit codes 0/1/2/3, file argument
resolution): [002 inspect-cli.md](../../002-foundation-rewrite/contracts/inspect-cli.md).

## New commands

| Command | Output |
| --- | --- |
| `map draw-list MAP --level Z --region x0,y0,x1,y1 (--time MS \| --tick N) [--seed S] [--archive LOD]` | `{ ok, map, level, region, seed, tick, paletteStep, entries: DrawListEntry[], hidden: [{id, className}], diagnostics }` |
| `map random MAP [--seed S] [--level Z]` | `{ ok, map, seed, outcomes: [{id, x, y, z, className, rule, resolved: {classId, subclassId, def, heroType?}}] }` |

`DrawListEntry` (draw order): `{ id, kind: "object"\|"heroBody"\|"heroFlag", className, def, group,
frame, frameCount, mirror, x, y, screenX, screenY, width, height, owner: 0-7\|null, flat,
visitable, random: bool, floating: bool }`. `screenX/screenY` are the top-left pixel of the full
frame relative to the region's top-left tile. Entries include objects anchored outside the region
whose sprite reaches into it.

## Changed commands

| Command | Change |
| --- | --- |
| `render MAP --level Z --region … (--palette-step N \| --time MS) --out F.png` | adds `[--tick N] [--seed S] [--no-objects] [--draw-list]`; `--palette-step N` without `--tick` uses tick N; output adds `seed`, `tick`, `stats.objectQuads`, and `drawList` when asked |
| `map objects MAP` | each object adds `hidden: bool` and `render: {def, group, flat, visitable}` after random resolution with `--seed` (default 1) |
| `def dump FILE:ENTRY` | `specialIndices` adds `flag: 5`; frames add `dataOffset` sharing info (`sharedWith`) |

## Examples

```bash
yarn h3 map draw-list test_map.h3m --level 0 --region 7,65,25,81 --tick 0
yarn h3 map random test_map.h3m --seed 1
yarn h3 render test_map.h3m --level 0 --region 55,55,73,71 --tick 3 --out /tmp/heroes.png
```
