// Atlas inputs for the terrain layer, shared by the runtime worker and the Node-side tooling so
// both build exactly the same atlas (spec 005 FR-011).
//
// Base-game terrains are numbered DEFs; the HotA terrains ship as numbered PCX tiles and are
// appended after them, so the base-game rows and cells keep the values they had before.

import { HOTA_TERRAINS, terrainLayerDefs, terrainTileName, TERRAINS } from '../data/terrain.ts'
import { parseDef } from '../formats/def/def.ts'
import { parsePcx } from '../formats/pcx/pcx.ts'
import type { AtlasInput } from './atlas.ts'
import { FormatError } from '../util/errors.ts'

/** The archive (or ordered archive set) the tiles are read from. */
export interface TerrainEntrySource {
  has(name: string): boolean
  read(name: string): Promise<Uint8Array>
  /** Undefined when the entry is absent or cannot be read (spec 008); defaults to has + read. */
  readOptional?(name: string): Promise<Uint8Array | undefined>
}

export interface TerrainAtlasInputs {
  inputs: AtlasInput[]
  /** Base-game terrain DEFs the source does not have; the caller decides how to report them. */
  missingDefs: string[]
  /** HotA terrains whose tile set is incomplete: `{ terrain, tile }` of the first missing tile. */
  incompleteHotaTerrains: { terrain: string; tile: string }[]
}

export async function terrainAtlasInputs(source: TerrainEntrySource): Promise<TerrainAtlasInputs> {
  const missingDefs = terrainLayerDefs().filter((d) => !source.has(d))
  const inputs: AtlasInput[] = []
  if (missingDefs.length > 0) return { inputs, missingDefs, incompleteHotaTerrains: [] }
  for (const defName of terrainLayerDefs()) {
    inputs.push({ def: parseDef(await source.read(defName), defName), overlay: !TERRAINS.some((t) => t.defName === defName) })
  }
  const incompleteHotaTerrains: { terrain: string; tile: string }[] = []
  for (const terrain of HOTA_TERRAINS) {
    if (!source.has(terrainTileName(terrain.prefix, 0))) continue
    const tiles = []
    let missing: string | undefined
    for (let i = 0; i < terrain.count; i++) {
      const tileName = terrainTileName(terrain.prefix, i)
      // A tile that cannot be read or parsed counts as missing (spec 008 FR-010): the terrain is not
      // drawn, the rest of the archive still is.
      const bytes = source.readOptional !== undefined ? await source.readOptional(tileName) : source.has(tileName) ? await source.read(tileName) : undefined
      const tile = bytes === undefined ? undefined : parseTile(bytes, tileName)
      if (tile === undefined) {
        missing = tileName
        break
      }
      tiles.push(tile)
    }
    if (missing === undefined) inputs.push({ tileSet: { name: terrain.prefix, tiles }, overlay: false })
    else incompleteHotaTerrains.push({ terrain: terrain.name, tile: missing })
  }
  return { inputs, missingDefs, incompleteHotaTerrains }
}

function parseTile(bytes: Uint8Array, name: string): ReturnType<typeof parsePcx> | undefined {
  try {
    return parsePcx(bytes, name)
  } catch (err) {
    if (err instanceof FormatError) return undefined
    throw err
  }
}
