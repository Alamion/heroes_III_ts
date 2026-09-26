# Windows session handoff (spec 007, and everything since the 2026-09-19 session)

For an agent working directly on the owner's Windows machine, with Wallpaper Engine and Lively installed.
The last Windows session (spec 004, 2026-09-19) predates HotA support (spec 005) and the map folder
(spec 007); both need a first check on the real hosts. Read [AGENTS.md](../../AGENTS.md) and the
constitution first. The previous handoff with install and DevTools notes is in
[004 research "Windows session handoff"](../004-platform-adapters/research.md#windows-session-handoff); it
still applies and is not repeated here.

## Setup

```bash
git fetch && git switch 007-map-folder && git pull
yarn install
yarn package --host wallpaper-engine,lively   # dist/packages/wallpaper-engine/, dist/packages/heroes3-living-map-lively-<version>.zip
```

Game files come from the owner's installs: `H3sprite.lod`, `H3bitmap.lod` and the `Maps` folder of the
Complete edition, `HotA.lod` (~111 MB) from the Data folder of the HotA 1.8 install, and a HotA map
(`test_map_hota.h3m` if the owner has it on Windows, otherwise any HotA map). Never commit them or
anything derived from them.

Diagnostics on the real host: `localStorage.setItem('h3dynam:test', '1')` in the wallpaper's DevTools,
reload, then `__h3wallpaper.controller.state()` (phase, slots, messages, `source`, `folder`, engine stats).
Remove the key afterwards. Wallpaper Engine has no working DevTools port (WE-12): use its "Open DevTools"
button, or in-page probes as in the 004 Measurements.

## A. HotA on the real hosts (spec 005; not checked on Windows yet)

1. **WE**: copy the three archives and a HotA map into `game/` next to `index.html`; set **HotA archive**
   to `game/HotA.lod` and **Map** to the HotA map. Expected: HotA terrains (Highlands, Wasteland), towns
   and objects; `slots.hotaArchive.status === 'loaded'`; no `sprite(s) not found` line in the console.
   Measure the time from applying the settings to the first frame (the obfuscated archive is read through
   `file:`; the read timeout is 30 s).
2. **WE**: a base-game map with the HotA archive set must look as before (no HotA sprites on it).
3. **Lively**: the same with **Browse** (Lively copies `HotA.lod` into `userfiles/`); time the copy and the start.
4. **Both**: all four file settings applied together (a fresh install with pre-filled settings) still show
   HotA-only sprites — the race fixed on KDE on 2026-09-23 (host invariant 13).

## B. Map folder (spec 007)

1. **WE-F1 (main question)**: copy the maps (the Complete `Maps` folder, or part of it plus a sub-folder
   and a Cyrillic file name) into `game/maps/` inside the wallpaper folder; set **Map source** to *Folder of
   maps*; **Folder of maps** already says `game/maps`. Expected: a random map within about 2 s warm,
   `state().folder.entries` = number of `.h3m` files. If `entries` is 0 or the message "No maps (.h3m)
   found" appears, run in the console
   `await (await fetch('game/maps/')).text()` and
   `await new Promise(r => { const x = new XMLHttpRequest(); x.open('GET', 'game/maps/'); x.onload = () => r(x.status + ' ' + x.responseText.slice(0, 500)); x.onerror = () => r('error'); x.send() })`
   and record both outputs. Chromium answers with a page of `addRow("name","url",isDir,size,…)` lines;
   `src/runtime/catalogue.ts` parses exactly those.
2. **WE, .zip**: zip the maps, put the `.zip` into `game/`, set **Folder of maps** to `game/maps.zip`.
   Expected: the same as B1. This is the fallback if B1 fails.
3. **WE-F2 (optional)**: in a throwaway copy of `project.json`, add a user property
   `{ "type": "directory", "mode": "fetchall", "text": "maps" }`, pick the Maps folder in the WE UI and log
   what `wallpaperPropertyListener.userDirectoryFilesAddedOrChanged` receives. Does it report `.h3m` files
   at all? Do not commit this change.
4. **Lively**: zip the maps and choose the `.zip` in **Folder of maps** (Browse), **Map source** = *Folder
   of maps*. Expected as B1.
5. **LV-F1**: in Lively's DevTools run `await (await fetch('userfiles/')).text()` and record the status and
   the first 500 characters (expected: no listing over the WebView2 virtual host).
6. **Both hosts**, with a folder shown:
   - **Next map now** (WE: toggle the checkbox; Lively: the button) changes the map; the old map stays on
     screen until the new one appears (no black or placeholder frame); maps do not repeat until all were shown.
   - **New map every N minutes** = 1: the map changes about once a minute while visible; with a fullscreen
     app in front (paused) it does not change; after returning it changes after the rest of the minute.
   - **Smallest / largest map size** and **Underground**: only matching maps appear; a filter nothing
     matches shows "No map … matches the filters" only while nothing is shown.
   - Setting **Map source** back to *One map* shows the single map again.
   - Russian UI: the new setting labels are Russian (WE `ru-ru` tokens, Lively `.loc.json`).
   - `state().engine.gpuBytes` and the Task Manager memory of the wallpaper process after about 20 switches
     are not growing without bound.

## C. Still open from the 2026-09-19 session (if time allows)

WE-3…WE-8, WE-10, WE-11 and LV-4…LV-6 in
[004 research "Open questions for the Windows session"](../004-platform-adapters/research.md#open-questions-for-the-windows-session).

## Rules for the session

- Work on branch `007-map-folder`; fix findings in host-neutral code or the host bridge, add or adjust a
  Linux check where possible, commit with a `fix(007): …` / `docs(007): …` message and push.
- Nothing Windows-only in shared tooling (constitution V); no game files or derived data in commits.
- Record every answer with its evidence (console output, timings, what was on screen) in
  [research.md](research.md) under "Windows session (date)" for spec 007 and HotA items, and in the
  004 research "Measurements" for the WE-/LV- questions of section C.

## What to send back

1. A table: question id (A1–A4, WE-F1, WE-F2, LV-F1, B6 items, C items) → answer → evidence (short).
2. Timings: HotA start on WE and Lively (cold, warm), folder start on WE and Lively (cold, warm), the
   duration of a map switch.
3. Bugs found: symptom, cause, the commit that fixes it (hash), or "not fixed" with the reason.
4. Whether the `.zip` path had to be used on Wallpaper Engine (i.e. WE-F1 failed), and whether the README
   instructions for WE and Lively matched what was needed; corrections if not.
5. The pushed commit range.
