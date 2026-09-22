# Heroes 3 Living Map

An animated **Heroes of Might and Magic III** adventure map for your desktop or your browser. The
map is drawn from your own copy of the game: terrain, rivers, roads, objects, heroes and towns,
with the animation the original game uses.

It runs as a live wallpaper in **Wallpaper Engine**, **Lively Wallpaper** and **KDE Plasma 6**, and
as a plain web page.

![The browser version with its settings panel, showing Merchant Princes](docs/img/web-version.jpg)

> Fan project, not affiliated with the game's publishers. **No game files are included:** you
> supply them from your own installation, and they never leave your computer.

## What it does

- Reads the original game files directly: `H3sprite.lod`, `H3bitmap.lod` and any `.h3m` map of
  Restoration of Erathia, Armageddon's Blade or Shadow of Death.
- Draws the map the way the Complete edition does: the same tiles, mirroring, draw order, flag
  colours, shadows, 16-bit colour, and water, lava and river animation at the game's 180 ms step.
  Checks compare the output pixel by pixel with screenshots taken from the original game.
- Animates everything the game animates: palette cycling for water and rivers, frames for
  windmills, whirlpools, flags and creatures.
- Shows a random place on the map, the map centre or chosen coordinates. It can move to a new
  random place every N minutes, on either level.
- Uses little of your computer. It draws a frame only when something on screen changes (about 5
  times a second) and stops completely when the wallpaper is covered, paused or hidden. Decoded
  data is cached, so later starts take one to two seconds.

<table>
  <tr>
    <td><img src="docs/img/animation.gif" alt="Animated water, a whirlpool and a hero's flag" width="448"></td>
    <td><img src="docs/img/underground.png" alt="An underground cave of Shadow Valleys" width="448"></td>
  </tr>
  <tr>
    <td align="center">Palette and frame animation</td>
    <td align="center">Underground level (Shadow Valleys)</td>
  </tr>
</table>

## Status

This is an early release (proof of concept). Base-game maps render; save games, HotA and
interactive extras are planned (see [Roadmap](#roadmap)).

| Host | State |
| --- | --- |
| Browser | Works. Tested in Chromium-based browsers. |
| KDE Plasma 6 | Works. Accepted on a real Plasma 6 session (Fedora 43, three screens, fractional scaling). |
| Wallpaper Engine | Built and tested in a simulation on Linux; **not yet checked on real Windows**. |
| Lively Wallpaper | Built and tested in a simulation on Linux; **not yet checked on real Windows**. |

## You need the game

You need an installed copy of **Heroes of Might and Magic III Complete**.
The wallpaper needs three files from it:

| File | Where | What for |
| --- | --- | --- |
| `H3sprite.lod` | `Data` folder of the game | terrain, object, hero and town sprites |
| `H3bitmap.lod` | `Data` folder of the game | object table and colours; without it only the terrain is drawn |
| a map `*.h3m` | `Maps` folder of the game (or any downloaded map) | the map to show |

File names do not matter: files are recognised by their contents. HotA, WoG and Chronicles maps
are not supported yet and show a message.

## Getting started

### In the browser

Open **<https://alamion.github.io/heroes_III_ts/>**, then click **Choose files…** or drop the two
archives and a map anywhere on the page. The files are read locally; nothing is uploaded. The
browser remembers them for your next visit, and **Forget files** removes them.

| Key | Action |
| --- | --- |
| Arrows, mouse drag | scroll |
| `U` | switch level (surface / underground) |
| `R` | new random place |
| `O` | show or hide objects |
| `H` | hide or show the panel |

The panel hides itself after a few seconds without mouse movement.

### Wallpaper Engine, Lively, KDE Plasma

Prebuilt packages are not published yet. Build them from source (see
[Building from source](#building-from-source)): `yarn package` writes them to `dist/packages/`.

**Wallpaper Engine** (Windows)
1. Copy `dist/packages/wallpaper-engine/` into `Wallpaper Engine/projects/myprojects/`, or open
   its `project.json` in the Wallpaper Engine editor.
2. Select the wallpaper, open its properties and choose the files in **Sprite archive**, **Data
   archive** and **Map**.

**Lively Wallpaper** (Windows)
1. Drag `dist/packages/heroes3-living-map-lively-<version>.zip` into Lively.
2. Open **Customise** for the wallpaper and use **Browse** in the three file settings. Lively copies
   the chosen files into the wallpaper's folder.

**KDE Plasma 6** (Linux)
1. Install the plugin:
   ```bash
   kpackagetool6 -t Plasma/Wallpaper -i dist/packages/heroes3-living-map-kde-<version>.tar.gz
   # later updates: -u instead of -i
   ```
2. Right-click the desktop → **Configure Desktop and Wallpaper** → wallpaper type **Heroes 3 Living Map**.
3. Choose the three files and press **Apply**.

The map pauses while a maximised or full-screen window covers the screen. The lock screen shows a
plain dark background.

### Settings

Every host shows the same settings, in English or Russian:

| Setting | Values | Default |
| --- | --- | --- |
| Level | random, surface, underground | random |
| Starting view | random place, map centre, coordinates (X/Y in % of the map) | random place |
| New random place every N minutes | 0–120, 0 = never | 0 |
| New random place now | button | — |
| Scale | ×1 pixel for pixel, ×2 (as in the original game), ×3 | ×1 |
| Show objects | on / off | on |

Changes apply immediately, without reloading the files.

## Building from source

Requirements: Node.js 22+, Yarn 1, and for the checks a Chromium browser
(`/usr/bin/chromium-browser`, or set `H3_CHROMIUM`). Development is done on Linux.

```bash
yarn install
yarn dev                 # dev page: pick the files, scroll with arrows or drag
yarn test                # unit tests (tests that need real game files are skipped without them)
yarn build               # type-check and build
yarn package --host all  # packages in dist/packages/
yarn preview:web         # serve the browser version as GitHub Pages does
```

To run the tests and checks on real files, put your game files in `public/dev-assets/` (the folder
is git-ignored). [AGENTS.md](AGENTS.md) lists every command, including inspection tools
(`yarn h3 …`) and headless checks (`yarn verify …`).

## Documentation

- [docs/architecture.md](docs/architecture.md): how it works inside. File formats, rendering,
  animation, the hosts, how fidelity is checked, and the hard problems with the decisions made. Start
  here if you want to learn from the code or reuse parts of it.
- [AGENTS.md](AGENTS.md): development guide with commands, layout and rules.
- [.specify/memory/constitution.md](.specify/memory/constitution.md): project principles (user
  files only, fidelity to the original, performance budgets).
- [specs/](specs/): feature specifications with research notes and measurements:
  [reference environment](specs/001-reference-environment/),
  [foundation](specs/002-foundation-rewrite/), [map objects](specs/003-map-objects/),
  [platform adapters](specs/004-platform-adapters/).
- [TODO.md](TODO.md): roadmap and open items.
- [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md): attribution.

## Roadmap

1. Check Wallpaper Engine and Lively on Windows.
2. A folder of maps with a random map per start or on a timer; one map across several screens.
3. Save games of the Complete edition.
4. Interactive extras: scrolling on idle, battles, captured towns and mines.
5. Horn of the Abyss maps and archives.

## Credits and prior work

This project stands on the work of others:

- **[h3lwp](https://github.com/IlyaPomaskin/h3lwp)** by Ilya Pomaskin, a Heroes III live wallpaper
  for Android. It inspired this project and was the first reference for how the file formats,
  terrain draw order and palette animation work. The repository has no license, so **none of its
  code was copied**; it was only studied. Some of its values turned out to differ from the game
  (river palette ranges, animation direction), see the specs.
- **[homm3-parser](https://github.com/srg-kostyrko/homm3-parser)** by Sergey Kostyrko (MIT). The
  H3M map layouts were ported from it into new bounds-checked readers, with attribution in
  [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md). homm3-parser itself builds on the homm3tools
  H3M format description.
- **[VCMI](https://github.com/vcmi/vcmi)**, the open-source Heroes III engine (GPL). Its source was
  consulted to cross-check map layouts and object behaviour. **No VCMI code was copied**, which the
  GPL would not allow in an MIT project.
- The [Wallpaper Engine documentation](https://docs.wallpaperengine.io/) for web wallpapers.

Every visual rule was then measured against the original game running under Wine (see
[docs/architecture.md](docs/architecture.md#checking-against-the-original-game)).

## License

The source code and original artwork (icon, package previews) are under the [MIT license](LICENSE).

Heroes of Might and Magic III and its content belong to their rights holders. This repository and
its packages contain no game files. The screenshots in [docs/img/](docs/img/) show this program's
output from the owner's copy of the game and are included for illustration only.
