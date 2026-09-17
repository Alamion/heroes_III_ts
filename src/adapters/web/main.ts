// Browser version (spec 004 US2): pick or drop the files (remembered locally), a settings panel,
// keyboard and drag scrolling. Published as a static site; nothing leaves the browser.

import '../shared/page.css'
import './panel.css'
import { createBrowserController } from '../shared/browser-controller.ts'
import { indexedDbRememberedFiles } from '../shared/remembered-files.ts'
import { createPanel } from './panel.ts'
import type { LanguageChoice } from './panel.ts'

const SETTINGS_KEY = 'h3dynam:settings'
const canvas = document.getElementById('map') as HTMLCanvasElement

interface StoredSettings {
  settings: Record<string, unknown>
  language: LanguageChoice
}

function loadStored(): StoredSettings {
  try {
    const parsed = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<StoredSettings>
    return { settings: parsed.settings ?? {}, language: parsed.language === 'en' || parsed.language === 'ru' ? parsed.language : 'auto' }
  } catch {
    return { settings: {}, language: 'auto' }
  }
}

const stored = loadStored()
const saveStored = (): void => {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(stored))
  } catch {
    // Storage unavailable (private mode): settings last for this visit only.
  }
}

const { controller, engine } = createBrowserController({
  host: 'web',
  canvas,
  overlayRoot: document.body,
  fileUrl: () => null,
  remembered: indexedDbRememberedFiles(),
})
controller.applySettings(stored.settings)
controller.setLanguage(stored.language === 'auto' ? null : stored.language)

const panel = createPanel(document.body, {
  onSetting(key, value) {
    stored.settings[key] = value
    saveStored()
    controller.applySettings({ [key]: value })
    void controller.flushSettings()
  },
  onFiles: (files) => void controller.supplyFiles(files),
  onForget: () => void controller.forgetFiles(),
  onNewPlace: () => controller.newRandomPlace(),
  onLanguage(choice) {
    stored.language = choice
    saveStored()
    controller.setLanguage(choice === 'auto' ? null : choice)
  },
})
controller.onChange((s) => panel.update(s, stored.language))
panel.update(controller.state(), stored.language)

// Drop anywhere.
let dragDepth = 0
window.addEventListener('dragenter', (e) => {
  e.preventDefault()
  dragDepth++
  document.body.classList.add('h3-dropping')
})
window.addEventListener('dragleave', () => {
  dragDepth = Math.max(0, dragDepth - 1)
  if (dragDepth === 0) document.body.classList.remove('h3-dropping')
})
window.addEventListener('dragover', (e) => e.preventDefault())
window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  document.body.classList.remove('h3-dropping')
  const files = Array.from(e.dataTransfer?.files ?? [])
  if (files.length > 0) void controller.supplyFiles(files)
})

// Keyboard and drag scrolling (browser only; wallpaper hosts show a static view).
const TILE = 32
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return
  const eng = engine()
  panel.activity()
  switch (e.key) {
    case 'ArrowLeft':
      eng?.scrollBy(-TILE, 0)
      break
    case 'ArrowRight':
      eng?.scrollBy(TILE, 0)
      break
    case 'ArrowUp':
      eng?.scrollBy(0, -TILE)
      break
    case 'ArrowDown':
      eng?.scrollBy(0, TILE)
      break
    case 'u':
    case 'U':
      eng?.toggleLevel()
      break
    case 'r':
    case 'R':
      controller.newRandomPlace()
      break
    case 'o':
    case 'O': {
      const next = !controller.state().settings.objects
      stored.settings.objects = next
      saveStored()
      controller.applySettings({ objects: next })
      break
    }
    case 'h':
    case 'H':
      panel.toggle()
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
  // CSS pixels → world pixels: the engine draws dpr × scale device pixels per world pixel.
  const scale = controller.state().settings.scale
  engine()?.scrollBy((drag.x - e.clientX) / scale, (drag.y - e.clientY) / scale)
  drag = { x: e.clientX, y: e.clientY }
})
canvas.addEventListener('pointerup', () => {
  drag = undefined
})
window.addEventListener('pointermove', () => panel.activity())
