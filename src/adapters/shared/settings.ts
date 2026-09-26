// The one wallpaper settings definition (spec 004 FR-003, contracts/settings.md). Host manifests
// (Wallpaper Engine project.json, Lively properties, KDE config) are generated from it, so this
// module is DOM-free: tools import it.

import type { StringKey } from './strings.ts'

export type SettingKey =
  | 'spritearchive'
  | 'dataarchive'
  | 'hotaarchive'
  | 'mapsource'
  | 'mapfile'
  | 'mapfolder'
  | 'maprotation'
  | 'mapsizemin'
  | 'mapsizemax'
  | 'mapunderground'
  | 'level'
  | 'viewmode'
  | 'viewx'
  | 'viewy'
  | 'viewinterval'
  | 'scale'
  | 'objects'

/**
 * Map size classes as setting values (spec 007). Tools import this module, so it keeps its own list;
 * a test checks it against MAP_SIZE_CLASSES in src/core/data/map-sizes.ts.
 */
export const MAP_SIZE_SETTINGS = ['s', 'm', 'l', 'xl', 'h', 'xh', 'g'] as const
export type SizeClass = (typeof MAP_SIZE_SETTINGS)[number]

/** Where the map comes from (spec 007): one map, or a folder (or .zip) of maps. */
export type MapSource = 'single' | 'folder'
export type UndergroundFilter = 'any' | 'two' | 'one'
export type LevelSetting = 'random' | 'surface' | 'underground'
export type ViewMode = 'random' | 'centre' | 'coords'
export type ScaleSetting = 1 | 2 | 3

export interface WallpaperSettings {
  spritearchive: string | null
  dataarchive: string | null
  /** Optional HotA archive (spec 005); unset means the base game only. */
  hotaarchive: string | null
  mapsource: MapSource
  mapfile: string | null
  /** Folder of maps, or a .zip standing for one (spec 007). */
  mapfolder: string | null
  /** Minutes of visible time between maps of the folder; 0 = only at start. */
  maprotation: number
  mapsizemin: SizeClass
  mapsizemax: SizeClass
  mapunderground: UndergroundFilter
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
  visibleWhen?: { key: SettingKey; equals: string }
  /** Explains when the setting applies (shown where a host cannot hide it). */
  hint?: StringKey
}
export interface FileSettingDef extends BaseDef {
  type: 'file'
  default: null
  fileFilter: '*.lod' | '*.h3m' | '*.zip'
  /**
   * 'folder': the value names a folder of maps (spec 007); hosts with a folder picker show it, the
   * others take a path or, through `fileFilter`, a .zip standing for the folder.
   */
  pick?: 'folder'
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
export type ActionKey = 'viewreroll' | 'mapnext'
export interface ActionDef {
  key: ActionKey
  type: 'action'
  label: StringKey
  visibleWhen?: { key: SettingKey; equals: string }
  order: number
}
export const ACTIONS: readonly ActionDef[] = [
  { key: 'mapnext', type: 'action', label: 'action_mapnext', visibleWhen: { key: 'mapsource', equals: 'folder' }, order: 3.97 },
  { key: 'viewreroll', type: 'action', label: 'action_viewreroll', visibleWhen: { key: 'viewmode', equals: 'random' }, order: 9 },
]

const FOLDER_ONLY = { key: 'mapsource', equals: 'folder' } as const
const SIZE_OPTIONS = MAP_SIZE_SETTINGS.map((id) => ({ value: id, label: `mapsize_${id}` as StringKey }))

export const SETTINGS: readonly SettingDef[] = [
  { key: 'spritearchive', type: 'file', label: 'setting_spritearchive', default: null, fileFilter: '*.lod', order: 1 },
  { key: 'dataarchive', type: 'file', label: 'setting_dataarchive', default: null, fileFilter: '*.lod', order: 2 },
  { key: 'hotaarchive', type: 'file', label: 'setting_hotaarchive', default: null, fileFilter: '*.lod', order: 3 },
  {
    key: 'mapsource',
    type: 'enum',
    label: 'setting_mapsource',
    options: [
      { value: 'single', label: 'mapsource_single' },
      { value: 'folder', label: 'mapsource_folder' },
    ],
    default: 'single',
    order: 3.5,
  },
  { key: 'mapfile', type: 'file', label: 'setting_mapfile', default: null, fileFilter: '*.h3m', visibleWhen: { key: 'mapsource', equals: 'single' }, order: 3.6 },
  { key: 'mapfolder', type: 'file', pick: 'folder', label: 'setting_mapfolder', default: null, fileFilter: '*.zip', visibleWhen: FOLDER_ONLY, hint: 'mapfolder_hint', order: 3.7 },
  { key: 'maprotation', type: 'int', input: 'number', label: 'setting_maprotation', min: 0, max: 1440, step: 1, default: 0, visibleWhen: FOLDER_ONLY, hint: 'maprotation_hint', order: 3.8 },
  { key: 'mapsizemin', type: 'enum', label: 'setting_mapsizemin', options: SIZE_OPTIONS, default: 's', visibleWhen: FOLDER_ONLY, hint: 'mapfolder_hint', order: 3.85 },
  { key: 'mapsizemax', type: 'enum', label: 'setting_mapsizemax', options: SIZE_OPTIONS, default: 'g', visibleWhen: FOLDER_ONLY, hint: 'mapfolder_hint', order: 3.9 },
  {
    key: 'mapunderground',
    type: 'enum',
    label: 'setting_mapunderground',
    options: [
      { value: 'any', label: 'mapunderground_any' },
      { value: 'two', label: 'mapunderground_two' },
      { value: 'one', label: 'mapunderground_one' },
    ],
    default: 'any',
    visibleWhen: FOLDER_ONLY,
    hint: 'mapfolder_hint',
    order: 3.95,
  },
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
  { key: 'viewinterval', type: 'int', input: 'number', label: 'setting_viewinterval', min: 0, max: 1440, step: 1, default: 0, visibleWhen: { key: 'viewmode', equals: 'random' }, hint: 'viewinterval_hint', order: 8 },
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

export const FILE_SETTING_KEYS = ['spritearchive', 'dataarchive', 'hotaarchive', 'mapfile'] as const satisfies readonly SettingKey[]

export function settingDef(key: SettingKey): SettingDef {
  const def = SETTINGS.find((d) => d.key === key)
  if (def === undefined) throw new Error(`unknown setting ${key}`)
  return def
}

export function defaultSettings(): WallpaperSettings {
  return {
    spritearchive: null,
    dataarchive: null,
    hotaarchive: null,
    mapsource: 'single',
    mapfile: null,
    mapfolder: null,
    maprotation: 0,
    mapsizemin: 's',
    mapsizemax: 'g',
    mapunderground: 'any',
    level: 'random',
    viewmode: 'random',
    viewx: 50,
    viewy: 50,
    viewinterval: 0,
    scale: 1,
    objects: true,
  }
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
      else if (key === 'viewmode') set('viewmode', r.value as ViewMode)
      else if (key === 'mapsource') set('mapsource', r.value as MapSource)
      else if (key === 'mapsizemin' || key === 'mapsizemax') set(key, r.value as SizeClass)
      else set('mapunderground', r.value as UndergroundFilter)
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
