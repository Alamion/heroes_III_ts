# Contract: The HotA archive setting

**Feature**: [../spec.md](../spec.md) | **Evidence**: [../research.md](../research.md) R15

One new entry in the single settings definition (`src/adapters/shared/settings.ts`), from which
every host manifest is generated. Nothing is hand-edited in a generated manifest.

```
{ key: 'hotaarchive', type: 'file', default: null, fileFilter: '*.lod' }
```

| Host | Surface |
| --- | --- |
| Wallpaper Engine | A `"type": "file"` property in the generated `project.json`; value arrives as a local path and is resolved to a `file:///` URL. `fileType` is not set. |
| Lively | A file entry in the generated properties; the chosen file is copied into `userfiles/` and arrives as `userfiles\name`. |
| KDE | A file field in the generated `config.qml` / `main.xml`. |
| Browser | A picker in the panel plus drag-and-drop, remembered like the other archives. |

## Behaviour

| Case | Contract |
| --- | --- |
| Unset | Byte-identical to today: base archives only, base-game maps render exactly as before (US3, FR-026) |
| Set | The archive is placed at the front of the archive set (HotA overrides base) |
| Set, base-game map | Allowed: HotA overrides (four sprites and `game.pal`) apply, which is what the game itself does; the base-game fidelity baseline is only claimed for the unset case |
| Wrong kind of file | Classified by the existing file-kind logic; produces the existing localized message, no crash |
| HotA map without this setting | Clear, non-intrusive diagnostic naming the missing archive; the host keeps running (SC-007) |
| Changed at runtime | Rebuilds the archive set and the cache identity; last-wins load rules unchanged |

## Strings

New message codes for "HotA archive missing" and "HotA archive unreadable" in both languages
(en/ru), added to the existing string tables and covered by the string-parity test.

## Packaging

The setting adds no file to any package and no game content anywhere; `yarn verify packages` rules
are unchanged and must keep passing.
