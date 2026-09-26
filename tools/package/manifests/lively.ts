// Lively Wallpaper package (spec 004 contracts/settings.md "Lively"): LivelyInfo, properties with
// folderDropdown file settings (Lively copies chosen files into userfiles/), Russian localization,
// the classic page and a .zip with LivelyInfo.json at its root.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACTIONS, SETTINGS } from '../../../src/adapters/shared/settings.ts'
import type { ActionDef, SettingDef } from '../../../src/adapters/shared/settings.ts'
import { en, ru } from '../../../src/adapters/shared/strings.ts'
import type { StringKey } from '../../../src/adapters/shared/strings.ts'
import type { ClassicBundle, PackageFiles } from '../build.ts'
import { previewPng } from '../previews.ts'
import { AUTHOR, ISSUES_URL } from '../../../src/adapters/shared/project.ts'
import { livelyVersion, parseVersion } from '../../release/semver.ts'
import { json, readme, utf8, versionOf } from './common.ts'

export const LIVELY_USER_FOLDER = 'userfiles'

export function livelyInfo(version: string): Record<string, unknown> {
  return {
    AppVersion: '2.2.0.0',
    Title: en.package_title,
    Thumbnail: 'thumbnail.png',
    Preview: 'preview.png',
    Desc: en.package_description,
    Author: AUTHOR,
    License: 'MIT',
    // Spec 006 FR-015/FR-017: feedback goes to GitHub Issues; no e-mail anywhere.
    Contact: ISSUES_URL,
    // Lively's integer wallpaper version, growing with every release (research R2).
    Version: livelyVersion(parseVersion(version)),
    Type: 1,
    FileName: 'index.html',
    Arguments: '--pause-event true',
    IsAbsolutePath: false,
    Tags: ['game', 'map', 'pixel art'],
  }
}

/** Settings and actions in panel order. */
const CONTROLS = (): (SettingDef | ActionDef)[] => [...SETTINGS, ...ACTIONS].sort((a, b) => a.order - b.order)

function control(def: SettingDef | ActionDef, t: Record<StringKey, string>): Record<string, unknown> {
  if (def.type === 'action') return { type: 'button', text: t[def.label], value: t[def.label] }
  // Lively has no conditions: a hint says when a setting applies (spec 007 folder settings).
  const help = def.hint !== undefined ? { help: t[def.hint] } : {}
  // A map folder reaches Lively as one .zip (spec 007 research R1): folderDropdown copies single files.
  if (def.type === 'file') return { type: 'folderDropdown', text: t[def.label], folder: LIVELY_USER_FOLDER, filter: def.fileFilter, value: null, ...help }
  if (def.type === 'enum') return { type: 'dropdown', text: t[def.label], items: def.options.map((o) => t[o.label]), value: def.options.findIndex((o) => o.value === def.default), ...help }
  if (def.type === 'int' && def.input === 'number') return { type: 'textbox', text: t[def.label], value: String(def.default), ...(def.hint !== undefined ? { help: t[def.hint] } : {}) }
  if (def.type === 'int') return { type: 'slider', text: t[def.label], min: def.min, max: def.max, step: def.step, value: def.default, ...(def.hint !== undefined ? { help: t[def.hint] } : {}) }
  return { type: 'checkbox', text: t[def.label], value: def.default }
}

export function livelyProperties(): Record<string, unknown> {
  return Object.fromEntries(CONTROLS().map((d) => [d.key, control(d, en)]))
}

export function livelyPropertiesLoc(): Record<string, unknown> {
  const ruControls = Object.fromEntries(
    CONTROLS().map((d) => {
      const c = control(d, ru) as { text: string; items?: string[]; help?: string }
      return [d.key, { text: c.text, ...(c.items !== undefined ? { items: c.items } : {}), ...(c.help !== undefined ? { help: c.help } : {}) }]
    }),
  )
  return { Languages: { ru: ruControls } }
}

export function livelyPackage(repoRoot: string, bundle: ClassicBundle): PackageFiles {
  if (bundle.listener === undefined) throw new Error('Lively needs listener.js')
  const read = (p: string) => new Uint8Array(readFileSync(resolve(repoRoot, p)))
  const files: PackageFiles = new Map()
  files.set('index.html', read('src/adapters/lively/index.html'))
  files.set('page.css', read('src/adapters/shared/page.css'))
  files.set('listener.js', utf8(bundle.listener))
  files.set('main.js', utf8(bundle.main))
  const version = versionOf(repoRoot)
  files.set('LivelyInfo.json', json(livelyInfo(version)))
  files.set('LivelyInfo.loc.json', json({ Languages: { ru: { Title: ru.package_title, Desc: ru.package_description } } }))
  files.set('LivelyProperties.json', json(livelyProperties()))
  files.set('LivelyProperties.loc.json', json(livelyPropertiesLoc()))
  files.set(`${LIVELY_USER_FOLDER}/.keep`, new Uint8Array(0))
  files.set('preview.png', previewPng(512))
  files.set('thumbnail.png', previewPng(256))
  files.set('README.txt', readme('help_lively', version))
  return files
}
