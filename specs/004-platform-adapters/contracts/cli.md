# Contract: Packaging, Checks and Acceptance CLIs

All commands print one JSON document on stdout; logs go to stderr. Exit codes as in AGENTS.md:
0 pass, 1 fail, 2 usage, 3 prerequisite missing (`--require`), 4 skip.

## `yarn package`

```bash
yarn package [--host web|wallpaper-engine|lively|kde|all] [--out dist/packages] [--no-build]
```

Builds the flavour(s) needed (R3), generates manifests (settings + strings), writes
`dist/packages/<host>/` and archives `dist/packages/heroes3-living-map-lively-<version>.zip`,
`dist/packages/heroes3-living-map-kde-<version>.tar.gz`. Output:

```json
{ "ok": true, "version": "0.0.1",
  "packages": [ { "host": "kde", "flavour": "classic", "path": "dist/packages/kde",
                  "artifact": "dist/packages/heroes3-living-map-kde-0.0.1.tar.gz", "files": 14,
                  "runtimeGzipBytes": 61234, "sha256": "…" } ] }
```

Version comes from `package.json`. Nothing outside the repository and `node_modules` is read; the
command gives identical output whether `public/dev-assets/` exists or not.

`yarn preview:web` serves `dist/packages/web` under `/heroes_III_ts/` (as on GitHub Pages) for manual checks.

## `yarn verify packages`

```bash
yarn verify packages [--host …] [--no-build] [--reproducible]
```

Checks per package (R15): `required-files`, `no-game-content`, `no-external-urls`, `no-affiliation`,
`strings-complete`, `manifest-matches-settings`, `classic-flavour` (no `type="module"`, no URL workers;
host packages only), `no-inline-scripts` (CSP meta present, no inline script bodies or `on*` attributes), `runtime-size` (≤ 102 400 gz bytes), `kpackage-valid` (KDE; skip when `kpackagetool6`
is absent), and with `--reproducible` `reproducible` (second build, equal hashes).
Report: `check-reports/packages/<ts>/report.json`:

```json
{ "schema": "004-packages", "outcome": "pass",
  "packages": [ { "host": "web", "outcome": "pass", "runtimeGzipBytes": 48120,
                  "checks": [ { "id": "no-game-content", "outcome": "pass", "details": [] } ] } ] }
```

## `yarn verify hosts`

```bash
yarn verify hosts [--host …] [--files synthetic|real] [--map NAME] [--no-build]
```

Runs the host simulations of [host-bridge.md](host-bridge.md) "Invariants" against built packages in
headless Chromium. `--files real` uses `H3sprite.lod`, `h3bitmap.lod`, `test_map.h3m` (or the map named by `--map`) from
the configured game folders (exit 3 with `--require` when absent; default `synthetic`). Report
`check-reports/hosts/<ts>/report.json` with one entry per host × invariant, and a PNG pair plus diff for
any frame mismatch.

`yarn verify all` adds `packages` and `hosts --files synthetic`. `yarn verify budget` measures the web
package and the WE package (file:// load) instead of the dev harness; the size rule counts shipped package
JS instead of `dist/assets` minus harness entries.

## `yarn accept kde` (optional, real Plasma session; not in `verify all`)

```bash
yarn accept kde [--apply] [--screen N] [--seconds S] [--keep] [--no-restart]
```

Installs/updates the package with `kpackagetool6`. After an **upgrade** it restarts plasmashell
(`kquitapp6`, then its systemd unit `plasma-plasmashell.service` when the session has one, else a
detached `plasmashell`) and waits until the shell answers scripting calls: an open wallpaper page keeps
running the previous script until then, even across `location.reload()` (measured 2026-09-23).
`--no-restart` skips it and reports the step as `manual`. Without `--apply` it stops there. With
`--apply` it saves the screen's wallpaper plugin and the value of every setting it is about to write,
sets `io.github.alamion.h3dynam` with the dev files through plasmashell DBus scripting, captures a
screenshot (`spectacle -b -n -o`), and restores the previous plugin and those settings (`--keep` leaves
the wallpaper applied). Output:
`{ host: "kde", steps: [ { id, outcome: "pass"|"fail"|"manual"|"skip", evidence } ] }`, also written to
`check-reports/accept/<ts>/report.json`.

Wallpaper Engine and Lively have no acceptance tool; they are verified on Windows (research.md "Open
questions for the Windows session").
