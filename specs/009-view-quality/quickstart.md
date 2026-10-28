# Quickstart: validating busy random places (spec 009)

Prerequisites:

- For the synthetic part, nothing.
- For the real-map part, the Complete and/or HotA installs configured in `reference-env.config.json`.
  `public/dev-assets/*.h3m` alone is enough for a smaller run.

## 1. Unit tests (synthetic, always run)

```bash
yarn test test/core/state/coverage.test.ts test/core/render/view-placement.test.ts
```

Expected results:

- The coverage of known rectangles is exact.
- An island map lands on the island.
- An empty underground switches to the surface with level "random", and stays underground with level
  "underground".
- Candidate 0 equals today's draw.
- The chosen coverage is never below candidate 0's.
- Results are identical per seed.
- Without coverage the output is unchanged.

These are the invariants listed in [data-model.md](data-model.md) "Choice".

## 2. Real maps (SC-001, SC-002, SC-004)

```bash
yarn verify places
```

The run passes (exit 0). `check-reports/places/report.json` shows, at 1920×1080, a share of draws
below 0.15 near the research figures: 14.6 % → 0.2 % over all maps, 17.2 % → 0.0 % for maps of
72×72 and larger ([research.md](research.md) R4). It also shows `worse: 0`.

## 3. One map by hand (FR-009)

```bash
yarn h3 map place "Land of Titans.h3m" --seed 7
yarn h3 render "Land of Titans.h3m" --level <level> --region <region of the chosen candidate> --palette-step 0 --scale 0.5 --out /tmp/place.png
```

Rendering a rejected candidate's region next to the chosen one shows the difference: black rock
against a populated cave region. Output format: [contracts/cli.md](contracts/cli.md).

## 4. Start-up cost (SC-003) and no regressions (SC-005)

```bash
yarn verify budget          # placeMs ≤ 20 under 4× throttling; start-up budgets still pass
yarn verify hosts           # host invariants unchanged
yarn verify corpus          # 82 views, 15 602 pixels: unchanged
yarn verify layers
```

## 5. On a real host (optional, visual)

In the browser version (`yarn dev`), with view mode "Random place", press `R` a few times on a large
map with an underground (for example `Land of Titans.h3m`). No view is solid black underground rock.
