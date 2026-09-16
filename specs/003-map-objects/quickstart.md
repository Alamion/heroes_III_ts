# Quickstart: Map Objects and Animations

Validation guide for spec 003. Commands and outputs are defined in [contracts/](contracts/); entity
fields in [data-model.md](data-model.md).

## Prerequisites

- Reference environment from item 1 set up (`yarn ref doctor` passes), Chromium available.
- `public/dev-assets/test_map.h3m` present with the hash recorded in [spec.md](spec.md) (if it was
  edited: update the zones and hash in spec.md, then `yarn ref prune` its old captures).
- `yarn install`, `yarn build`.

## 1. Capture tooling fixes (User Story 3)

```bash
yarn ref calibrate                                     # includes the 144×144 minimap check
yarn ref prune --id <the three Arrogance x1-19_y0-16 still ids>   # stale misaligned records
yarn ref still --map Arrogance.h3m --level 0 --x 10 --y 7         # top-edge view
yarn ref still --map "Shadow Valleys.h3m" --level 1 --x 20 --y 20 # underground, non-red human
yarn ref still --map "Merchant Princes.h3m" --level 0 --x 20 --y 20
```

Expected: all three succeed; each `record.json` has a `verification` block with a level agreement
margin and `mapping.bestShift` = `{dx: 0, dy: 0}`. A forced failure (e.g. wrong `--level` on a map
without underground) exits non-zero with a specific error code and a failure screenshot, and stores
nothing.

## 2. Captures of `test_map.h3m`

Tile centres of the zones (spec.md Context):

```bash
M=test_map.h3m
yarn ref still --map $M --level 0 --x 20 --y 81     # towns, all factions, owned and neutral
yarn ref still --map $M --level 0 --x 57 --y 65     # heroes of all eight players
yarn ref still --map $M --level 0 --x 66 --y 59     # dense objects (order, shadows, flags)
yarn ref still --map $M --level 0 --x 85 --y 59     # dense objects
yarn ref still --map $M --level 0 --x 118 --y 5     # rivers and roads, top edge
yarn ref still --map $M --level 0 --x 9 --y 8       # top-left map corner
yarn ref still --map $M --level 0 --x 134 --y 135   # bottom-right map corner
yarn ref still --map $M --level 1 --x 59 --y 22     # underground roads and rivers
yarn ref still --map $M --level 0 --x 28 --y 42     # random objects (expected not-checkable)
yarn ref clip  --map $M --level 0 --x 66 --y 59 --duration 4000   # animation timing
yarn ref clip  --map $M --level 0 --x 57 --y 65 --duration 4000   # hero flags
```

## 3. Spikes (before dependent code)

Record results in [research.md](research.md) "Measurements":

```bash
yarn h3 map draw-list test_map.h3m --level 0 --region 57,51,75,67 --tick 0 > /tmp/dl.json
yarn verify fidelity --map test_map.h3m --level 0 --region 57,51,75,67 --kind still
yarn verify fidelity --map test_map.h3m --level 0 --region 57,51,75,67 --kind clip
```

Expected during spikes: reports point at the pixels to measure (shadow formula, flag colours, order
pairs, hero facing, town sprites, object step duration). After the data modules are set: pass.

## 4. Objects on the map (User Stories 1, 2)

```bash
yarn dev    # choose h3sprite.lod, h3bitmap.lod and test_map.h3m; arrows scroll, U level, O objects on/off
```

Expected: objects, heroes with waving flags, towns and animated monsters/decorations; events and the
grail invisible; level U shows the three underground dwellings.

```bash
yarn verify fidelity --map test_map.h3m --all-regions
yarn verify fidelity --map Arrogance.h3m --all-regions
```

Expected (SC-001, SC-002, SC-004): every still `pass` with `pixels.comparedObject > 0` where objects
are in view, the random zone `not-checkable`, clips `pass` with `objectStepMsMeasured` within one grab
interval of `OBJECT_FRAME_MS`; no `capture-misaligned`; no `map-changed` for new captures.

## 5. Inspection (User Story 4)

```bash
yarn h3 map draw-list test_map.h3m --level 0 --region 7,65,25,81 --tick 0
yarn h3 map random test_map.h3m --seed 1
yarn h3 render test_map.h3m --level 0 --region 55,55,73,71 --tick 3 --out /tmp/heroes.png
```

Expected: draw order and owners match the map; hidden objects listed under `hidden`; the PNG shows
the objects.

## 6. Budgets, determinism, everything

```bash
yarn verify budget
yarn verify determinism --runs 10
yarn verify all
yarn test
```

Expected (SC-005, SC-006): all budgets pass including `object-atlas-bytes` and the SC-007 object
entries; determinism hashes identical; `git status` shows no game-derived files (SC-008).
Parse-and-render of all install maps without errors (SC-007 of the spec) runs as a real-file test
(skips without game files).
