# Contract: Engine API

The browser-facing interface of `src/runtime`, used by the dev harness now and by platform
adapters in item 3. Adapters supply files, settings, and lifecycle events — nothing else.

```ts
interface EngineOptions {
  canvas: HTMLCanvasElement
  clock?: Clock              // default: performance.now
  seed?: number              // default: 1
  logger?: Logger            // default: level-gated console sink
  workerUrl?: URL            // default: bundled worker
  cache?: boolean            // default: true (IndexedDB); false in tests
}

interface Engine {
  loadArchive(file: File | Blob & { name: string }): Promise<LoadResult>
  loadMap(file: File | Blob & { name: string }): Promise<LoadResult>

  setLevel(level: 0 | 1): void
  scrollBy(dxCss: number, dyCss: number): void
  centerOn(tileX: number, tileY: number): void
  resize(cssWidth: number, cssHeight: number, dpr: number): void

  setVisible(visible: boolean): void   // hidden → no frames, no timers
  setPaused(paused: boolean): void     // same effect, separate reason flag

  onStatus(listener: (s: EngineStatus) => void): () => void
  stats(): RendererStats               // see data-model.md
  dispose(): void
}

type LoadResult =
  | { ok: true; identity: string; fromCache: boolean; warnings: Diagnostic[] }
  | { ok: false; error: SerializedFormatError | Diagnostic }

function createEngine(options: EngineOptions): Engine
```

## Behavior guarantees

- Calls never throw for bad input files; failures return `ok: false` and emit an `error`
  status with a diagnostic. The previously shown map stays visible.
- `loadMap` before `loadArchive` is allowed; the map renders once an archive is ready.
- A frame is presented only after a state/camera change or a palette step for rotating tiles in
  view. While `!visible || paused`, zero `requestAnimationFrame`/timer callbacks are pending.
- Canvas backing size never exceeds `min(css × dpr, screen × dpr)`.
- `webglcontextlost` → status `loading`; `webglcontextrestored` → resources rebuilt without
  re-reading files.
- Rendering output is a function of (archive identity, map identity, camera, clock time, seed).

## Test hooks (dev/check builds only)

`window.__h3` exposes `{ engine, stats(), setClock(ms) }` when the page is loaded with
`?test=1`. Budget and fidelity checks use it; production adapters never enable it.

## Render-to-image entry (checks)

`src/adapters/dev-harness/render.html?test=1&w=W&h=H` renders a single frame for
`{archive, map, level, originTile, originPixel, timeMs | paletteStep}` supplied through
`window.__h3.renderRegion(params) → Promise<void>`; the check reads pixels via
`canvas.toDataURL` / `readPixels`.
