// Dev harness (spec US3): plain DOM page that supplies files, scrolls the view, switches level and
// forwards visibility to the engine. Not a wallpaper adapter (those arrive with TODO item 3).

import { createEngine } from '../../runtime/engine.ts'
import type { Engine, EngineStatus } from '../../runtime/engine.ts'

const canvas = document.getElementById('map') as HTMLCanvasElement
const statusEl = document.getElementById('status') as HTMLDivElement
const panel = document.getElementById('panel') as HTMLDivElement
const params = new URLSearchParams(location.search)
const testMode = params.get('test') === '1'

const engine: Engine = createEngine({ canvas, logger: { level: import.meta.env.DEV ? 'info' : 'warn' }, preserveDrawingBuffer: testMode })

declare global {
  interface Window {
    __h3?: { engine: Engine; stats: () => ReturnType<Engine['stats']>; status: () => EngineStatus }
  }
}
if (testMode) window.__h3 = { engine, stats: () => engine.stats(), status: () => engine.status() }

function showStatus(s: EngineStatus): void {
  const last = s.diagnostics[s.diagnostics.length - 1]
  const lines = [`${s.state}${s.archive !== null ? ` · ${s.archive}` : ''}${s.map !== null ? ` · ${s.map}` : ''}`]
  if (last !== undefined) lines.push(`${last.level}: ${last.message}`)
  statusEl.textContent = lines.join('\n')
  statusEl.className = s.state === 'error' || last?.level === 'error' ? 'error' : ''
}
engine.onStatus(showStatus)

const resize = (): void => engine.resize(canvas.clientWidth, canvas.clientHeight, window.devicePixelRatio || 1)
new ResizeObserver(resize).observe(canvas)
resize()

document.addEventListener('visibilitychange', () => engine.setVisible(document.visibilityState === 'visible'))
engine.setVisible(document.visibilityState === 'visible')

async function loadInput(input: HTMLInputElement, kind: 'archive' | 'data' | 'map'): Promise<void> {
  const file = input.files?.[0]
  if (file === undefined) return
  const t0 = performance.now()
  const r = kind === 'archive' ? await engine.loadArchive(file) : kind === 'data' ? await engine.loadDataArchive(file) : await engine.loadMap(file)
  if (r.ok) statusEl.textContent += `\n${kind} ${r.fromCache ? 'from cache' : 'decoded'} in ${Math.round(performance.now() - t0)} ms`
}
;(document.getElementById('archive') as HTMLInputElement).addEventListener('change', (e) => void loadInput(e.target as HTMLInputElement, 'archive'))
;(document.getElementById('dataarchive') as HTMLInputElement).addEventListener('change', (e) => void loadInput(e.target as HTMLInputElement, 'data'))
;(document.getElementById('mapfile') as HTMLInputElement).addEventListener('change', (e) => void loadInput(e.target as HTMLInputElement, 'map'))
;(document.getElementById('toggle') as HTMLButtonElement).addEventListener('click', () => panel.classList.toggle('hidden'))

const SCROLL_STEP = 32
let objectsVisible = true
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement) return
  // Scroll amounts are CSS pixels, which equal world pixels (the engine scales by the device ratio).
  switch (e.key) {
    case 'ArrowLeft':
      engine.scrollBy(-SCROLL_STEP, 0)
      break
    case 'ArrowRight':
      engine.scrollBy(SCROLL_STEP, 0)
      break
    case 'ArrowUp':
      engine.scrollBy(0, -SCROLL_STEP)
      break
    case 'ArrowDown':
      engine.scrollBy(0, SCROLL_STEP)
      break
    case 'u':
    case 'U':
      engine.toggleLevel()
      break
    case 'h':
    case 'H':
      panel.classList.toggle('hidden')
      break
    case 'o':
    case 'O':
      objectsVisible = !objectsVisible
      engine.setObjectsVisible(objectsVisible)
      break
    default:
      return
  }
  e.preventDefault()
})

let drag: { x: number; y: number } | undefined
canvas.addEventListener('pointerdown', (e) => {
  drag = { x: e.clientX, y: e.clientY }
  canvas.setPointerCapture(e.pointerId)
})
canvas.addEventListener('pointermove', (e) => {
  if (drag === undefined) return
  engine.scrollBy(drag.x - e.clientX, drag.y - e.clientY)
  drag = { x: e.clientX, y: e.clientY }
})
canvas.addEventListener('pointerup', () => {
  drag = undefined
})
