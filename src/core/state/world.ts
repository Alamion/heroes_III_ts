// Version-independent adventure map state (data-model.md "World state"). Built from a parsed
// map; later features change it only through simulation events (constitution VI).

import { NO_OWNER } from '../data/players.ts'
import { OBJECT_CLASS, randomRule } from '../data/object-classes.ts'
import type { RandomRule } from '../data/object-classes.ts'
import type { CreatureStack, H3mMap, HeroArtifacts, ObjectBody, ObjectTemplate } from '../formats/h3m/types.ts'

export type ObjectId = number

export interface WorldObject {
  /** Stable id: the object's index in the map file. */
  readonly id: ObjectId
  readonly x: number
  readonly y: number
  readonly z: number
  readonly template: ObjectTemplate
  readonly classId: number
  readonly subclassId: number
  /** Player 0..7, or null. */
  readonly owner: number | null
  readonly details: ObjectBody
  /** How the game picks the outcome, for random objects. */
  readonly random: RandomRule | null
}

export interface HeroState {
  readonly id: ObjectId
  /** Hero type, or null when random. */
  readonly type: number | null
  readonly owner: number | null
  readonly x: number
  readonly y: number
  readonly z: number
  readonly army: readonly CreatureStack[] | null
  readonly artifacts: HeroArtifacts | null
}

export interface TownState {
  readonly id: ObjectId
  /** Faction (subclass) or 'random'. */
  readonly faction: number | 'random'
  readonly owner: number | null
  readonly hasFort: boolean
  readonly buildings: Uint8Array | null
}

export interface PlayerState {
  readonly playable: boolean
  readonly alive: boolean
  readonly team: number | null
  readonly mainTown: { x: number; y: number; z: number; generateHero: boolean } | null
  /** Bit f set = the player may have faction f (random towns). */
  readonly allowedFactions: number
}

export interface MapIdentity {
  readonly sha256: string
  readonly name: string
  readonly version: string
}

export interface WorldState {
  readonly map: MapIdentity
  readonly size: number
  readonly levels: number
  /** levels × size² × 7-byte tile records (immutable in this feature). */
  readonly terrain: Uint8Array
  readonly objects: ReadonlyMap<ObjectId, WorldObject>
  readonly heroes: ReadonlyMap<ObjectId, HeroState>
  readonly towns: ReadonlyMap<ObjectId, TownState>
  readonly players: readonly PlayerState[]
  readonly day: number
  readonly animationTimeMs: number
  readonly visited: ReadonlySet<ObjectId>
  readonly removed: ReadonlySet<ObjectId>
  readonly seed: number
  /** Bit t set = hero type t may appear (random and generated heroes). */
  readonly allowedHeroes: Uint8Array
  /** Bit a set = artifact a is disabled (AB+); null in RoE maps. */
  readonly bannedArtifacts: Uint8Array | null
}

function ownerOf(body: ObjectBody): number | null {
  let raw: number | undefined
  switch (body.kind) {
    case 'hero':
    case 'town':
    case 'garrison':
    case 'owned':
    case 'randomDwelling':
    case 'heroPlaceholder':
      raw = body.owner
      break
    default:
      raw = undefined
  }
  if (raw === undefined || raw === NO_OWNER || raw === 0xffffffff || raw > 7) return null
  return raw
}

export function fromH3m(map: H3mMap, identity: MapIdentity, seed = 1): WorldState {
  const objects = new Map<ObjectId, WorldObject>()
  const heroes = new Map<ObjectId, HeroState>()
  const towns = new Map<ObjectId, TownState>()
  for (const o of map.objects) {
    const template = map.templates[o.templateIndex] as ObjectTemplate
    const owner = ownerOf(o.body)
    objects.set(o.index, { id: o.index, x: o.x, y: o.y, z: o.z, template, classId: o.classId, subclassId: o.subclassId, owner, details: o.body, random: randomRule(o.classId) ?? null })
    if (o.body.kind === 'hero' && o.classId !== OBJECT_CLASS.PRISON) {
      heroes.set(o.index, { id: o.index, type: o.classId === OBJECT_CLASS.RANDOM_HERO ? null : o.body.type, owner, x: o.x, y: o.y, z: o.z, army: o.body.garrison, artifacts: o.body.artifacts })
    }
    if (o.body.kind === 'town') {
      towns.set(o.index, {
        id: o.index,
        faction: o.classId === OBJECT_CLASS.RANDOM_TOWN ? 'random' : o.subclassId,
        owner,
        hasFort: o.body.buildings.custom ? ((o.body.buildings.built[0] as number) & 0x08) !== 0 : o.body.buildings.hasFort,
        buildings: o.body.buildings.custom ? o.body.buildings.built : null,
      })
    }
  }
  const players: PlayerState[] = map.players.map((p, i) => ({
    playable: p.playable,
    alive: p.playable,
    team: map.teams?.[i] ?? null,
    mainTown: p.mainTown === null ? null : { ...p.mainTown.pos, generateHero: p.mainTown.generateHero },
    allowedFactions: p.allowedFactions,
  }))
  return {
    map: identity,
    size: map.info.size,
    levels: map.info.hasUnderground ? 2 : 1,
    terrain: map.tiles,
    objects,
    heroes,
    towns,
    players,
    day: 1,
    animationTimeMs: 0,
    visited: new Set(),
    removed: new Set(),
    seed,
    allowedHeroes: map.allowedHeroes,
    bannedArtifacts: map.allowedArtifacts,
  }
}
