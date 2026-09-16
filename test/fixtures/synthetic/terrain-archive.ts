// Synthetic sprite archive with every terrain, river, road and border sprite name the renderer
// needs plus object sprites, and a synthetic data archive (Objects.txt, artraits.txt, game.pal), filled with
// procedural patterns (no game content). Used by browser, determinism and budget checks when the
// user's archives are absent.

import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { RIVERS, ROADS, TERRAINS, BORDER_DEF } from '../../../src/core/data/terrain.ts'
import { ANIMATED_DEFS } from '../../../src/core/data/palette-rotation.ts'
import { proceduralPalette, writeDef } from './def.ts'
import type { SyntheticFrame } from './def.ts'
import { writeLod } from './lod.ts'
import type { SyntheticLodEntry } from './lod.ts'
import { allBodiesMap, blankTemplate, buildMap, writeH3mGz } from './h3m.ts'
import { objectsTxtLine, syntheticPlayersPalette, writeHeroBodyDef, writeObjectDef, writeRiffPal } from './object-defs.ts'
import type { ObjectDefOptions } from './object-defs.ts'
import { HERO_FLAG_DEFS, HERO_MAP_DEFS, OBJECT_CLASS } from '../../../src/core/data/object-classes.ts'
import type { MapObject, ObjectBody, ObjectTemplate } from '../../../src/core/formats/h3m/types.ts'

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
  for (const [name, o] of Object.entries(OBJECT_DEFS)) entries.push({ name, data: writeObjectDef(o), compress: true })
  HERO_MAP_DEFS.forEach((name, i) => entries.push({ name, data: writeHeroBodyDef(100 + i), compress: true }))
  HERO_FLAG_DEFS.forEach((name, i) => entries.push({ name, data: writeObjectDef({ width: 96, height: 64, frames: 8, groups: 10, seed: 120 + i }), compress: true }))
  return writeLod(entries)
}

/** Synthetic object sprites by DEF name (lower case). Town names are the real Castle names. */
export const OBJECT_DEFS: Record<string, ObjectDefOptions> = {
  'synflat.def': { width: 96, height: 64, frames: 1, seed: 1 },
  'syntree.def': { width: 64, height: 64, frames: 1, seed: 2, shadow: true },
  'synanim.def': { width: 64, height: 64, frames: 8, seed: 3, shadow: true },
  'synmine.def': { width: 96, height: 64, frames: 4, seed: 4, shadow: true, flag: true },
  'avccast0.def': { width: 192, height: 192, frames: 1, seed: 5, flag: true },
  'avccasx0.def': { width: 192, height: 192, frames: 1, seed: 6, flag: true, shadow: true },
  'avccasz0.def': { width: 192, height: 192, frames: 1, seed: 7, flag: true },
  'synrand.def': { width: 64, height: 64, frames: 1, seed: 8 },
  'synevent.def': { width: 32, height: 32, frames: 1, seed: 9 },
  // Creatures 0–13 (Castle, levels 1–7): outcomes for random monsters.
  ...Object.fromEntries(Array.from({ length: 14 }, (_, i) => [`synmon${i}.def`, { width: 64, height: 64, frames: 6 + i, seed: 20 + i, shadow: true }])),
}

interface SyntheticTemplate {
  defName: string
  classId: number
  subclassId: number
  overlay?: boolean
  visitable?: boolean
}

/** Templates used on synthetic maps, in template-index order. */
const MAP_TEMPLATES: SyntheticTemplate[] = [
  { defName: 'synflat.def', classId: 118, subclassId: 0, overlay: true },
  { defName: 'syntree.def', classId: 119, subclassId: 0 },
  { defName: 'synanim.def', classId: 120, subclassId: 0 },
  { defName: 'synmine.def', classId: OBJECT_CLASS.MINE, subclassId: 0, visitable: true },
  { defName: 'synmon3.def', classId: OBJECT_CLASS.MONSTER, subclassId: 3, visitable: true },
  { defName: 'ah00_e.def', classId: OBJECT_CLASS.HERO, subclassId: 0, visitable: true },
  { defName: 'avccasx0.def', classId: OBJECT_CLASS.TOWN, subclassId: 0, visitable: true },
  { defName: 'synrand.def', classId: OBJECT_CLASS.RANDOM_MONSTER, subclassId: 0, visitable: true },
  { defName: 'synevent.def', classId: OBJECT_CLASS.EVENT, subclassId: 0, visitable: true },
]

/** `Objects.txt` of the synthetic data archive: map templates plus random-outcome templates. */
export function syntheticObjectsTxt(): string {
  const rows: SyntheticTemplate[] = [
    ...MAP_TEMPLATES.filter((t) => t.classId !== OBJECT_CLASS.HERO),
    ...Array.from({ length: 14 }, (_, i) => ({ defName: `synmon${i}.def`, classId: OBJECT_CLASS.MONSTER, subclassId: i, visitable: true })),
    { defName: 'avccast0.def', classId: OBJECT_CLASS.TOWN, subclassId: 0, visitable: true },
    { defName: 'avccasz0.def', classId: OBJECT_CLASS.TOWN, subclassId: 0, visitable: true },
  ]
  return `${rows.length}\r\n${rows.map((r) => objectsTxtLine(r)).join('\r\n')}\r\n`
}

/** Synthetic data archive (the role of h3bitmap.lod): Objects.txt, artraits.txt and game.pal. */
export function syntheticDataArchive(): Uint8Array {
  return writeLod([
    { name: 'Objects.txt', data: new TextEncoder().encode(syntheticObjectsTxt()), compress: true, type: 0x02 },
    { name: 'game.pal', data: writeRiffPal(syntheticPlayersPalette()), compress: true, type: 0x60 },
    { name: 'artraits.txt', data: new TextEncoder().encode(syntheticArtTraits()), compress: true, type: 0x02 },
  ])
}

/** `artraits.txt` with 10 artifacts: 7 special, then treasure, minor, relic. */
export function syntheticArtTraits(): string {
  const row = (name: string, cls: string) => [name, '100', ...Array.from({ length: 19 }, () => ' '), cls, `"{${name}}"`].join('\t')
  const rows = [...Array.from({ length: 7 }, (_, i) => row(`special${i}`, 'S')), row('treasure', 'T'), row('minor', 'N'), row('relic', 'R')]
  return ['\t\tHero Slots', 'Name\tCost', ...rows, ''].join('\r\n')
}

const BLOCK_W = 19
const BLOCK_H = 17

/**
 * The repeating 19×17 object pattern (absolute coordinates modulo the block, so any view shows the
 * same objects on maps of different sizes): flat + standing overlap, animated decoration, an owned
 * mine (owner cycles through players and neutral), a monster, a hero per player, a town, a random
 * monster and an event.
 */
export function syntheticObjects(size: number, levels: number): { templates: ObjectTemplate[]; objects: Omit<MapObject, 'index' | 'offset' | 'classId' | 'subclassId'>[] } {
  const bodies = new Map(allBodiesMap('SoD').objects.map((o) => [o.classId, o.body]))
  const body = (classId: number): ObjectBody => bodies.get(classId) as ObjectBody
  const templates = MAP_TEMPLATES.map((t) => ({ ...blankTemplate(t.defName, t.classId, t.subclassId), isOverlay: t.overlay === true, active: t.visitable === true ? Uint8Array.of(0, 0, 0, 0, 0, 0x80) : new Uint8Array(6) }))
  const objects: Omit<MapObject, 'index' | 'offset' | 'classId' | 'subclassId'>[] = []
  const put = (x: number, y: number, z: number, templateIndex: number, b: ObjectBody) => {
    if (x < size && y < size) objects.push({ x, y, z, templateIndex, body: b })
  }
  for (let z = 0; z < levels; z++) {
    for (let by = 0; by < size; by += BLOCK_H) {
      for (let bx = 0; bx < size; bx += BLOCK_W) {
        const block = Math.floor(bx / BLOCK_W) + Math.floor(by / BLOCK_H) * 3 + z
        const owner = block % 9 === 8 ? 0xff : block % 9
        put(bx + 4, by + 4, z, 0, { kind: 'none' } as ObjectBody)
        put(bx + 5, by + 4, z, 1, { kind: 'none' } as ObjectBody)
        put(bx + 8, by + 4, z, 2, { kind: 'none' } as ObjectBody)
        put(bx + 12, by + 5, z, 3, { kind: 'owned', owner })
        put(bx + 15, by + 4, z, 4, body(OBJECT_CLASS.MONSTER))
        const hero = body(OBJECT_CLASS.HERO)
        if (hero.kind === 'hero') put(bx + 5, by + 10, z, 5, { ...hero, owner: block % 8, type: (block * 8 + 3) % 144 })
        const town = body(OBJECT_CLASS.TOWN)
        if (town.kind === 'town') put(bx + 11, by + 12, z, 6, { ...town, owner: owner })
        put(bx + 15, by + 10, z, 7, body(OBJECT_CLASS.RANDOM_MONSTER_L7))
        put(bx + 16, by + 14, z, 8, body(OBJECT_CLASS.EVENT))
      }
    }
  }
  return { templates, objects }
}

/** A map whose tiles use every terrain type, water, rivers and roads, deterministic in (x, y, z). */
export function syntheticTerrainMap(size: number, underground: boolean, withObjects = true): Uint8Array {
  const map = buildMap({
    ...(withObjects ? syntheticObjects(size, underground ? 2 : 1) : {}),
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
export function writeSyntheticFiles(maps: { name: string; size: number; underground: boolean }[] = [{ name: 'synthetic-36.h3m', size: 36, underground: true }]): { dir: string; archive: string; dataArchive: string; maps: Record<string, string> } {
  const dir = mkdtempSync(join(tmpdir(), 'h3-synthetic-'))
  const archive = join(dir, 'synthetic-sprites.lod')
  writeFileSync(archive, syntheticTerrainArchive())
  const dataArchive = join(dir, 'synthetic-data.lod')
  writeFileSync(dataArchive, syntheticDataArchive())
  const out: Record<string, string> = {}
  for (const m of maps) {
    const p = join(dir, m.name)
    writeFileSync(p, syntheticTerrainMap(m.size, m.underground))
    out[m.name] = p
  }
  return { dir, archive, dataArchive, maps: out }
}
