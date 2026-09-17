# Quickstart: Platform Adapters

Validation guide for spec 004. Commands and outputs: [contracts/cli.md](contracts/cli.md); bridge
behaviour: [contracts/host-bridge.md](contracts/host-bridge.md); settings: [contracts/settings.md](contracts/settings.md).

## Prerequisites

- `yarn install`; system Chromium (or `H3_CHROMIUM`).
- For real files: `public/dev-assets/H3sprite.lod`, `h3bitmap.lod`, `test_map.h3m`.
- KDE: `kpackagetool6` (present on the dev machine).

## 1. Spikes (KDE, before the plugin code is finished)

Record results in [research.md](research.md) "Measurements".

- **S2/S3 KDE**: install the spike plugin with `yarn accept kde --apply`; record XHR of `file://`, Blob
  worker, WebGL, `TasksModel` maximised detection, lock screen appearance, IndexedDB after
  `plasmashell --replace`, second screen sharing the profile.

## 2. Build and static checks

```bash
yarn build                         # tsc -b + builds
yarn test                          # unit: settings, strings parity, file-kind, view-placement, path→URL,
                                   # coalescing, controller state machine, archive writers
yarn package --host all
yarn verify packages --reproducible
```

Expected: four packages; every check `pass` (`kpackage-valid` may `skip` without `kpackagetool6`);
`runtimeGzipBytes` ≤ 102 400 for each; second build identical. Build again with `public/dev-assets/`
moved away → identical hashes.

## 3. Host simulations (headless, Linux)

```bash
yarn verify hosts                  # synthetic fixtures, all hosts
yarn verify hosts --files real     # H3sprite.lod, h3bitmap.lod, test_map.h3m
yarn verify budget                 # web + WE packages: warm ≤ 2 s, cold ≤ 10 s, 0 hidden frames
```

Expected per host: the ten invariants of contracts/host-bridge.md pass (placeholder, load + frame equality at ×1,
pause/hidden = 0 frames, settings live without re-decode, `ru`/`en` texts, bad files → messages, surface size,
no frame burst after a clock jump, no IndexedDB, no CSP violations).

## 4. Browser version

```bash
yarn package --host web && yarn preview:web      # serves dist/packages/web under /heroes_III_ts/
```

Manual check: drop all three files at once → map; reload → map without files; switch level, view mode,
sliders, scale ×2/×3 (sharp pixels), objects; hide tab → CPU idle; "Forget files" → placeholder; browser
language Russian → Russian panel. After merging into `testing`, the GitHub Actions run deploys; open
`https://alamion.github.io/heroes_III_ts/` and repeat the first two steps. DevTools Network shows no
request outside the page origin.

## 5. Real-host acceptance (FR-022)

Record each outcome in research.md "Measurements" (host, version, date, pass/fail, notes).

### KDE Plasma (local)

```bash
yarn accept kde --apply
```

Then by hand: System Settings → Wallpaper → "Heroes III dynamic map"; pick the three files; set level
Underground, mode Coordinates, move sliders, scale ×2, objects off → each visible after Apply; maximise a
window → CPU of `QtWebEngineProcess` drops to idle; lock screen → plain background, unlock → map; second
screen shows its own view without a second long load; system language Russian → Russian settings page.
The tool restores the previous wallpaper.

### Wallpaper Engine and Lively (follow-up session on Windows)

Not part of this feature's Linux work. The packages from `yarn package` and the list "Open questions for the
Windows session" in [research.md](research.md) (WE-1…WE-10, LV-1…LV-7) are the input. Acceptance steps there:
install the package; set the three files; change map (no long reload); change each setting; fullscreen
app → paused with 0 pending callbacks (DevTools); Russian host language → Russian labels; a path with a
Cyrillic folder loads. Answers and outcomes are recorded in research.md "Measurements".

### Browser

Section 4 on the published page, in desktop Chrome/Chromium.

## 6. Done when

- `yarn verify all` passes (packages, hosts synthetic, budgets, layers, determinism, fidelity unchanged).
- Browser and KDE acceptance records are `pass` in research.md; Wallpaper Engine and Lively packages are
  built, simulated and handed to the Windows session.
- The Pages site is live from `testing`; AGENTS.md "Current State"/"Commands" and TODO.md updated; the old
  root `project.json` removed.
