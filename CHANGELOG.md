# Changelog

What changed in each release of Heroes 3 Living Map, written for people who use it. One section per
version, newest first: `## [X.Y.Z] - YYYY-MM-DD`. Sections use a small Markdown subset — `###`
headings, `-` bullets (one nested level), **bold**, *italic*, `code` and links — because the same
text becomes the Steam Workshop and KDE Store change notes (see [docs/releasing.md](docs/releasing.md)).

## [Unreleased]

## [0.1.0] - 2026-09-26

The first release: a Heroes of Might and Magic III adventure map as a living wallpaper, drawn from
your own copy of the game. No game files are included.

### Maps

- Maps of Restoration of Erathia, Armageddon's Blade, Shadow of Death and Horn of the Abyss
  (HotA 1.8), with underground levels and maps of every size up to 252×252
- Terrain, rivers, roads, objects, heroes and towns as in the original game, with its animation:
  water, lava and rivers cycle their colours, objects animate at the game's speed
- HotA terrains (Highlands, Wasteland), all town forms, and shadows tinted by the soil like in HotA
- A new random place every few minutes, or a fixed place; surface or underground; scaling

### Folder of maps

- Show a random map from a folder (or a `.zip` of maps) and switch to another every N minutes
- Filters by map size and by underground level; "Next map" at any time (`N` in the browser)
- Maps are not repeated until every map was shown; the switch never shows an empty screen

### Where it runs

- Browser - open the page, choose or drop the files; the browser remembers them
- Wallpaper Engine and Lively Wallpaper on Windows, KDE Plasma 6 on Linux
- Pauses while a full-screen window covers the desktop, so it costs nothing while you work
- English and Russian

### Good to know

- Your files are read on your computer and never uploaded
- Wallpaper Engine can only read files inside the wallpaper's own folder: copy them there (see the package readme)
- Suggestions and bug reports: [GitHub Issues](https://github.com/Alamion/heroes_III_ts/issues/new/choose)
