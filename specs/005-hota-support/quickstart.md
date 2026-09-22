# Quickstart: validating HotA support

**Feature**: [spec.md](spec.md) | **Plan**: [plan.md](plan.md)

Every step runs on Linux without a human, except §6 which needs a look at the screen. Commands
print one JSON document on stdout. Steps that need game files skip with a message when those files
are absent.

## 0. Prerequisites

- Base archives and maps in `public/dev-assets/` as today.
- A HotA 1.8.x install configured (locally: `/home/JRCD/.wine/drive_c/Games/Heroes3_HotA`), which
  supplies `Data/HotA.lod` and a `Maps` folder of 237 maps across four generations.
- `public/dev-assets/test_map_hota.h3m` (format `0x20`, sub-version 10, two levels, HotA novelties
  in the lower-left corner of the underground level).

```bash
yarn build && yarn test
```

Expected: type-check clean; base-game suites unchanged; HotA suites either pass or skip with a
reason naming the missing file.

## 1. The archive opens

```bash
yarn h3 lod list HotA.lod | head
yarn h3 lod extract HotA.lod:Objects.txt --out /tmp/objects.txt
yarn h3 pcx png HotA.lod:hglnt000.pcx --out /tmp/hglnt000.png
```

Expected: 5232 entries listed (names where the local dictionary resolves them, `#<hex>` otherwise);
`Objects.txt` extracts to 278 015 bytes; the tile renders as a 32×32 image. A wrong XOR key would
surface as a typed error naming the entry, not as garbage.

## 2. The maps parse

```bash
yarn h3 map info test_map_hota.h3m
yarn h3 map info "По праву силы.h3m"
yarn verify maps
```

Expected: `test_map_hota.h3m` reports `0x20 sub 10`, two levels, script section inactive;
`По праву силы.h3m` reports `0x20 sub 9` with the script section **active** and still parses;
`verify maps` passes with every coverage class represented and zero unresolved object classes.

```bash
yarn verify maps --all
```

Expected: every discoverable map opens — 72 HotA maps and 165 base-game maps in the install plus
the dev assets. Any failure names file, offset, version and structure.

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
yarn h3 render test_map_hota.h3m --level 1 --region 0,108,36,143 --time 0 --out /tmp/hota-novelty.png
yarn h3 render test_map_hota.h3m --level 0 --region 0,0,36,36 --time 0 --out /tmp/hota-surface.png
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

Only after the constitution amendment is in place.

```bash
yarn ref doctor --baseline hota
yarn ref setup --baseline hota && yarn ref calibrate --baseline hota
yarn ref still --baseline hota --map test_map_hota.h3m --level 1 --x 12 --y 126
yarn verify fidelity --map test_map_hota.h3m --all-regions
```

Expected: the HotA baseline builds its own game root and probes; captures land in the HotA
namespace and carry the baseline id; fidelity views compare only against HotA captures and pass at
the same thresholds as base-game views. A view compared against the wrong baseline is an error.

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

Expected: base-game numbers within their unchanged budgets; the HotA case (111 MB archive,
252×252 two-level map) measured and within the HotA budget numbers recorded in the constitution
amendment. A number outside its budget fails the check rather than being noted.

## Acceptance summary

| Spec item | Proven by |
| --- | --- |
| SC-001 coverage classes | §2 `yarn verify maps`, `--all` |
| SC-002 novelty zone | §4 renders and the harness |
| SC-003 no regression | §3 |
| SC-004 HotA fidelity | §5 |
| SC-005 hosts | §6 |
| SC-006 budgets | §7 |
| SC-007 honest failure | §1–§2 typed errors, §6 with the setting cleared and a HotA map loaded |
