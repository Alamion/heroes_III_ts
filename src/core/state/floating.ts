// Floating tiles (spec FR-006, research.md §9): tiles that random map objects — and heroes the game
// generates at players' main towns — may draw on. Candidate outcomes are chosen conservatively per
// outcome class from the game's template table (Objects.txt).

import { HERO_FLAG_DEFS, HERO_MAP_DEFS, HERO_VISIT_OFFSET, OBJECT_CLASS } from '../data/object-classes.ts'
import type { RandomRule } from '../data/object-classes.ts'
import { maskOffsets } from '../formats/h3m/types.ts'
import type { ObjectsTxtRow } from '../formats/text/objects-txt.ts'
import { placeMask, templateAreaMask, unionMasks } from './footprint.ts'
import type { Footprint, SpriteMask } from './footprint.ts'
import type { ObjectId, WorldObject, WorldState } from './world.ts'

export type FloatingCause =
  | { kind: 'randomObject'; objectId: ObjectId; classId: number }
  | { kind: 'generatedHero'; townObjectId: ObjectId | null; player: number }

export interface FloatingTile {
  x: number
  y: number
  causes: FloatingCause[]
}

export interface FloatingLevel {
  z: number
  tiles: FloatingTile[]
  /** Pixel coverage per tile (for image masks). */
  footprint: Footprint
}

export interface FloatingTileSet {
  levels: FloatingLevel[]
  warnings: string[]
}

/** Sprite masks by DEF name (case-insensitive lookup is the caller's job; pass lower-case names). */
export type SpriteMaskLookup = (defName: string) => SpriteMask | undefined

/** Outcome template class for a random rule. */
export function outcomeClass(rule: RandomRule): number {
  switch (rule.kind) {
    case 'artifact':
      return OBJECT_CLASS.ARTIFACT
    case 'monster':
      return OBJECT_CLASS.MONSTER
    case 'resource':
      return OBJECT_CLASS.RESOURCE
    case 'town':
      return OBJECT_CLASS.TOWN
    case 'hero':
      return OBJECT_CLASS.HERO
    case 'dwelling':
      return OBJECT_CLASS.CREATURE_GENERATOR1
  }
}

export { HERO_FLAG_DEFS } from '../data/object-classes.ts'

/** Sprites a hero on the map may be drawn with: every hero class plus the player flags. */
export const HERO_SPRITES: readonly string[] = [...HERO_MAP_DEFS, ...HERO_FLAG_DEFS]

export class CandidateMasks {
  private readonly cache = new Map<string, SpriteMask>()
  readonly warnings: string[] = []

  private readonly templates: readonly ObjectsTxtRow[]
  private readonly sprites: SpriteMaskLookup

  constructor(templates: readonly ObjectsTxtRow[], sprites: SpriteMaskLookup) {
    this.templates = templates
    this.sprites = sprites
  }

  /** Union of all candidate sprites of an outcome class, bottom-right aligned. */
  forClass(classId: number, extraDefs: readonly string[] = []): SpriteMask {
    const key = `${classId}|${extraDefs.join(',')}`
    const hit = this.cache.get(key)
    if (hit !== undefined) return hit
    const names = new Set<string>(extraDefs.map((d) => d.toLowerCase()))
    for (const t of this.templates) if (t.classId === classId) names.add(t.defName.toLowerCase())
    const masks: SpriteMask[] = []
    for (const n of names) {
      const m = this.sprites(n)
      if (m === undefined) this.warnings.push(`sprite ${n} (candidate of class ${classId}) not found; skipped`)
      else masks.push(m)
    }
    if (masks.length === 0) this.warnings.push(`no candidate sprites for class ${classId}`)
    const union = unionMasks(`class ${classId}`, masks)
    this.cache.set(key, union)
    return union
  }

  /** Offset (dx, dy) from a hero's anchor to the tile the hero stands on. */
  heroVisitOffset(): { dx: number; dy: number } {
    const hero = this.templates.find((t) => t.classId === OBJECT_CLASS.HERO)
    const off = hero === undefined ? undefined : maskOffsets(hero.active)[0]
    return off ?? HERO_VISIT_OFFSET
  }
}

function addCause(tiles: Map<string, FloatingTile>, footprint: Footprint, cause: FloatingCause): void {
  for (const [key, cov] of footprint) {
    let t = tiles.get(key)
    if (t === undefined) {
      t = { x: cov.x, y: cov.y, causes: [] }
      tiles.set(key, t)
    }
    t.causes.push(cause)
  }
}

/** Computes floating tiles for every level of a map. Tiles outside the map are dropped. */
export function computeFloatingTiles(state: WorldState, candidates: CandidateMasks, sprites: SpriteMaskLookup): FloatingTileSet {
  const perLevel = Array.from({ length: state.levels }, () => ({ tiles: new Map<string, FloatingTile>(), footprint: new Map() as Footprint }))
  const add = (z: number, sprite: SpriteMask, x: number, y: number, cause: FloatingCause): void => {
    const level = perLevel[z]
    if (level === undefined) return
    const own: Footprint = new Map()
    placeMask(own, sprite, x, y)
    placeMask(level.footprint, sprite, x, y)
    addCause(level.tiles, own, cause)
  }

  for (const o of state.objects.values()) {
    if (o.random === null) continue
    const sprite = randomObjectMask(o, candidates, sprites)
    add(o.z, sprite, o.x, o.y, { kind: 'randomObject', objectId: o.id, classId: o.classId })
  }

  // Heroes generated at main towns: they stand on the town entrance (the player's mainTown pos).
  const heroMask = candidates.forClass(OBJECT_CLASS.HERO, HERO_SPRITES)
  const visit = candidates.heroVisitOffset()
  state.players.forEach((p, player) => {
    if (!p.playable || p.mainTown === null || !p.mainTown.generateHero) return
    const town = [...state.towns.values()].find((t) => {
      const obj = state.objects.get(t.id) as WorldObject
      return obj.z === p.mainTown?.z && maskOffsets(obj.template.active).some(({ dx, dy }) => obj.x + dx === p.mainTown?.x && obj.y + dy === p.mainTown?.y)
    })
    add(p.mainTown.z, heroMask, p.mainTown.x - visit.dx, p.mainTown.y - visit.dy, { kind: 'generatedHero', townObjectId: town?.id ?? null, player })
  })

  const levels: FloatingLevel[] = perLevel.map((l, z) => {
    const tiles = [...l.tiles.values()].filter((t) => t.x >= 0 && t.y >= 0 && t.x < state.size && t.y < state.size).sort((a, b) => a.y - b.y || a.x - b.x)
    return { z, tiles, footprint: l.footprint }
  })
  return { levels, warnings: [...candidates.warnings] }
}

function randomObjectMask(o: WorldObject, candidates: CandidateMasks, sprites: SpriteMaskLookup): SpriteMask {
  const rule = o.random as RandomRule
  const union = candidates.forClass(outcomeClass(rule), rule.kind === 'hero' ? HERO_SPRITES : [])
  // The placeholder sprite itself is also drawn until the outcome replaces it (e.g. in the editor).
  const own = sprites(o.template.defName.toLowerCase()) ?? templateAreaMask(o.template.defName, o.template.passable, o.template.active)
  return unionMasks(`random ${o.id}`, [union, own])
}

/** Serializes one level to the item 1 `--floating-tiles` format ("x,y;x,y"). */
export function toTileList(set: FloatingTileSet, z: number): string {
  return (set.levels[z]?.tiles ?? []).map((t) => `${t.x},${t.y}`).join(';')
}
