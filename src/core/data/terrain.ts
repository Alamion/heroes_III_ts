// Adventure map tile layers: H3M ids → sprite (DEF) names (research.md §4).

export interface LayerType {
  readonly id: number
  readonly name: string
  readonly defName: string
}

export const TERRAINS = [
  { id: 0, name: 'dirt', defName: 'dirttl.def' },
  { id: 1, name: 'sand', defName: 'sandtl.def' },
  { id: 2, name: 'grass', defName: 'grastl.def' },
  { id: 3, name: 'snow', defName: 'snowtl.def' },
  { id: 4, name: 'swamp', defName: 'swmptl.def' },
  { id: 5, name: 'rough', defName: 'rougtl.def' },
  { id: 6, name: 'subterranean', defName: 'subbtl.def' },
  { id: 7, name: 'lava', defName: 'lavatl.def' },
  { id: 8, name: 'water', defName: 'watrtl.def' },
  { id: 9, name: 'rock', defName: 'rocktl.def' },
] as const satisfies readonly LayerType[]

/** River id 0 means "no river". */
export const RIVERS = [
  { id: 1, name: 'clear', defName: 'clrrvr.def' },
  { id: 2, name: 'icy', defName: 'icyrvr.def' },
  { id: 3, name: 'muddy', defName: 'mudrvr.def' },
  { id: 4, name: 'lava', defName: 'lavrvr.def' },
] as const satisfies readonly LayerType[]

/** Road id 0 means "no road". */
export const ROADS = [
  { id: 1, name: 'dirt', defName: 'dirtrd.def' },
  { id: 2, name: 'gravel', defName: 'gravrd.def' },
  { id: 3, name: 'cobblestone', defName: 'cobbrd.def' },
] as const satisfies readonly LayerType[]

/**
 * HotA terrains (spec 005 research M1, M4, M7). They are not terrain DEFs: each ships as 124
 * separate 32x32 PCX tiles named `<prefix>000.pcx` … `<prefix>123.pcx`, and the map tile record
 * stores the chosen index and the mirroring bits exactly as for the base terrains.
 */
export interface TileSetTerrain {
  readonly id: number
  readonly name: string
  readonly prefix: string
  readonly count: number
}

export const HOTA_TERRAINS = [
  { id: 10, name: 'highlands', prefix: 'hglnt', count: 124 },
  { id: 11, name: 'wasteland', prefix: 'wstlt', count: 124 },
] as const satisfies readonly TileSetTerrain[]

/** Where a terrain's sprites come from: one DEF (base game) or a numbered PCX tile set (HotA). */
export type TerrainSource =
  | { readonly kind: 'def'; readonly id: number; readonly name: string; readonly defName: string }
  | { readonly kind: 'tiles'; readonly id: number; readonly name: string; readonly prefix: string; readonly count: number }

export function terrainSource(id: number): TerrainSource | undefined {
  const base = TERRAINS.find((t) => t.id === id)
  if (base !== undefined) return { kind: 'def', id: base.id, name: base.name, defName: base.defName }
  const hota = HOTA_TERRAINS.find((t) => t.id === id)
  if (hota !== undefined) return { kind: 'tiles', id: hota.id, name: hota.name, prefix: hota.prefix, count: hota.count }
  return undefined
}

/** Tile file name of a HotA terrain, e.g. `hglnt007.pcx`. */
export function terrainTileName(prefix: string, index: number): string {
  return `${prefix}${String(index).padStart(3, '0')}.pcx`
}

export const TERRAIN_COUNT = TERRAINS.length
/** Terrain ids a HotA map may use: the ten base ones plus Highlands (10) and Wasteland (11). */
export const HOTA_TERRAIN_COUNT = TERRAINS.length + HOTA_TERRAINS.length
export const MAX_RIVER_ID = 4
export const MAX_ROAD_ID = 3

/** Map border sprite drawn outside the map area. */
export const BORDER_DEF = 'edg.def'

export function terrainDef(id: number): string | undefined {
  return TERRAINS.find((t) => t.id === id)?.defName
}

/** Atlas sprite name of a terrain: the DEF name, or the tile-set prefix for a HotA terrain. */
export function terrainSpriteName(id: number): string | undefined {
  const source = terrainSource(id)
  if (source === undefined) return undefined
  return source.kind === 'def' ? source.defName : source.prefix
}

export function riverDef(id: number): string | undefined {
  return RIVERS.find((t) => t.id === id)?.defName
}

export function roadDef(id: number): string | undefined {
  return ROADS.find((t) => t.id === id)?.defName
}

/** Tile flag bits (7th tile byte). */
export const TILE_FLAGS = {
  terrainFlipX: 1 << 0,
  terrainFlipY: 1 << 1,
  riverFlipX: 1 << 2,
  riverFlipY: 1 << 3,
  roadFlipX: 1 << 4,
  roadFlipY: 1 << 5,
  coast: 1 << 6,
} as const

export const TILE_SIZE = 32

/**
 * Vertical offset of road sprites in pixels (positive = down): half a tile down, measured against an
 * original-editor still (research.md §4).
 */
export const ROAD_OFFSET_Y = 16

/** Every DEF the terrain renderer needs, in atlas order. */
export function terrainLayerDefs(): string[] {
  return [...TERRAINS.map((t) => t.defName), ...RIVERS.map((t) => t.defName), ...ROADS.map((t) => t.defName), BORDER_DEF]
}
