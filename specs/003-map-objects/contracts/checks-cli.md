# Contract: Checks and capture tooling (changes in spec 003)

Base contracts: [002 checks-cli.md](../../002-foundation-rewrite/contracts/checks-cli.md) and
item 1's `yarn ref` commands (AGENTS.md). Exit codes and JSON-on-stdout conventions unchanged.

## `yarn verify fidelity`

```text
yarn verify fidelity --map MAP --level 0|1 --region x0,y0,x1,y1
                    [--capture ID] [--kind still|clip] [--all-regions]
                    [--seed S] [--exclude-objects]
```

- Renders objects; non-random object pixels are compared. `--exclude-objects` restores the spec 002
  behaviour (objects masked) for diagnosis only.
- Pixels covered by an animated object sprite ignore the still's volatile mask (like palette-animated
  tiles) and are compared under the best animation state.
- Still state search: palette step, then per animated DEF a frame (research §8). Report adds
  `objectFramesByDef`, `tickConsistent`, `pixels.comparedObject`.
- Clip: object frames must advance in order on every change; `clip.objectStepMsMeasured` must be
  within one grab interval of `OBJECT_FRAME_MS`.
- Capture selection filters by the current map file's sha256; captures of another hash are reported
  once as `skip` / `map-changed`. `capture-misaligned` is attempted only for records without a
  `verification` block.
- Report: [report.schema.json](report.schema.json) `#/$defs/fidelity`; the fidelity tool validates
  against this schema from now on.

## `yarn verify budget`

- Default maps: `Arrogance.h3m`, `test_map.h3m`, the largest install map, synthetic 36×36 and
  252×252×2 (both with the same synthetic object pattern).
- New budget ids: `object-atlas-bytes` (≤ 64 MB), `sc007-object-quads` (equal between synthetic map
  sizes at the same view). `sc007-draw-calls` compares terrain + object draw calls.

## `yarn verify determinism`

Default target becomes `test_map.h3m`, level 0, region `57,51,75,67` (dense, animated, owned) at
tick 5, seed 1; falls back to the synthetic map with objects when game files are absent.

## `yarn verify all`

Unchanged composition; fidelity runs for every map with captures matching the current file hash.

## `yarn ref` changes

| Command | Change |
| --- | --- |
| `still`, `clip` | before grabbing: verify level by minimap/terrain agreement (`LEVEL_UNKNOWN` / `LEVEL_MISMATCH`), rectangle size guard (`POSITION_MISMATCH`); after grabbing (stills): terrain-render mapping check (`MAPPING_UNVERIFIED`); record gains `verification` (data-model.md). New flag `--debug-steps` saves a screenshot per step to the failures folder |
| `calibrate` | level-button probe removed; adds a minimap-scale check on a 144×144 map (default `test_map.h3m` when present) |
| `find`, `list` | output adds `mapSha256Matches` (bool) against the current file when it is found |
| `doctor` | reports the number of captures whose map hash no longer matches the file |

New error codes: `LEVEL_UNKNOWN`, `LEVEL_MISMATCH`, `MAPPING_UNVERIFIED`. Every failure still writes
a failure screenshot and stores no capture.
