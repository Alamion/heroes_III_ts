# Contract: Wallpaper Settings and Host Manifests

The single definition lives in `src/adapters/shared/settings.ts`; host manifests are generated from it by
`yarn package` and checked by `yarn verify packages`. Field meanings: [data-model.md](../data-model.md).

## Definition shape

```ts
interface SettingDef {
  key: 'spritearchive' | 'dataarchive' | 'mapfile' | 'level' | 'viewmode' | 'viewx' | 'viewy'
     | 'viewinterval' | 'scale' | 'objects'
  type: 'file' | 'enum' | 'int' | 'bool'
  input?: 'slider' | 'number'           // int only: slider (default) or number field (viewinterval)
  label: StringKey                      // setting label in the string table
  options?: { value: string; label: StringKey }[]
  min?: number; max?: number; step?: number
  default: string | number | boolean | null
  visibleWhen?: { key: SettingKey; equals: string }   // viewx/viewy: viewmode = coords
  fileFilter?: '*.lod' | '*.h3m'
  order: number
}
```

Actions (`ACTIONS`, same file) are controls without a stored value: `viewreroll` "New random place now"
(visible when `viewmode = random`). Wallpaper Engine: a `bool` property whose every toggle acts (the first
`applyUserProperties` with all properties does not); Lively: `{ type: "button" }`; KDE: an `Int` counter the
settings page increments (also written to the live configuration) and the shell passes to the page, a
change after the first apply acts; browser: a panel button and the `R` key. The controller's
`newRandomPlace()` draws a new place and level in random mode only and restarts the interval.

Keys are lowercase ASCII letters only (valid in WE and Lively). Reserved keys `mapsource`, `mapfolder`,
`maprotation` must not be used for anything else.

## Wallpaper Engine — `project.json`

- Top level: `file: "index.html"`, `type: "web"`, `title` (English), `description`, `preview: "preview.jpg"`,
  `tags: ["Game"]`, `general: { properties, localization, supportsaudioprocessing: false }`.
- `file` → `{ type: "file", value: "", text: "ui_<key>", order }` (no `fileType`).
- `enum` → `{ type: "combo", value: <default>, options: [{ label: "ui_<key>_<value>", value }] }`.
- `int` → `{ type: "slider", min, max, step, fraction: false, value }`; `input: 'number'` → `{ type: "textinput",
  value: "<default>" }` (no number field in WE; the page validates the text).
- `bool` → `{ type: "bool", value }`.
- `visibleWhen` → `condition: "<key>.value == \"<equals>\""`.
- `localization`: `{ "en-us": { ui_*: … }, "ru-ru": { ui_*: … } }`, every token present in both.

## Lively — `LivelyInfo.json`, `LivelyProperties.json`, `LivelyProperties.loc.json`, `LivelyInfo.loc.json`

- `LivelyInfo.json`: `{ AppVersion, Title, Desc, Author, License: "MIT", Contact, Type: 1, FileName:
  "index.html", Arguments: "--pause-event true", IsAbsolutePath: false, Thumbnail: "thumbnail.jpg",
  Preview: "preview.jpg" }`.
- `file` → `{ type: "folderDropdown", folder: "userfiles", filter: <fileFilter>, value: null, text }`.
  All three files share the folder `userfiles/` (the package ships it empty with a `.keep`); the page
  classifies content anyway.
- `enum` → `{ type: "dropdown", items: [labels…], value: <default index> }`; the bridge maps index → value
  by the definition order.
- `int` → `{ type: "slider", min, max, step, value }`; `input: 'number'` → `{ type: "textbox", value: "<default>" }`;
  `bool` → `{ type: "checkbox", value }`.
- `visibleWhen`: Lively has no conditions → sliders always shown, their label says "used in Coordinates
  mode" (string key `viewx_hint`).
- `.loc.json`: `{ "Languages": { "ru": { <key>: { text, items? } } } }`; `LivelyInfo.loc.json` localises
  `Title`/`Desc`.

## KDE — `contents/config/main.xml`, `contents/ui/config.qml`

- kcfg group `General`: `file` → `String` (a `file://` URL, default empty); `enum` → `String` (default
  value); `int` → `Int` with `<min>`/`<max>`; `bool` → `Bool`.
- `config.qml` is generated: one `FileDialog` row per file (button + current name), `ComboBox` for enums,
  `Slider` for ints (visible per `visibleWhen`), an editable `SpinBox` for `input: 'number'`, `CheckBox` for bools; labels come from
  generated `strings.js` chosen by `Qt.uiLanguage` starting with `ru`.

## Browser — panel

Rendered from the definition: file rows accept picker and drop; enums as segmented buttons; ints as range
inputs or number fields (visible per `visibleWhen`); bool as checkbox; plus `language` (`auto`, `en`, `ru`) and "Forget files".
Settings persist in `localStorage["h3dynam:settings"]` as JSON of the definition keys.

## Validation of typed numbers

Number fields send text on some hosts. `validateSettings` accepts an optional sign, digits and an optional
fraction with `.` or `,`; the value is rounded and clamped to `min..max`. Empty, non-numeric (`"5 min"`,
`"1e3"`) or infinite input falls back to the default and is reported as corrected; the browser panel shows
the corrected value.
