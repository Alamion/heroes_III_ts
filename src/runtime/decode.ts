// Decoding work shared by the worker and the in-thread fallback: archive → terrain atlas, map →
// world state, both cached by source identity.

import { terrainLayerDefs, TERRAINS } from '../core/data/terrain.ts'
import { parseDef } from '../core/formats/def/def.ts'
import { parseH3mFile } from '../core/formats/h3m/h3m.ts'
import { LodArchive } from '../core/formats/lod/lod.ts'
import { buildAtlas } from '../core/render/atlas.ts'
import type { Atlas, AtlasInput } from '../core/render/atlas.ts'
import { fromH3m } from '../core/state/world.ts'
import type { WorldState } from '../core/state/world.ts'
import { FORMAT_ERROR_CODES, FormatError } from '../core/util/errors.ts'
import { cacheKey } from './cache.ts'
import type { DecodedCache } from './cache.ts'
import { archiveIdentity, BlobSource, mapIdentity } from './file-source.ts'
import type { WorkerDiagnostic } from './protocol.ts'

export interface ArchiveResult {
  identity: string
  atlas: Atlas
  fromCache: boolean
  warnings: WorkerDiagnostic[]
}

export interface MapResult {
  identity: string
  world: WorldState
  fromCache: boolean
  warnings: WorkerDiagnostic[]
}

async function magic(file: Blob): Promise<Uint8Array> {
  return new Uint8Array(await file.slice(0, 4).arrayBuffer())
}

function wrongSlot(name: string, message: string): FormatError {
  return new FormatError({ code: FORMAT_ERROR_CODES.BAD_MAGIC, file: name, offset: 0, format: 'data', structure: 'file type', message })
}

export async function decodeArchive(file: Blob, name: string, cache: DecodedCache): Promise<ArchiveResult> {
  const head = await magic(file)
  if (head[0] === 0x1f && head[1] === 0x8b) throw wrongSlot(name, 'this looks like a map file (.h3m); supply the sprite archive (h3sprite.lod) here')
  const identity = await archiveIdentity(file)
  const key = cacheKey('atlas', identity)
  const cached = await cache.get<Atlas>('atlas', key)
  if (cached !== undefined) return { identity, atlas: cached, fromCache: true, warnings: [] }
  const lod = await LodArchive.open(new BlobSource(file, name))
  const missing = terrainLayerDefs().filter((d) => !lod.has(d))
  if (missing.length > 0) {
    throw new FormatError({
      code: FORMAT_ERROR_CODES.NOT_FOUND,
      file: name,
      offset: 0,
      format: 'lod',
      structure: 'entries',
      message: `archive has no terrain sprites (${missing.slice(0, 3).join(', ')}${missing.length > 3 ? ', …' : ''}); supply the sprite archive (h3sprite.lod)`,
    })
  }
  const inputs: AtlasInput[] = []
  for (const defName of terrainLayerDefs()) {
    inputs.push({ def: parseDef(await lod.read(defName), defName), overlay: !TERRAINS.some((t) => t.defName === defName) })
  }
  const atlas = buildAtlas(inputs)
  await cache.put('atlas', key, atlas)
  return { identity, atlas, fromCache: false, warnings: lod.warnings.map((w) => ({ level: 'warn', code: 'LOD_WARNING', message: w, file: name })) }
}

export async function decodeMap(file: Blob, name: string, cache: DecodedCache): Promise<MapResult> {
  const head = await magic(file)
  if (head[0] === 0x4c && head[1] === 0x4f && head[2] === 0x44 && head[3] === 0) throw wrongSlot(name, 'this is a LOD archive; supply a map file (.h3m) here')
  const identity = await mapIdentity(file)
  const key = cacheKey('world', identity)
  const cached = await cache.get<WorldState>('world', key)
  if (cached !== undefined) return { identity, world: cached, fromCache: true, warnings: [] }
  const map = await parseH3mFile(new Uint8Array(await file.arrayBuffer()), name)
  const world = fromH3m(map, { sha256: identity, name, version: map.version })
  await cache.put('world', key, world)
  return { identity, world, fromCache: false, warnings: [] }
}
