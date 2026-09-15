// Synthetic sprite archive with every terrain, river, road and border sprite name the renderer
// needs, filled with procedural patterns (no game content). Used by browser, determinism and
// budget checks when the user's archive is absent.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RIVERS, ROADS, TERRAINS, BORDER_DEF } from '../../../src/core/data/terrain.ts'
import { ANIMATED_DEFS } from '../../../src/core/data/palette-rotation.ts'
import { proceduralPalette, writeDef } from './def.ts'
import type { SyntheticFrame } from './def.ts'
import { writeLod } from './lod.ts'
import type { SyntheticLodEntry } from './lod.ts'
import { buildMap, writeH3mGz } from './h3m.ts'

/** Frames per sprite: terrain view indices up to 79 appear in real maps; rivers/roads fewer. */
const FRAME_COUNTS = { terrain: 80, river: 13, road: 17, border: 36 }

function frames(seed: number, count: number, overlay: boolean, animated: readonly { start: number; length: number }[]): SyntheticFrame[] {
  return Array.from({ length: count }, (_, i) => {
    const px = new Uint8Array(32 * 32)
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const band = animated[(x + y + i) % Math.max(1, animated.length)]
        let v: number
        if (band !== undefined && ((x >> 2) + (y >> 2)) % 3 === 0) v = band.start + ((x + y * 3 + i) % band.length)
        else v = 20 + ((x * 7 + y * 13 + i * 5 + seed * 11) % 150)
        if (overlay && (x < 8 || x > 23)) v = (x + y) % 9 === 0 ? 1 : 0
        px[y * 32 + x] = v
      }
    }
    return { name: `f${seed}_${i}.pcx`, compression: overlay ? 1 : 3, width: 32, height: 32, pixels: px }
  })
}

export function syntheticTerrainArchive(): Uint8Array {
  const entries: SyntheticLodEntry[] = []
  let seed = 1
  const add = (name: string, count: number, overlay: boolean) => {
    const animated = ANIMATED_DEFS.find((d) => d.defName === name)?.rotations ?? []
    entries.push({ name, data: writeDef({ fullWidth: 32, fullHeight: 32, palette: proceduralPalette(seed), groups: [{ type: 0, frames: frames(seed, count, overlay, animated) }] }), compress: true })
    seed++
  }
  for (const t of TERRAINS) add(t.defName, FRAME_COUNTS.terrain, false)
  for (const r of RIVERS) add(r.defName, FRAME_COUNTS.river, true)
  for (const r of ROADS) add(r.defName, FRAME_COUNTS.road, true)
  add(BORDER_DEF, FRAME_COUNTS.border, true)
  return writeLod(entries)
}

/** A map whose tiles use every terrain type, water, rivers and roads, deterministic in (x, y, z). */
export function syntheticTerrainMap(size: number, underground: boolean): Uint8Array {
  const map = buildMap({
    version: 'SoD',
    size,
    underground,
    tile: (x, y, z) => {
      const band = Math.floor((x + y * 2 + z * 5) / 7) % 10
      const terrain = z === 1 && band === 8 ? 6 : band
      const river = (x * 3 + y) % 23 === 0 ? 1 + ((x + y) % 4) : 0
      const road = (x + y * 5) % 19 === 0 ? 1 + ((x * y) % 3) : 0
      return [terrain, (x * 7 + y * 3) % 72, river, (x + y) % 13, road, (x * 2 + y) % 17, (x ^ y) & 0x3f]
    },
  })
  return writeH3mGz(map)
}

/** Writes the synthetic archive and maps to a temp dir; returns their paths. */
export function writeSyntheticFiles(maps: { name: string; size: number; underground: boolean }[] = [{ name: 'synthetic-36.h3m', size: 36, underground: true }]): { dir: string; archive: string; maps: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'h3-synthetic-'))
  const archive = join(dir, 'synthetic-sprites.lod')
  writeFileSync(archive, syntheticTerrainArchive())
  const out: Record<string, string> = {}
  for (const m of maps) {
    const p = join(dir, m.name)
    writeFileSync(p, syntheticTerrainMap(m.size, m.underground))
    out[m.name] = p
  }
  return { dir, archive, maps: out }
}
