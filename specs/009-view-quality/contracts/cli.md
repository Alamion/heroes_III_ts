# Contract: `yarn h3 map place` and `yarn verify places`

## `yarn h3 map place` (FR-009)

```bash
yarn h3 map place MAP [--seed S] [--level-seed L] [--level random|surface|underground]
                      [--viewport 1920x1080] [--scale 1] [--border 8]
```

- **MAP**: a path or a bare name, resolved like every `yarn h3 map` command.
- **Defaults**: `--seed 1`, `--level-seed` = the seed, `--level random`, `--viewport 1920x1080`,
  `--scale 1`, `--border 8` (the engine's border band in tiles).
- It runs `placeView` with a coverage grid built from the parsed map, exactly as the engine does.
- **Exit codes**: 0 ok, 2 usage, 3 missing file, 1 parse failure.
- **Output**: one JSON document on stdout.

```json
{
  "map": "Land of Titans.h3m",
  "size": 108,
  "levels": 2,
  "view": { "cols": 60, "rows": 34, "scale": 1 },
  "threshold": 0.15,
  "chosen": 3,
  "reached": true,
  "candidates": [
    { "level": 1, "fx": 0.12, "fy": 0.03, "coverage": 0.02, "region": "9,0,68,33" },
    { "level": 1, "fx": 0.71, "fy": 0.40, "coverage": 0.11, "region": "…" },
    { "level": 1, "fx": 0.44, "fy": 0.88, "coverage": 0.07, "region": "…" },
    { "level": 1, "fx": 0.30, "fy": 0.52, "coverage": 0.34, "region": "…" }
  ]
}
```

The values above illustrate the shape; they are not real output. `region` is the view's tile
rectangle clamped to the map. It can be passed straight to `yarn h3 render … --level Z --region R` to
look at a candidate.

## `yarn verify places` (FR-008, SC-001, SC-002)

```bash
yarn verify places [--seeds 50] [--viewport 1920x1080] [--only MAP] [--require]
```

- **Maps**: every map of the configured installs (`installMaps()`, `hotaInstallMaps()`) plus
  `public/dev-assets/*.h3m`. Maps that fail to parse are listed as `skipped` and do not fail the check
  (`yarn verify maps` covers parsing).
- **Draws**: per map, `--seeds` draws with `level { random }`. The placement and level seeds are
  derived from the draw index. The same values run once without coverage (today) and once with it.
- **Exit codes**:
  - **1 (fail)**: any draw where the chosen coverage is below the first candidate's (SC-001); or,
    over all maps of at least 72×72, the share of draws below `BUSY_COVERAGE` after the change is more
    than a quarter of the share without it (SC-002); or a draw is not repeatable (SC-004, every tenth
    draw runs twice).
  - **0 (pass)** otherwise.
  - **4 (skip)**: no install and no dev-assets maps; with `--require`, exit 3 instead.
- **Report**: `check-reports/places/report.json`:
  - totals: draws, share below the threshold before and after, overall and for maps ≥ 72;
  - the mean coverage of the first and the chosen candidate;
  - how many draws switched level;
  - the grid build time on the largest map, informational only (the enforced timing is the budget's
    `placeMs`);
  - per map: the same numbers plus the worst chosen coverage with its seed, so `yarn h3 map place` can
    reproduce it.
- Runs in Node, without a browser. It is part of `yarn verify all`.
