# Quickstart: validating Map Folder and Map Rotation

Run on Linux from the repository root. Game files are the developer's own (`public/dev-assets/`, the configured
install's `Maps` folder); checks that need them skip with a message when they are absent.

## 1. Headless checks (no human)

```bash
yarn test                         # listing parser, ZIP reader, map summary, size classes, rotation, controller rules
yarn verify packages              # manifests carry the new settings; KDE configJson lists every key
yarn verify hosts                 # invariants 1–13 of spec 004/005 plus 14–20 (contracts/host-bridge.md)
yarn verify budget                # includes the folder case: first map ≤ 2 s warm, peak memory across a switch ≤ 300 MB
yarn verify layers
```

Expected: all pass. `check-reports/hosts/` holds the per-host results of invariants 14–20, including the frame
samples around the switches of invariant 16.

## 2. Inspect what the wallpaper would pick

```bash
yarn h3 map summary "public/dev-assets/test_map.h3m"                   # { version, size: 144, sizeClass: "xl", levels: 2, title, needsHota: false }
yarn h3 map catalogue "<bundleDir>/Maps" --size-min l --underground two  # every entry with its summary and verdict
yarn h3 map catalogue maps.zip                                           # the same for an archive
```

Expected: the catalogue of the owner's Complete `Maps` folder lists 225 entries (453 with the HotA maps folder);
failed entries name their reason; verdicts match the filters.

## 3. Browser version by hand (optional)

```bash
yarn package --host web && yarn preview:web
```

Supply the archives, set the map source to "Folder", choose the game's `Maps` folder. Expected: a map appears
within the usual start time; the panel shows its title, path and the folder's map count; `N` switches maps with no
black frame; a filter change applies without a reload; after a reload the folder is still there.

## 4. KDE (real session, optional)

```bash
yarn accept kde --apply
```

In the wallpaper settings choose "Folder", pick a maps folder, set "New map every 1 minute". Expected: the map
changes every minute while the desktop is visible and not while a maximized window covers it. To answer KDE-F1,
attach over the DevTools port (AGENTS.md "KDE live debugging") and check `state().folder.entries > 0`.

## 5. Windows session (later, with the spec 004 open questions)

- Wallpaper Engine: copy maps into `<wallpaper>/game/maps/`, leave the default `mapfolder`; answer WE-F1 (listing)
  and WE-F2 (`directory` property with `.h3m`).
- Lively: zip the `Maps` folder, choose it in "Folder of maps"; answer LV-F1 (virtual-host listing).
