# Contract: Host Bridges and the Wallpaper Controller

## Controller (`src/adapters/shared/controller.ts`)

```ts
interface WallpaperController {
  start(): void                                          // creates engine, overlay, observers
  applySettings(patch: Partial<RawSettings>): void       // raw host values; validated + coalesced (150 ms)
  supplyFiles(files: Blob[] | File[]): void              // browser drop/picker; classified into slots
  setHostPaused(paused: boolean): void
  setFrameLimit(fps: number): void                       // 0 = none
  setLanguage(tag: string | null): void                  // null → navigator.language
  forgetFiles(): Promise<void>                           // browser only
  state(): ControllerSnapshot                            // for checks
}
type RawSettings = Record<SettingKey, string | number | boolean | null>
interface ControllerSnapshot {
  phase: 'waiting' | 'loading' | 'showing' | 'problem'
  slots: Record<FileSlot, { status: UserFile['status']; name: string | null }>
  settings: WallpaperSettings
  messages: UserMessage[]           // currently displayed
  language: 'en' | 'ru'
  engine: EngineStats               // visible, paused, pendingCallbacks, scheduledFrames, camera
}
```

`createController({ canvas, overlayRoot, host, fileUrl, storage, seed?, clock? })`, where
`fileUrl(value) → string | null` is the host's path → URL mapping and `storage` is `'remember' | 'none'`.

## Test hook

When the page URL has `?h3test=1`, `window.__h3testHook = true` is set before the bundle runs, or
`localStorage['h3dynam:test'] === '1'` (real hosts, set from DevTools),
`window.__h3wallpaper = { controller, engine }` is exposed and the engine uses `preserveDrawingBuffer`.
Checks set `seed` and a manual clock through `window.__h3testOptions = { seed, clockMs }` before load.
No hook is exposed otherwise.

## Wallpaper Engine (`src/adapters/wallpaper-engine/`)

Separate classic file `listener.js`, loaded by the first `<script src>` of `index.html` (no inline scripts:
the CSP forbids them), runs before the bundle:

```js
window.wallpaperPropertyListener = {
  applyUserProperties(props)   // → applySettings({ key: props[key].value }) for defined keys
  applyGeneralProperties(p)    // → setFrameLimit(p.fps ?? 0); setLanguage(p.language ?? null) if WE-6 finds one
  setPaused(isPaused)          // → setHostPaused
}
```

Events arriving before `start()` are queued in order. `fileUrl`: `""` → `null`; `C:\a b\Карты\x.h3m` →
`file:///C:/a%20b/%D0%9A%D0%B0%D1%80%D1%82%D1%8B/x.h3m`; values that already start with `file:` are kept.

## Lively (`src/adapters/lively/`)

Separate classic file `listener.js`, first `<script src>` (same reason):

```js
window.livelyPropertyListener = function (name, value) { … }          // → applySettings; dropdown index → value
window.livelyWallpaperPlaybackChanged = function (json) { … }          // JSON.parse(json).IsPaused → setHostPaused
```

`fileUrl`: `null` → `null`; `userfiles\x.lod` → `userfiles/x.lod` (relative, each segment encoded).

## KDE (`src/adapters/kde/` page side; `packaging/kde/` QML side)

Page exposes:

```js
window.h3wallpaper = {
  apply(json: string)          // JSON of { settings: RawSettings, language: string } — full set each time
  setPaused(paused: boolean)
}
```

QML calls, in order: after `WebEngineView.loadingChanged` reports success → `apply(full)`; on any
`root.configuration` change → `apply(full)`; on covered/uncovered or lock state change →
`setPaused(b)` then `visible = !b`. File settings are `file://` URLs from `FileDialog.selectedFile`;
`fileUrl` keeps them as they are. Page calls before `apply` show the placeholder.

## Browser (`src/adapters/web/`)

`index.html` + ESM entry. Remembered files are loaded at start (`storage: 'remember'`); drop anywhere
or pick → `supplyFiles`; panel changes → `applySettings`; `visibilitychange` handled by the controller for
every host. Keyboard: arrows scroll 32 px × scale, `U` level, `O` objects, `H` panel; pointer drag scrolls.
Scrolling is browser-only (wallpaper hosts show a static view).

## Invariants checked by `yarn verify hosts`

1. With no files: `phase = waiting`, overlay lists missing slots, `engine.scheduledFrames` stays 0.
2. After files: `phase = showing` within the cold-start budget; frame at `viewmode = coords`, fixed seed and
   clock equals `HeadlessRenderer` output for the same files/level/camera at scale 1.
3. `setHostPaused(true)` or `document.hidden` → `engine.pendingCallbacks = 0` and no frames for 2 s.
4. Each setting change is visible in `state()` and the camera/stats within 1 s; archive identities and
   `fromCache` show no re-decode.
   4.1. The host's "new random place now" control (web panel button, WE checkbox toggle, Lively button, KDE
   counter) changes `state().view` each time, without reloading any file.
5. Language `ru-RU` → all visible texts from the `ru` table; `de-DE` → `en`.
6. Wrong-kind, HotA, truncated and missing files → the matching `UserMessage` code; the page stays responsive.
7. Drawing surface ≤ viewport × DPR after a resize and at every user scale.
8. A clock jump (simulated sleep of 10 min) while active produces one catch-up frame, not a burst.
9. With IndexedDB unavailable the page still reaches `showing`; no message unless the start exceeds the
   warm-start budget.
10. No CSP violation is reported by the page (`securitypolicyviolation` listener).
