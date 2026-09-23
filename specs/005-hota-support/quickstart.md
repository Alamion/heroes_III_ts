# Quickstart: validating HotA support

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Every step runs on Linux without a human, except §6 which needs a look at the screen. Commands
print one JSON document on stdout. Steps that need game files skip with a message when those files
are absent.

## 0. Prerequisites

- Base archives and maps in `public/dev-assets/` as today.
- A HotA 1.8.x install configured (`hotaBundleDir` in `reference-env.config.json` or
  `H3REF_HOTA_BUNDLE_DIR`), which supplies `Data/HotA.lod` and a `Maps` folder of 228 maps across
  four generations.
- `public/dev-assets/test_map_hota.h3m` (format `0x20`, sub-version 10, two levels, HotA novelties
  in the lower-left corner of the underground level).

```bash
yarn build && yarn test
```

Expected: type-check clean; base-game suites unchanged; HotA suites either pass or skip with a
reason naming the missing file.

## 1. The archive opens

Both installs may hold a file called `HotA.lod` and only the 1.8 one is obfuscated, so give the
path (the tools warn when a bare name is ambiguous and say which copy they picked):

```bash
HOTA=~/.wine/drive_c/Games/Heroes3_HotA/Data/HotA.lod
yarn h3 lod list "$HOTA" | head
yarn h3 lod extract "$HOTA:Objects.txt" --out /tmp/objects.txt
yarn h3 pcx png "$HOTA:hglnt000.pcx" --out /tmp/hglnt000.png
```

Expected: `"kind": "obfuscated"` with 5232 entries and `namesResolved` equal to that count when the
local name list is present (`#<hex>` otherwise); `Objects.txt` extracts to 278 015 bytes; the tile
renders as a 32×32 image. A wrong XOR key would surface as a typed error naming the entry, not as
garbage.

## 2. The maps parse

```bash
yarn h3 map info test_map_hota.h3m
yarn h3 map info "По праву силы.h3m"
yarn verify maps
```

Expected: `test_map_hota.h3m` reports `"subVersion": 10`, HotA build 1.8.1, two levels and an
inactive event system; `По праву силы.h3m` reports sub-version 9, build 1.8.0 and an **active**
event system of 3574 bytes, and still parses; `verify maps` passes with every coverage class
represented and zero unresolved object classes.

```bash
yarn verify maps --all
```

Expected: every discoverable map opens. Measured on 2026-09-23: 453 maps across dev assets and both
installs — 95 RoE, 109 AB, 119 SoD and 130 HotA of sub-versions 6, 7, 9 and 10. Any failure names
file, offset, version and structure.

## 3. Nothing base-game changed

```bash
yarn verify determinism --rebuild
yarn verify fidelity --map test_map.h3m --all-regions
yarn verify layers && yarn verify budget && yarn verify packages && yarn verify hosts
```

Expected: the verdicts each check had before this feature, including the accepted deviations of
spec 003. Renders of a base-game region at a fixed time and seed must be identical to pre-feature
renders — the determinism check covers this, and a stored reference render is compared in the test
suite.

## 4. The map renders

```bash
yarn h3 render test_map_hota.h3m --level 1 --region 0,100,30,130 --time 0 --hota "$HOTA" --out /tmp/hota-novelty.png
yarn h3 render test_map_hota.h3m --level 0 --region 0,0,20,20 --time 0 --hota "$HOTA" --out /tmp/hota-surface.png
```

Expected: the underground novelty zone shows the new terrains, town forms and HotA objects with no
unresolved object in the accompanying report; the surface region renders like any base-game map.

```bash
yarn dev
```

Expected: with the base archives, the HotA archive and `test_map_hota.h3m` loaded, both levels
scroll and animate; `O` toggles objects, `U` switches level. Unresolved objects, if any, are marked
in the harness and counted in the console.

## 5. Fidelity against HotA

Only after the constitution amendment is in place; without it every command below refuses with a
message naming the missing clause.

```bash
yarn ref doctor --baseline hota          # 21 checks, all pass once set up
yarn ref setup --baseline hota && yarn ref calibrate --baseline hota
yarn ref still --baseline hota --map test_map_hota.h3m --level 1 --x 12 --y 126
yarn ref clip  --baseline hota --map test_map_hota.h3m --level 0 --x 10 --y 20 --duration 3000
yarn verify fidelity --map test_map_hota.h3m --all-regions
```

Expected: the HotA baseline builds its own game root (`game-root-hota`), its own calibration
(`calibration-hota.json`) and its own probe masks; captures land under `reference-captures/hota/`
and carry `"baseline": "hota"`. Each capture verifies its own tile mapping before it is stored.
`yarn verify fidelity` picks the baseline from the map itself and compares only against captures of
that baseline — a capture of the other build is an error naming the mismatch, never a silent skip.
Measured on 2026-09-23 over eight views: the water clip matches pixel for pixel across 17 frames,
the seven stills differ on object pixels by 0.4 %–14 % (research.md "The open difference" — under
owner review, not yet an accepted deviation).

Captures must stay silent: Wine's audio drivers are disabled for the prefix and HotA's own
background sounds are turned off in the staged settings. Only `yarn ref` guarantees this; a
hand-run `wine h3hota.exe` does not.

## 6. On a real host (needs eyes)

```bash
yarn package --host kde && yarn accept kde --apply
```

Expected: the wallpaper appears with the HotA map; the HotA archive can be selected in the plugin's
settings and survives a restart; with the setting cleared, a base-game map behaves exactly as
before. Repeat the settings round-trip on the browser package (`yarn preview:web`). Wallpaper
Engine and Lively are verified in the Windows session, as for spec 004.

## 7. Budgets

```bash
yarn verify budget --throttle 4
```

Expected: the `hota-*` entries measured and within their numbers (cold start ≤ 12 s, warm start
≤ 3 s, memory ≤ 300 MB, object atlas ≤ 128 MB; measured 6.1 s / 2.0 s / 63 MB / 8.4 MB). The
base-game warm start sits on its 2 s limit and crosses it on some runs — a marginality that
predates this feature (see `TODO.md` housekeeping), not something HotA introduced.

## Acceptance summary

| Spec item | Proven by |
| --- | --- |
| SC-001 coverage classes | §2 `yarn verify maps`, `--all` |
| SC-002 novelty zone | §4 renders and the harness |
| SC-003 no regression | §3 |
| SC-004 HotA fidelity | §5 (measured; the remaining object-pixel difference is recorded, not waived) |
| SC-005 hosts | §6 |
| SC-006 budgets | §7 |
| SC-007 honest failure | §1–§2 typed errors, §6 with the setting cleared and a HotA map loaded |
