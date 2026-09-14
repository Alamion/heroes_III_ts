# Quickstart & Validation: Reference Environment

**Feature**: [spec.md](spec.md) | Commands: [contracts/cli.md](contracts/cli.md) | Records:
[data-model.md](data-model.md)

## Prerequisites (one-time, human)

1. Complete edition (HotA/HD Mod on top is fine) installed in a Wine prefix (here
   `/home/JRCD/.wine/drive_c/Games/Heroes of Might and Magic III Complete/`), containing
   `Heroes3.exe`, `h3maped.exe`, `Data/`.
2. System packages:
   `sudo dnf install wine xorg-x11-server-Xvfb xdotool ffmpeg`
3. Local config: copy `reference-env.config.example.json` to `reference-env.config.json` and set
   `bundleDir` (or export `H3REF_BUNDLE_DIR`).

## Setup and verification (Story 4)

```bash
yarn ref setup        # dedicated prefix, staging roots, settings profile, expected hashes
yarn ref calibrate    # measures layout/navigation/positioning; writes local calibration
yarn ref doctor
```

Expected: `doctor` exits 0, every check `pass`; `no-hota-loaded` passes (load log shows no `HotA.dll`) and
`hd-mod-state` passes (no `_HD3_.dll`/`HD_*.dll`/`patcher_x86.dll`, or HD Mod fallback with
verified vanilla profile); `bundle-unchanged` passes;
`calibration.positioningMethod` is set.

Negative check: `H3REF_BUNDLE_DIR=/nonexistent yarn ref doctor` exits 3 and names
`bundle-found` with a fix hint.

## Spike outcomes

All spikes are resolved (details in [research.md](research.md) "Spike results"): original
`Heroes3.exe` (no HD Mod), game defaults, fixed-start navigation, `nwcwhatisthematrix` with Ctrl
held, cursor parked at (690, 470), minimap-click positioning with rectangle readback, original
`h3maped.exe` opened by command-line argument. `yarn ref calibrate` re-verifies them.

## Story validations

```bash
# Story 1 — still (SC-001: < 2 min, no interaction)
time yarn ref still --map Arrogance.h3m --level 0 --x 10 --y 12
yarn ref still --map "По праву силы.h3m" --level 0 --x 5 --y 5
yarn ref still --map Arrogance.h3m --level 1 --x 0 --y 0      # edge: record shows clamped range

# Story 2 — clip (SC-004)
yarn ref clip --map Arrogance.h3m --level 0 --x 18 --y 18 --duration 5000   # lake centre
#   expect clip.resolvesAllSteps = true, frames.json contiguous

# Story 3 — editor
yarn ref editor --map Arrogance.h3m --level 0 --x 10 --y 12
#   run twice: map-area pixels identical outside the launch-based volatile masks

# Story 5 — lookup
yarn ref find --map Arrogance.h3m --level 0 --region 10,12,12,14
#   newest first, each with crop rect; region outside all captures → matches: []

# Reproducibility (FR-021, SC-002, SC-003)
yarn ref selfcheck --map Arrogance.h3m --runs 5 --samples 10
```

Concurrency: start two `still` commands at once — the second waits for the lock (or fails with
`LOCKED` after the timeout); captures never interleave.

Non-interference (SC-008): keep working in the KDE session during `selfcheck`; no window,
resolution change, or focus change appears.

Git hygiene (SC-007): after all of the above, `git status --porcelain` shows no files under
`reference-captures/`, no `reference-env.config.json`, nothing from the state directory.

## Automated tests

```bash
yarn test     # unit tests with synthetic fixtures (records, lookup, geometry, minimap rect
              # detection, frame timeline, config, lock) — no game needed
H3REF_LIVE=1 yarn test   # also runs live checks; skips with a message if doctor fails
                         # H3REF_SELFCHECK_RUNS / H3REF_SELFCHECK_SAMPLES shorten the self-check
```
