// The one wallpaper settings definition (spec 004 FR-003, contracts/settings.md). Host manifests
// (Wallpaper Engine project.json, Lively properties, KDE config) are generated from it, so this
// module is DOM-free: tools import it.

import type { StringKey } from './strings.ts'

export type SettingKey = 'spritearchive' | 'dataarchive' | 'mapfile' | 'level' | 'viewmode' | 'viewx' | 'viewy' | 'viewinterval' | 'scale' | 'objects'

/** Keys kept for a later map-folder source (FR-018a); never used for anything else. */
export const RESERVED_KEYS = ['mapsource', 'mapfolder', 'maprotation'] as const

export type LevelSetting = 'random' | 'surface' | 'underground'
export type ViewMode = 'random' | 'centre' | 'coords'
export type ScaleSetting = 1 | 2 | 3

export interface WallpaperSettings {
  spritearchive: string | null
  dataarchive: string | null
  mapfile: string | null
  level: LevelSetting
  viewmode: ViewMode
  viewx: number
  viewy: number
  /** Minutes between random places (random mode); 0 = never. */
  viewinterval: number
  scale: ScaleSetting
  objects: boolean
}

interface BaseDef {
  key: SettingKey
  label: StringKey
  order: number
}
export interface FileSettingDef extends BaseDef {
  type: 'file'
  default: null
  fileFilter: '*.lod' | '*.h3m'
}
export interface EnumSettingDef extends BaseDef {
  type: 'enum'
  options: readonly { value: string; label: StringKey }[]
  default: string
}
export interface IntSettingDef extends BaseDef {
  type: 'int'
  /** Slider (default) or a number field; number fields accept typed text, validated on apply. */
  input?: 'slider' | 'number'
  min: number
  max: number
  step: number
  default: number
  visibleWhen?: { key: SettingKey; equals: string }
  hint?: StringKey
}
export interface BoolSettingDef extends BaseDef {
  type: 'bool'
  default: boolean
}
export type SettingDef = FileSettingDef | EnumSettingDef | IntSettingDef | BoolSettingDef

/**
 * Host controls that trigger something instead of holding a value (spec 004 FR-003a "new random place").
 * Hosts show them next to the settings: Wallpaper Engine as a checkbox whose every toggle acts (it has no
 * buttons), Lively as a button, KDE as a button on the settings page (a counter in the config), the
 * browser as a panel button. They are never part of WallpaperSettings.
 */
export type ActionKey = 'viewreroll'
export interface ActionDef {
  key: ActionKey
  type: 'action'
  label: StringKey
  visibleWhen?: { key: SettingKey; equals: string }
  order: number
}
export const ACTIONS: readonly ActionDef[] = [{ key: 'viewreroll', type: 'action', label: 'action_viewreroll', visibleWhen: { key: 'viewmode', equals: 'random' }, order: 9 }]

export const SETTINGS: readonly SettingDef[] = [
  { key: 'spritearchive', type: 'file', label: 'setting_spritearchive', default: null, fileFilter: '*.lod', order: 1 },
  { key: 'dataarchive', type: 'file', label: 'setting_dataarchive', default: null, fileFilter: '*.lod', order: 2 },
  { key: 'mapfile', type: 'file', label: 'setting_mapfile', default: null, fileFilter: '*.h3m', order: 3 },
  {
    key: 'level',
    type: 'enum',
    label: 'setting_level',
    options: [
      { value: 'random', label: 'level_random' },
      { value: 'surface', label: 'level_surface' },
      { value: 'underground', label: 'level_underground' },
    ],
    default: 'random',
    order: 4,
  },
  {
    key: 'viewmode',
    type: 'enum',
    label: 'setting_viewmode',
    options: [
      { value: 'random', label: 'viewmode_random' },
      { value: 'centre', label: 'viewmode_centre' },
      { value: 'coords', label: 'viewmode_coords' },
    ],
    default: 'random',
    order: 5,
  },
  { key: 'viewx', type: 'int', label: 'setting_viewx', min: 0, max: 100, step: 1, default: 50, visibleWhen: { key: 'viewmode', equals: 'coords' }, hint: 'viewx_hint', order: 6 },
  { key: 'viewy', type: 'int', label: 'setting_viewy', min: 0, max: 100, step: 1, default: 50, visibleWhen: { key: 'viewmode', equals: 'coords' }, hint: 'viewx_hint', order: 7 },
  { key: 'viewinterval', type: 'int', input: 'number', label: 'setting_viewinterval', min: 0, max: 120, step: 1, default: 0, visibleWhen: { key: 'viewmode', equals: 'random' }, hint: 'viewinterval_hint', order: 8 },
  {
    key: 'scale',
    type: 'enum',
    label: 'setting_scale',
    options: [
      { value: '1', label: 'scale_1' },
      { value: '2', label: 'scale_2' },
      { value: '3', label: 'scale_3' },
    ],
    default: '1',
    order: 10,
  },
  { key: 'objects', type: 'bool', label: 'setting_objects', default: true, order: 11 },
]

export const FILE_SETTING_KEYS = ['spritearchive', 'dataarchive', 'mapfile'] as const satisfies readonly SettingKey[]

export function settingDef(key: SettingKey): SettingDef {
  const def = SETTINGS.find((d) => d.key === key)
  if (def === undefined) throw new Error(`unknown setting ${key}`)
  return def
}

export function defaultSettings(): WallpaperSettings {
  return { spritearchive: null, dataarchive: null, mapfile: null, level: 'random', viewmode: 'random', viewx: 50, viewy: 50, viewinterval: 0, scale: 1, objects: true }
}

export interface ValidatedPatch {
  patch: Partial<WallpaperSettings>
  /** Keys that were not settings (old manifests, typos): ignored. */
  ignored: string[]
  /** Values that were replaced by a clamp or the default. */
  corrected: string[]
}

const isSettingKey = (k: string): k is SettingKey => SETTINGS.some((d) => d.key === k)

function enumValue(def: EnumSettingDef, raw: unknown): { value: string; corrected: boolean } {
  const text = typeof raw === 'number' ? String(raw) : typeof raw === 'string' ? raw.trim() : ''
  if (def.options.some((o) => o.value === text)) return { value: text, corrected: false }
  return { value: def.default, corrected: true }
}

/** Typed numbers: optional sign, digits, optional fraction with a dot or a comma ("1,5"). */
const NUMBER_TEXT = /^[+-]?\d+(?:[.,]\d+)?$/

function intValue(def: IntSettingDef, raw: unknown): { value: number; corrected: boolean } {
  const text = typeof raw === 'string' ? raw.trim() : ''
  const n = typeof raw === 'number' ? raw : NUMBER_TEXT.test(text) ? Number(text.replace(',', '.')) : Number.NaN
  // Empty, non-numeric or infinite input falls back to the default; the rest is rounded and clamped.
  if (!Number.isFinite(n)) return { value: def.default, corrected: true }
  const clamped = Math.min(def.max, Math.max(def.min, Math.round(n)))
  return { value: clamped, corrected: clamped !== n }
}

function boolValue(def: BoolSettingDef, raw: unknown): { value: boolean; corrected: boolean } {
  if (typeof raw === 'boolean') return { value: raw, corrected: false }
  if (raw === 'true' || raw === 1 || raw === '1') return { value: true, corrected: false }
  if (raw === 'false' || raw === 0 || raw === '0') return { value: false, corrected: false }
  return { value: def.default, corrected: true }
}

/** Validates raw host values into a settings patch; never throws. */
export function validateSettings(raw: Record<string, unknown>): ValidatedPatch {
  const patch: Partial<WallpaperSettings> = {}
  const ignored: string[] = []
  const corrected: string[] = []
  const set = <K extends SettingKey>(key: K, value: WallpaperSettings[K]) => {
    patch[key] = value
  }
  for (const [key, value] of Object.entries(raw)) {
    if (!isSettingKey(key)) {
      ignored.push(key)
      continue
    }
    const def = settingDef(key)
    if (def.type === 'file') {
      set(key as 'mapfile', typeof value === 'string' && value.trim() !== '' ? value : null)
    } else if (def.type === 'enum') {
      const r = enumValue(def, value)
      if (r.corrected) corrected.push(key)
      if (key === 'scale') set('scale', Number(r.value) as ScaleSetting)
      else if (key === 'level') set('level', r.value as LevelSetting)
      else set('viewmode', r.value as ViewMode)
    } else if (def.type === 'int') {
      const r = intValue(def, value)
      if (r.corrected) corrected.push(key)
      set(key as 'viewx', r.value)
    } else {
      const r = boolValue(def, value)
      if (r.corrected) corrected.push(key)
      set(key as 'objects', r.value)
    }
  }
  return { patch, ignored, corrected }
}

/** Raw host value of a setting, for manifests and panels (enums as their option value). */
export function rawValue(settings: WallpaperSettings, key: SettingKey): string | number | boolean | null {
  const v = settings[key]
  return key === 'scale' ? String(v) : v
}
