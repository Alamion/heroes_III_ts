// What the renderer draws for a world state: one entry per visible map object, two per hero (body
// and flag), with random objects resolved (specs/003-map-objects/data-model.md "Resolved object").

import { HERO_FLAG_DEFS, HERO_MAP_DEFS, HERO_VISIT_OFFSET, HIDDEN_CLASSES, OBJECT_CLASS, TOWN_SPRITES } from '../data/object-classes.ts'
import { BOAT_HERO_DEFS, HERO_DEFAULT_IDLE, heroClassOfType } from '../data/heroes.ts'
import { maskOffsets } from '../formats/h3m/types.ts'
import type { Rng } from '../util/rng.ts'
import { hashInts } from '../util/rng.ts'
import { pickHeroType, resolveRandomObjects, usedHeroTypes } from './random.ts'
import type { GameTables, RandomOutcome } from './random.ts'
import type { ObjectId, WorldObject, WorldState } from './world.ts'

export type RenderObjectKind = 'object' | 'heroBody' | 'heroFlag'

export interface RenderObject {
  /** World object id; generated heroes use −1 − player. */
  readonly id: ObjectId
  readonly kind: RenderObjectKind
  readonly classId: number
  /** Anchor tile: the sprite's bottom-right corner sits on this tile's bottom-right. */
  readonly x: number
  readonly y: number
  readonly z: number
  /** Lower-case DEF name. */
  readonly def: string
  readonly group: number
  readonly mirror: boolean
  /** Player 0–7, or null (neutral flag colour). */
  readonly owner: number | null
  readonly flat: boolean
  readonly visitable: boolean
  /** Map file order (tie-break of the draw order). */
  readonly order: number
  readonly random: RandomOutcome | null
  /** The object's tiles are excluded from automated checks. */
  readonly floating: boolean
  /** Animation phase offset in ticks (per object, from the seed; research.md §7). */
  readonly phase: number
}

const WATER = 8
// Town building mask, byte 0: bit 2 capitol, 3 fort, 4 citadel, 5 castle.
const BUILDING_BIT_CAPITOL = 2
const BUILDING_BIT_FORT = 3
const BUILDING_BIT_CITADEL = 4
const BUILDING_BIT_CASTLE = 5

function terrainAt(state: WorldState, x: number, y: number, z: number): number {
  if (x < 0 || y < 0 || x >= state.size || y >= state.size) return -1
  return state.terrain[(z * state.size * state.size + y * state.size + x) * 7] ?? -1
}

/**
 * Adventure-map sprite of a town.
 *
 * The base game only ever shows three forms, because its `Objects.txt` declares the castle
 * template alone; HotA repainted all nine factions and added the fort and citadel forms, so a HotA
 * map picks by fortification level (spec 005 research M7, FR-013).
 */
function townDef(faction: number, state: WorldState, id: ObjectId, fallback: string): string {
  const sprites = TOWN_SPRITES[faction]
  const town = state.towns.get(id)
  if (sprites === undefined || town === undefined) return fallback
  const built = town.buildings
  const bit = (b: number): boolean => built !== null && (((built[0] ?? 0) >> b) & 1) === 1
  if (bit(BUILDING_BIT_CAPITOL)) return sprites.capitol
  const hasFort = town.hasFort || bit(BUILDING_BIT_FORT)
  if (state.map.version === 'HotA') {
    if (bit(BUILDING_BIT_CASTLE)) return sprites.castle
    if (bit(BUILDING_BIT_CITADEL)) return sprites.citadel ?? sprites.castle
    if (hasFort) return sprites.fort ?? sprites.castle
    return sprites.village
  }
  if (hasFort) return sprites.castle
  return sprites.village
}

function heroEntries(base: { id: ObjectId; x: number; y: number; z: number; owner: number | null; order: number; random: RandomOutcome | null; floating: boolean }, type: number, state: WorldState): Omit<RenderObject, 'phase'>[] {
  const heroClass = heroClassOfType(type)
  if (heroClass === undefined) return []
  const onWater = terrainAt(state, base.x + HERO_VISIT_OFFSET.dx, base.y + HERO_VISIT_OFFSET.dy, base.z) === WATER
  const common = { ...base, classId: OBJECT_CLASS.HERO, group: HERO_DEFAULT_IDLE.group, mirror: HERO_DEFAULT_IDLE.mirror, flat: false, visitable: true }
  const body: Omit<RenderObject, 'phase'> = { ...common, kind: 'heroBody', def: onWater ? (BOAT_HERO_DEFS[0] as string) : (HERO_MAP_DEFS[heroClass] as string) }
  const flagDef = base.owner === null ? undefined : HERO_FLAG_DEFS[base.owner]
  return flagDef === undefined ? [body] : [body, { ...common, kind: 'heroFlag', def: flagDef }]
}

/**
 * Builds the render entries of a world state. `rng` decides random outcomes and generated heroes;
 * pass `createRng(state.seed)` for the canonical result.
 */
export function buildRenderObjects(state: WorldState, tables: GameTables, rng: Rng): { objects: RenderObject[]; outcomes: Map<ObjectId, RandomOutcome> } {
  const outcomes = resolveRandomObjects(state, tables, rng)
  const out: Omit<RenderObject, 'phase'>[] = []
  const ids = [...state.objects.keys()].sort((a, b) => a - b)
  for (const id of ids) {
    if (state.removed.has(id)) continue
    const o = state.objects.get(id) as WorldObject
    if (HIDDEN_CLASSES.has(o.classId)) continue
    const random = outcomes.get(id) ?? null
    const base = { id, x: o.x, y: o.y, z: o.z, owner: o.owner, order: id, random, floating: o.random !== null }
    const hero = state.heroes.get(id)
    if (hero !== undefined || o.classId === OBJECT_CLASS.HERO_PLACEHOLDER) {
      const type = hero?.type ?? random?.heroType
      if (type !== undefined && type !== null) out.push(...heroEntries(base, type, state))
      continue
    }
    const flat = o.template.isOverlay
    const visitable = maskOffsets(o.template.active).length > 0
    let def = (random?.def || o.template.defName).toLowerCase()
    let classId = random?.classId ?? o.classId
    if (classId === OBJECT_CLASS.TOWN) {
      const faction = random?.subclassId ?? o.subclassId
      def = townDef(faction, state, id, def)
      classId = OBJECT_CLASS.TOWN
    }
    out.push({ ...base, kind: 'object', classId, def, group: 0, mirror: false, flat, visitable })
  }

  // Heroes the game generates at players' main towns (not in the object list).
  const used = usedHeroTypes(state)
  for (const r of outcomes.values()) if (r.heroType !== undefined) used.add(r.heroType)
  state.players.forEach((p, player) => {
    const town = p.mainTown
    if (!p.playable || town === null || !town.generateHero) return
    const x = town.x - HERO_VISIT_OFFSET.dx
    const y = town.y - HERO_VISIT_OFFSET.dy
    const occupied = [...state.heroes.values()].some((h) => h.x === x && h.y === y && h.z === town.z)
    if (occupied) return
    const type = pickHeroType(state, rng, used)
    if (type === undefined) return
    used.add(type)
    out.push(...heroEntries({ id: -1 - player, x, y, z: town.z, owner: player, order: Number.MAX_SAFE_INTEGER - 8 + player, random: null, floating: true }, type, state))
  })
  // Per-object animation phase: a body and its hero flag share the phase of their object.
  const withPhase = out.map((o) => ({ ...o, phase: hashInts(state.seed, o.id, o.x, o.y, o.z) % 1024 }))
  return { objects: withPhase, outcomes }
}
