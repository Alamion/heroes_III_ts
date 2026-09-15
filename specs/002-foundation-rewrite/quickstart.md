# Quickstart: Foundation Rewrite validation

Runnable scenarios proving the feature end to end. Commands and outputs are defined in
[contracts/inspect-cli.md](contracts/inspect-cli.md), [contracts/checks-cli.md](contracts/checks-cli.md)
and [contracts/engine-api.md](contracts/engine-api.md).

## Prerequisites

- `yarn install` (no browser download; system `/usr/bin/chromium-browser`, or set `H3_CHROMIUM`).
- Optional real files: `public/dev-assets/` and/or item 1 config (`reference-env.config.json`
  `bundleDir`). Without them, real-file steps skip with a message; synthetic steps still run.
- Optional captures: item 1 `yarn ref still|clip` results in `reference-captures/`.

## 1. Tests and static checks (no game files needed)

```bash
yarn build            # type-check + production build
yarn test             # unit tests on synthetic fixtures; real-file suites skip if absent
yarn verify layers     # expect {"ok": true, "violations": []}
yarn verify determinism --runs 10   # expect identical PNGs (SC-008)
```

## 2. Inspect game files (US1)

```bash
yarn h3 lod list h3sprite.lod --filter '*tl.def'         # terrain DEFs listed
yarn h3 def dump h3sprite.lod:watrtl.def                   # groups/frames, compression
yarn h3 def png h3sprite.lod:watrtl.def --frame 0 --out /tmp/w.png --opaque
yarn h3 map info Arrogance.h3m                             # SoD, 36, underground
yarn h3 map tile Arrogance.h3m --x 10 --y 12 --level 0
yarn h3 map info "По праву силы.h3m"                       # exit 1, UNSUPPORTED_VERSION (HotA)
yarn h3 map parse-all                                      # failed: [] (SC-002a)
```

## 3. Floating tiles → selfcheck (US2)

```bash
yarn -s h3 map floating Arrogance.h3m --level 0 --region 8,9,28,26
# tiles must include 20,24;21,24;20,25;21,25
tiles=$(yarn -s h3 map floating Arrogance.h3m --level 0 | jq -r .tiles)
yarn ref selfcheck --map Arrogance.h3m --runs 3 --floating-tiles "$tiles"   # ok (SC-003)
```

## 4. Dev harness (US3)

```bash
yarn dev   # open the printed URL
```

1. Choose `h3sprite.lod` and `Arrogance.h3m` → terrain, rivers, roads fill the window; water
   animates.
2. Arrow keys/drag scroll; `U` toggles underground; resize the window → no gaps, border outside
   the map.
3. Switch tab away and back → animation stops/resumes (verify with `window.__h3.stats()` under
   `?test=1`: `framesPresented` unchanged while hidden).
4. Reload and choose the same files → status shows `fromCache: true`, map visible < 2 s.
5. Choose `По праву силы.h3m` → short diagnostic, previous map stays.

## 5. Fidelity against the original game (US4)

```bash
yarn ref still --map Arrogance.h3m --level 0 --x 18 --y 18
yarn ref clip  --map Arrogance.h3m --level 0 --x <water tile> --duration 5000
yarn verify fidelity --map Arrogance.h3m --all-regions
# stills pass (or not-checkable / skip: capture-misaligned); clip.pass true, stepMsMeasured ≈ 180
yarn verify fidelity --map Arrogance.h3m --level 0 --region 10,10,26,26
```

Repeat for underground and a map-edge region (SC-004 needs ≥ 3 checkable regions; other install
maps may be used).

## 6. Budgets (US5)

```bash
yarn verify budget
# every budget status pass (SC-006); sc007-* pass for 36×36 vs synthetic 252×252×2 (SC-007)
```

Negative control: temporarily size the canvas to the map in the renderer → `surface` and
`sc007-gpu-bytes` fail.

## 7. Repository hygiene (US6)

```bash
git status --porcelain     # no game-derived files after all steps (SC-010)
test ! -e scripts/sync.js
grep -q homm3-parser THIRD_PARTY_NOTICES.md
```
