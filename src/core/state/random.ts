// Seeded resolution of random map objects to one concrete outcome for display
// (specs/003-map-objects/research.md §6). The game's own generator cannot be reproduced; these
// tiles stay floating in checks. Deterministic for (state, templates, artifact classes, seed).

import { OBJECT_CLASS, FACTION_COUNT } from '../data/object-classes.ts'
import type { RandomRule } from '../data/object-classes.ts'
import { creatureInfo, creaturesOfLevel, MAX_CREATURE_ID } from '../data/creatures.ts'
import { HERO_TYPE_COUNT } from '../data/heroes.ts'
import type { ArtifactClass } from '../formats/text/artraits.ts'
import type { ObjectsTxtRow } from '../formats/text/objects-txt.ts'
import type { Rng } from '../util/rng.ts'
import type { ObjectId, WorldObject, WorldState } from './world.ts'

export interface RandomOutcome {
  readonly rule: RandomRule
  /** Class and subclass the object is drawn as (e.g. MONSTER + creature id). */
  readonly classId: number
  readonly subclassId: number
  /** Template sprite; for towns the renderer picks the sprite by fort state instead. */
  readonly def: string
  /** Resolved hero type for random heroes and placeholders. */
  readonly heroType?: number
}

export interface GameTables {
  /** `Objects.txt` rows from the user's data archive. */
  readonly templates: readonly ObjectsTxtRow[]
  /** Artifact classes by id from `artraits.txt`. */
  readonly artifactClasses: readonly ArtifactClass[]
}

const TERRAIN_RECORD = 7

function terrainAt(state: WorldState, o: WorldObject): number {
  const i = (o.z * state.size * state.size + Math.min(o.y, state.size - 1) * state.size + Math.min(o.x, state.size - 1)) * TERRAIN_RECORD
  return state.terrain[i] ?? 0
}

function bitSet(mask: Uint8Array | null, bit: number): boolean {
  if (mask === null) return false
  return (((mask[bit >> 3] ?? 0) >> (bit & 7)) & 1) === 1
}

/** Picks one element; `undefined` when empty. */
function pick<T>(rng: Rng, items: readonly T[]): T | undefined {
  return items.length === 0 ? undefined : items[rng.int(items.length)]
}

/** Template rows of a class/subclass, preferring those allowed on the object's terrain. */
function templateFor(tables: GameTables, classId: number, subclassId: number | null, terrain: number): ObjectsTxtRow | undefined {
  const rows = tables.templates.filter((r) => r.classId === classId && (subclassId === null || r.subclassId === subclassId))
  return rows.find((r) => ((r.allowedTerrains >> terrain) & 1) === 1) ?? rows[0]
}

const ARTIFACT_CLASS_OF_RULE: ReadonlyMap<number, readonly ArtifactClass[]> = new Map([
  [OBJECT_CLASS.RANDOM_ART, ['treasure', 'minor', 'major', 'relic']],
  [OBJECT_CLASS.RANDOM_TREASURE_ART, ['treasure']],
  [OBJECT_CLASS.RANDOM_MINOR_ART, ['minor']],
  [OBJECT_CLASS.RANDOM_MAJOR_ART, ['major']],
  [OBJECT_CLASS.RANDOM_RELIC_ART, ['relic']],
])

/** An allowed hero type not in `used` (falls back to any type), or undefined when none exist. */
export function pickHeroType(state: WorldState, rng: Rng, used: ReadonlySet<number>): number | undefined {
  const all = Array.from({ length: HERO_TYPE_COUNT }, (_, t) => t)
  const allowed = all.filter((t) => bitSet(state.allowedHeroes, t))
  const free = allowed.filter((t) => !used.has(t))
  return pick(rng, free.length > 0 ? free : allowed.length > 0 ? allowed : all)
}

/** Heroes types placed on the map (not random), so random heroes avoid them. */
export function usedHeroTypes(state: WorldState): Set<number> {
  const used = new Set<number>()
  for (const h of state.heroes.values()) if (h.type !== null) used.add(h.type)
  return used
}

/**
 * Resolves every random object in map order. Objects whose outcome cannot be found in the tables
 * are left out (the caller draws their own template sprite).
 *
 * Deviation from research §6: random dwellings pick any creature generator template allowed on the
 * terrain, ignoring faction and level (no reliable dwelling → creature table in the base game's
 * data; these tiles are floating).
 */
export function resolveRandomObjects(state: WorldState, tables: GameTables, rng: Rng): Map<ObjectId, RandomOutcome> {
  const out = new Map<ObjectId, RandomOutcome>()
  const usedHeroes = usedHeroTypes(state)
  const ids = [...state.objects.keys()].sort((a, b) => a - b)
  for (const id of ids) {
    const o = state.objects.get(id) as WorldObject
    const rule = o.random
    if (rule === null) continue
    const terrain = terrainAt(state, o)
    const outcome = (classId: number, subclassId: number, extra: { heroType?: number } = {}): void => {
      const row = templateFor(tables, classId, subclassId, terrain)
      if (row !== undefined) out.set(id, { rule, classId, subclassId, def: row.defName.toLowerCase(), ...extra })
    }
    switch (rule.kind) {
      case 'monster': {
        const ids = rule.level === 'any' ? Array.from({ length: MAX_CREATURE_ID + 1 }, (_, c) => c).filter((c) => creatureInfo(c) !== undefined) : creaturesOfLevel(rule.level)
        const withTemplate = ids.filter((c) => tables.templates.some((r) => r.classId === OBJECT_CLASS.MONSTER && r.subclassId === c))
        const c = pick(rng, withTemplate)
        if (c !== undefined) outcome(OBJECT_CLASS.MONSTER, c)
        break
      }
      case 'artifact': {
        const classes = ARTIFACT_CLASS_OF_RULE.get(o.classId) ?? []
        const candidates = tables.artifactClasses
          .map((cls, a) => ({ cls, a }))
          .filter(({ cls, a }) => classes.includes(cls) && !bitSet(state.bannedArtifacts, a))
          .map(({ a }) => a)
          .filter((a) => tables.templates.some((r) => r.classId === OBJECT_CLASS.ARTIFACT && r.subclassId === a))
        const a = pick(rng, candidates)
        if (a !== undefined) outcome(OBJECT_CLASS.ARTIFACT, a)
        break
      }
      case 'resource':
        outcome(OBJECT_CLASS.RESOURCE, rng.int(7))
        break
      case 'town': {
        const allowed = o.owner === null ? (1 << FACTION_COUNT) - 1 : (state.players[o.owner]?.allowedFactions ?? 0)
        const factions = Array.from({ length: FACTION_COUNT }, (_, f) => f).filter((f) => ((allowed >> f) & 1) === 1)
        const f = pick(rng, factions.length > 0 ? factions : Array.from({ length: FACTION_COUNT }, (_, i) => i))
        if (f !== undefined) outcome(OBJECT_CLASS.TOWN, f)
        break
      }
      case 'hero': {
        const body = o.details
        const fixed = body.kind === 'heroPlaceholder' && body.heroType !== 0xff ? body.heroType : undefined
        const t = fixed ?? pickHeroType(state, rng, usedHeroes)
        if (t !== undefined) {
          usedHeroes.add(t)
          out.set(id, { rule, classId: OBJECT_CLASS.HERO, subclassId: 0, def: '', heroType: t })
        }
        break
      }
      case 'dwelling': {
        const rows = tables.templates.filter((r) => r.classId === OBJECT_CLASS.CREATURE_GENERATOR1 && ((r.allowedTerrains >> terrain) & 1) === 1)
        const row = pick(rng, rows)
        if (row !== undefined) out.set(id, { rule, classId: row.classId, subclassId: row.subclassId, def: row.defName.toLowerCase() })
        break
      }
    }
  }
  return out
}
