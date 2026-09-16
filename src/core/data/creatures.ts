// Creatures of the base game (RoE/AB/SoD) by id: faction and level. Used to resolve random monsters
// and dwellings (specs/003-map-objects/research.md §6). Facts only; names are not stored.

export interface CreatureInfo {
  /** Town 0–8 (Castle … Conflux) or 'neutral'. */
  readonly faction: number | 'neutral'
  /** Dwelling level 1–7. */
  readonly level: number
  readonly upgraded: boolean
}

/** Ids 0–111: eight towns × 7 levels × (basic, upgraded), in town order. */
const TOWN_CREATURES = 112

/** Conflux and neutral creatures 112–144 (ids 122, 124, 126, 128 are unused placeholders). */
const EXTRA: ReadonlyMap<number, CreatureInfo> = new Map<number, CreatureInfo>([
  [112, { faction: 8, level: 2, upgraded: false }], // air elemental
  [113, { faction: 8, level: 5, upgraded: false }], // earth elemental
  [114, { faction: 8, level: 4, upgraded: false }], // fire elemental
  [115, { faction: 8, level: 3, upgraded: false }], // water elemental
  [116, { faction: 'neutral', level: 5, upgraded: false }], // gold golem
  [117, { faction: 'neutral', level: 6, upgraded: false }], // diamond golem
  [118, { faction: 8, level: 1, upgraded: false }], // pixie
  [119, { faction: 8, level: 1, upgraded: true }], // sprite
  [120, { faction: 8, level: 6, upgraded: false }], // psychic elemental
  [121, { faction: 8, level: 6, upgraded: true }], // magic elemental
  [123, { faction: 8, level: 3, upgraded: true }], // ice elemental
  [125, { faction: 8, level: 5, upgraded: true }], // magma elemental
  [127, { faction: 8, level: 2, upgraded: true }], // storm elemental
  [129, { faction: 8, level: 4, upgraded: true }], // energy elemental
  [130, { faction: 8, level: 7, upgraded: false }], // firebird
  [131, { faction: 8, level: 7, upgraded: true }], // phoenix
  [132, { faction: 'neutral', level: 7, upgraded: false }], // azure dragon
  [133, { faction: 'neutral', level: 7, upgraded: false }], // crystal dragon
  [134, { faction: 'neutral', level: 7, upgraded: false }], // faerie dragon
  [135, { faction: 'neutral', level: 7, upgraded: false }], // rust dragon
  [136, { faction: 'neutral', level: 6, upgraded: false }], // enchanter
  [137, { faction: 'neutral', level: 4, upgraded: false }], // sharpshooter
  [138, { faction: 'neutral', level: 1, upgraded: false }], // halfling
  [139, { faction: 'neutral', level: 1, upgraded: false }], // peasant
  [140, { faction: 'neutral', level: 2, upgraded: false }], // boar
  [141, { faction: 'neutral', level: 3, upgraded: false }], // mummy
  [142, { faction: 'neutral', level: 3, upgraded: false }], // nomad
  [143, { faction: 'neutral', level: 2, upgraded: false }], // rogue
  [144, { faction: 'neutral', level: 5, upgraded: false }], // troll
])

export const MAX_CREATURE_ID = 144

/** Creature info, or undefined for unused ids and ids outside the base game. */
export function creatureInfo(id: number): CreatureInfo | undefined {
  if (!Number.isInteger(id) || id < 0) return undefined
  if (id < TOWN_CREATURES) return { faction: Math.floor(id / 14), level: Math.floor((id % 14) / 2) + 1, upgraded: id % 2 === 1 }
  return EXTRA.get(id)
}

/** All creature ids of a level (1–7), ascending. */
export function creaturesOfLevel(level: number): number[] {
  const out: number[] = []
  for (let id = 0; id <= MAX_CREATURE_ID; id++) if (creatureInfo(id)?.level === level) out.push(id)
  return out
}
