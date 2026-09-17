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

const condition = (def: { visibleWhen?: { key: string; equals: string } }) => (def.visibleWhen !== undefined ? { condition: `${def.visibleWhen.key}.value == "${def.visibleWhen.equals}"` } : {})

function property(def: SettingDef | ActionDef): Record<string, unknown> {
  const base = { text: token(def.label), order: 100 + def.order }
  // No buttons in Wallpaper Engine: every toggle of this checkbox triggers the action.
  if (def.type === 'action') return { ...base, type: 'bool', value: false, ...condition(def) }
  if (def.type === 'file') return { ...base, type: 'file', value: '' }
  if (def.type === 'enum') return { ...base, type: 'combo', value: def.default, options: def.options.map((o) => ({ label: token(o.label), value: o.value })) }
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
  const keys = new Set<StringKey>()
  for (const d of [...SETTINGS, ...ACTIONS]) {
    keys.add(d.label)
    if (d.type === 'enum') d.options.forEach((o) => keys.add(o.label))
  }
  return [...keys]
}

export function projectJson(): Record<string, unknown> {
  const properties: Record<string, unknown> = {}
  for (const def of [...SETTINGS, ...ACTIONS]) properties[def.key] = property(def)
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
