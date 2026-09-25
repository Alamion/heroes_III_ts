// Browser version (spec 004 US2): pick or drop the files (remembered locally), a settings panel,
// keyboard and drag scrolling. Published as a static site; nothing leaves the browser.

import '../shared/page.css'
import './panel.css'
import { createBrowserController } from '../shared/browser-controller.ts'
import { CATALOGUE_LIMITS, filesCatalogue, isMapPath, zipCatalogue } from '../../runtime/catalogue.ts'
import { log } from '../../core/util/log.ts'
import { indexedDbRememberedFiles, indexedDbRememberedFolder } from '../shared/remembered-files.ts'
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

// Spec 007: a folder of maps, remembered like the files. Only maps are kept (the folder may be a whole
// game install); a .zip is opened as a folder and not remembered (it stays a file the user drops again).
const rememberedFolder = indexedDbRememberedFolder()
const useFolder = (name: string, files: { path: string; file: Blob }[], remember: boolean): void => {
  const maps = files.filter((f) => isMapPath(f.path))
  stored.settings.mapsource = 'folder'
  saveStored()
  void controller.supplyFolder(name, async () => filesCatalogue(maps))
  if (remember) void rememberedFolder.save({ name, files: maps.map((f) => ({ path: f.path, blob: f.file })) })
}
const useZip = (file: File): void => {
  stored.settings.mapsource = 'folder'
  saveStored()
  void controller.supplyFolder(file.name, () => zipCatalogue(file, file.name))
}
if (stored.settings.mapsource === 'folder') {
  void rememberedFolder.load().then((f) => {
    if (f !== null) void controller.supplyFolder(f.name, async () => filesCatalogue(f.files.map((x) => ({ path: x.path, file: x.blob }))))
  })
}

const panel = createPanel(document.body, {
  onSetting(key, value) {
    stored.settings[key] = value
    saveStored()
    controller.applySettings({ [key]: value })
    void controller.flushSettings()
    // Back to the folder source: the remembered folder, if there is one.
    if (key === 'mapsource' && value === 'folder' && controller.state().folder?.entries == null) {
      void rememberedFolder.load().then((f) => {
        if (f !== null) void controller.supplyFolder(f.name, async () => filesCatalogue(f.files.map((x) => ({ path: x.path, file: x.blob }))))
      })
    }
  },
  onFiles: (files) => void controller.supplyFiles(files),
  onForget: () => {
    void rememberedFolder.clear()
    void controller.forgetFiles()
  },
  onNewPlace: () => controller.newRandomPlace(),
  onFolder(files) {
    if (files.length === 0) return
    const first = files[0] as File
    const name = (first.webkitRelativePath || first.name).split('/')[0] ?? first.name
    // webkitRelativePath starts with the folder's own name; paths inside it drop that part.
    useFolder(name, files.map((f) => ({ path: (f.webkitRelativePath || f.name).split('/').slice(1).join('/') || f.name, file: f })), true)
  },
  onNextMap: () => controller.nextMap(),
  onLanguage(choice) {
    stored.language = choice
    saveStored()
    controller.setLanguage(choice === 'auto' ? null : choice)
  },
})
controller.onChange((s) => {
  // The controller switches the source itself (a dropped single map, a supplied folder); keep it stored.
  if (stored.settings.mapsource !== undefined && stored.settings.mapsource !== s.settings.mapsource) {
    stored.settings.mapsource = s.settings.mapsource
    saveStored()
  }
  panel.update(s, stored.language)
})
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
/** Walks a dropped folder (spec 007): maps only, with the listing limits. */
async function walkDropped(entry: FileSystemDirectoryEntry): Promise<{ path: string; file: File }[]> {
  const out: { path: string; file: File }[] = []
  const walk = async (dir: FileSystemDirectoryEntry, prefix: string, depth: number): Promise<void> => {
    const reader = dir.createReader()
    for (;;) {
      const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
      if (batch.length === 0) return
      for (const child of batch) {
        if (out.length >= CATALOGUE_LIMITS.maxEntries || child.name.startsWith('.')) continue
        const path = `${prefix}${child.name}`
        if (child.isDirectory) {
          if (depth < CATALOGUE_LIMITS.maxDepth) await walk(child as FileSystemDirectoryEntry, `${path}/`, depth + 1)
        } else if (isMapPath(path)) {
          out.push({ path, file: await new Promise<File>((resolve, reject) => (child as FileSystemFileEntry).file(resolve, reject)) })
        }
      }
    }
  }
  await walk(entry, '', 1)
  return out
}

window.addEventListener('drop', (e) => {
  e.preventDefault()
  dragDepth = 0
  document.body.classList.remove('h3-dropping')
  const items = Array.from(e.dataTransfer?.items ?? [])
  const dirs = items.map((i) => i.webkitGetAsEntry?.() ?? null).filter((x): x is FileSystemDirectoryEntry => x !== null && x.isDirectory)
  const files = Array.from(e.dataTransfer?.files ?? []).filter((f) => !dirs.some((d) => d.name === f.name))
  const zips = files.filter((f) => /\.zip$/i.test(f.name))
  const rest = files.filter((f) => !zips.includes(f))
  if (rest.length > 0) void controller.supplyFiles(rest)
  const dir = dirs[0]
  if (dir !== undefined) {
    walkDropped(dir)
      .then((maps) => useFolder(dir.name, maps, true))
      .catch((err: unknown) => log.warn(`cannot read the dropped folder ${dir.name}`, String(err)))
  } else if (zips[0] !== undefined) useZip(zips[0])
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
    case 'n':
    case 'N':
      controller.nextMap()
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
