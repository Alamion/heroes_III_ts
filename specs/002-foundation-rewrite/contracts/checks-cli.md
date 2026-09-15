# Contract: Checks CLI (`yarn verify`)

`yarn verify <name> [options]` → `node tools/checks/cli.ts` (named `verify` because Yarn 1 has a built-in `yarn check`). One JSON document on stdout; the full
report is also written to git-ignored `check-reports/<name>/<timestamp>/report.json` (plus
images). Exit codes: 0 pass (and `not-checkable`), 1 fail, 2 usage, 3 prerequisite missing,
4 skip (only when `--require` is not given; with `--require` a skip exits 3). Exit code 4 exists
only for `yarn verify`; `yarn h3` uses 0–3.

## `verify fidelity`

```text
yarn verify fidelity --map MAP --level 0|1 --region x0,y0,x1,y1
                    [--capture ID] [--kind still|clip] [--all-regions]
```

- Finds captures via item 1 `findCaptures` (newest containing the region) unless `--capture`.
- `--all-regions`: runs every still/clip capture of the map found in `reference-captures/`.
- Output: `FidelityReport` ([report.schema.json](report.schema.json) `#/$defs/fidelity`), and
  `diff.png` (red = differing, gray = excluded, dimmed original = compared/equal).
- Outcomes, evaluated in order: `skip` (reason: `no-game-files` | `no-capture` | `no-chromium`, or `capture-misaligned` when the capture's recorded tile mapping is off by one tile — detected by retrying one-tile shifts after a large difference); `fail` (any
  compared pixel differs); `not-checkable` (compared < 25 % of in-map region pixels for any
  cause; appends to `reference-captures/visual-review.json`); `pass`.
- Palette-animated tiles (from the draw plan) ignore the still's volatile mask and are compared
  under the best animation state; `pixels.comparedAnimated` reports how many.

## `verify budget`

```text
yarn verify budget [--map MAP]... [--no-build] [--throttle 4] [--viewport 1920x1080]
```

- Default maps: `Arrogance.h3m`, the largest base-game install map, synthetic 252×252×2
  (always available). Without game files: synthetic archive + synthetic maps only, and the
  report marks real-map budgets as skipped.
- Output: `BudgetReport` (`#/$defs/budget`). Budget ids: `runtime-js-gzip`, `cold-start`,
  `warm-start`, `memory`, `surface`, `hidden-frames`, `hidden-timers`, `idle-cadence`,
  `sc007-draw-calls`, `sc007-vertices`, `sc007-gpu-bytes`, `sc007-frame-cpu`.

## `verify determinism`

```text
yarn verify determinism [--runs 10] [--map MAP --level Z --region …]
```

Renders the same region N times (fresh page each) and compares PNG bytes (SC-008). Uses the
synthetic map/archive when game files are absent.

## `verify layers`

```text
yarn verify layers
```

Parses imports of `src/**` and `tools/**` with the TypeScript compiler API. Output:
`{ ok, violations: [{file, line, from, to, rule}] }`. Rules: layer order (plan.md Structure
Decision); `core/{util,data,formats,state,sim}` must not reference DOM/Worker/IndexedDB globals;
nothing imports `tools/` or `adapters/`; `core` does not import `runtime`.

## `verify all`

Runs `layers`, `determinism`, `budget`, and `fidelity --all-regions` for every map with captures;
aggregate `{ ok, results: {name: outcome} }`.
