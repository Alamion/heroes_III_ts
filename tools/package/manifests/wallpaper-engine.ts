// Wallpaper Engine package (spec 004 contracts/settings.md): generated project.json with file,
// combo, slider and bool properties, en-us/ru-ru localization, and the classic page.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACTIONS, SETTINGS } from '../../../src/adapters/shared/settings.ts'
import type { ActionDef, SettingDef } from '../../../src/adapters/shared/settings.ts'
import { en, ru } from '../../../src/adapters/shared/strings.ts'
import type { StringKey } from '../../../src/adapters/shared/strings.ts'
import type { ClassicBundle, PackageFiles } from '../build.ts'
import { previewPng } from '../previews.ts'
import { json, readme, utf8 } from './common.ts'

const token = (key: StringKey): string => `ui_${key}`

/** Keys of the read-only panel elements (not settings): the warning and the spacer line. */
export const NOTICE_KEY = 'notice'
export const SPACER_KEY = 'spacer'
export const DISPLAY_KEYS: readonly string[] = [NOTICE_KEY, SPACER_KEY]

/**
 * WE's CEF reads files only inside the wallpaper folder (2026-09-19 Windows session), so the archive
 * settings ship with defaults following the README convention: the owner copies the files into a
 * game/ subfolder under exactly these names. The map has no default — its name is up to the owner.
 */
const FILE_DEFAULTS: Partial<Record<SettingDef['key'], string>> = {
  spritearchive: 'game/H3sprite.lod',
  dataarchive: 'game/h3bitmap.lod',
  // Spec 007: WE's CEF cannot list a file:// folder (2026-09-25 Windows session), so the folder source
  // needs a .zip of the maps; its name follows the README convention next to the archives.
  mapfolder: 'game/maps.zip',
}

/** Settings ordered before this belong to the files-and-maps group the spacer closes. */
const VIEW_GROUP_ORDER = 4

/**
 * Panel elements follow the working Workshop pattern (owner-provided project.json, 2026-09-19):
 * `type: "text"` with HTML in the localized text (`<br></br>` makes an empty line) and dense integer
 * orders from 100. Paragraphs and small or fractional orders rendered unpredictably in the panel.
 */
const panelElement = (order: number, textToken: StringKey): Record<string, unknown> => ({ order, type: 'text', text: token(textToken), value: false })

const condition = (def: { visibleWhen?: { key: string; equals: string } }) => (def.visibleWhen !== undefined ? { condition: `${def.visibleWhen.key}.value == "${def.visibleWhen.equals}"` } : {})

function property(def: SettingDef | ActionDef): Record<string, unknown> {
  const base = { text: token(def.label), order: 100 + def.order }
  // No buttons in Wallpaper Engine: every toggle of this checkbox triggers the action.
  if (def.type === 'action') return { ...base, type: 'bool', value: false, ...condition(def) }
  // Wallpaper Engine's file dialog accepts images and videos only (official docs; measured in the
  // 2026-09-19 Windows session): a text input takes a wallpaper-folder-relative path instead, and the
  // page normalises it like any host file value (research.md R4).
  if (def.type === 'file') return { ...base, type: 'textinput', value: FILE_DEFAULTS[def.key] ?? '', ...condition(def) }
  if (def.type === 'enum') return { ...base, type: 'combo', value: def.default, options: def.options.map((o) => ({ label: token(o.label), value: o.value })), ...condition(def) }
  if (def.type === 'int' && def.input === 'number') {
    // Wallpaper Engine has no number field: a text input, validated by the page.
    return {
      ...base,
      type: 'textinput',
      value: String(def.default),
      ...(def.visibleWhen !== undefined ? { condition: `${def.visibleWhen.key}.value == "${def.visibleWhen.equals}"` } : {}),
    }
  }
  if (def.type === 'int') {
    return {
      ...base,
      type: 'slider',
      min: def.min,
      max: def.max,
      step: def.step,
      fraction: false,
      value: def.default,
      ...(def.visibleWhen !== undefined ? { condition: `${def.visibleWhen.key}.value == "${def.visibleWhen.equals}"` } : {}),
    }
  }
  return { ...base, type: 'bool', value: def.default }
}

/** Every string key the manifest references. */
export function usedKeys(): StringKey[] {
  const keys = new Set<StringKey>(['notice_wallpaper_engine', 'spacer_wallpaper_engine'])
  for (const d of [...SETTINGS, ...ACTIONS]) {
    keys.add(d.label)
    if (d.type === 'enum') d.options.forEach((o) => keys.add(o.label))
  }
  return [...keys]
}

export function projectJson(): Record<string, unknown> {
  // Dense integer orders from 100 (Workshop pattern): the notice leads (its text ends with a <br>
  // for the gap after it) and a <br></br> element separates the file settings from the rest.
  const defs = [...SETTINGS, ...ACTIONS].sort((a, b) => a.order - b.order)
  const afterFiles = defs.findIndex((d) => d.order >= VIEW_GROUP_ORDER)
  let order = 99
  const next = (): number => ++order
  const properties: Record<string, unknown> = {
    [NOTICE_KEY]: panelElement(next(), 'notice_wallpaper_engine'),
  }
  defs.forEach((def, i) => {
    if (i === afterFiles) properties[SPACER_KEY] = panelElement(next(), 'spacer_wallpaper_engine')
    properties[def.key] = { ...property(def), order: next() }
  })
  const localization = (t: Record<StringKey, string>) => Object.fromEntries(usedKeys().map((k) => [token(k), t[k]]))
  return {
    file: 'index.html',
    type: 'web',
    title: en.package_title,
    description: en.package_description,
    preview: 'preview.png',
    tags: ['Game'],
    contentrating: 'Everyone',
    general: {
      properties,
      localization: { 'en-us': localization(en), 'ru-ru': localization(ru) },
      supportsaudioprocessing: false,
    },
  }
}

export function wallpaperEnginePackage(repoRoot: string, bundle: ClassicBundle): PackageFiles {
  if (bundle.listener === undefined) throw new Error('Wallpaper Engine needs listener.js')
  const files: PackageFiles = new Map()
  files.set('index.html', new Uint8Array(readFileSync(resolve(repoRoot, 'src/adapters/wallpaper-engine/index.html'))))
  files.set('page.css', new Uint8Array(readFileSync(resolve(repoRoot, 'src/adapters/shared/page.css'))))
  files.set('listener.js', utf8(bundle.listener))
  files.set('main.js', utf8(bundle.main))
  files.set('project.json', json(projectJson()))
  files.set('preview.png', previewPng(512))
  files.set('README.txt', readme('help_wallpaper_engine'))
  return files
}
