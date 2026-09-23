// Adventure map object classes of the base game (RoE/AB/SoD), with the H3M body layout each
// class uses and the rule for random classes (research.md §3, §9).

export const OBJECT_CLASS = {
  ALTAR_OF_SACRIFICE: 2,
  ANCHOR_POINT: 3,
  ARENA: 4,
  ARTIFACT: 5,
  PANDORAS_BOX: 6,
  BLACK_MARKET: 7,
  BOAT: 8,
  BORDERGUARD: 9,
  KEYMASTER: 10,
  BUOY: 11,
  CAMPFIRE: 12,
  CARTOGRAPHER: 13,
  SWAN_POND: 14,
  COVER_OF_DARKNESS: 15,
  CREATURE_BANK: 16,
  CREATURE_GENERATOR1: 17,
  CREATURE_GENERATOR2: 18,
  CREATURE_GENERATOR3: 19,
  CREATURE_GENERATOR4: 20,
  CURSED_GROUND1: 21,
  CORPSE: 22,
  MARLETTO_TOWER: 23,
  DERELICT_SHIP: 24,
  DRAGON_UTOPIA: 25,
  EVENT: 26,
  EYE_OF_MAGI: 27,
  FAERIE_RING: 28,
  FLOTSAM: 29,
  FOUNTAIN_OF_FORTUNE: 30,
  FOUNTAIN_OF_YOUTH: 31,
  GARDEN_OF_REVELATION: 32,
  GARRISON: 33,
  HERO: 34,
  HILL_FORT: 35,
  GRAIL: 36,
  HUT_OF_MAGI: 37,
  IDOL_OF_FORTUNE: 38,
  LEAN_TO: 39,
  LIBRARY_OF_ENLIGHTENMENT: 41,
  LIGHTHOUSE: 42,
  MONOLITH_ONE_WAY_ENTRANCE: 43,
  MONOLITH_ONE_WAY_EXIT: 44,
  MONOLITH_TWO_WAY: 45,
  MAGIC_PLAINS1: 46,
  SCHOOL_OF_MAGIC: 47,
  MAGIC_SPRING: 48,
  MAGIC_WELL: 49,
  MARKET_OF_TIME: 50,
  MERCENARY_CAMP: 51,
  MERMAID: 52,
  MINE: 53,
  MONSTER: 54,
  MYSTICAL_GARDEN: 55,
  OASIS: 56,
  OBELISK: 57,
  REDWOOD_OBSERVATORY: 58,
  OCEAN_BOTTLE: 59,
  PILLAR_OF_FIRE: 60,
  STAR_AXIS: 61,
  PRISON: 62,
  PYRAMID: 63,
  RALLY_FLAG: 64,
  RANDOM_ART: 65,
  RANDOM_TREASURE_ART: 66,
  RANDOM_MINOR_ART: 67,
  RANDOM_MAJOR_ART: 68,
  RANDOM_RELIC_ART: 69,
  RANDOM_HERO: 70,
  RANDOM_MONSTER: 71,
  RANDOM_MONSTER_L1: 72,
  RANDOM_MONSTER_L2: 73,
  RANDOM_MONSTER_L3: 74,
  RANDOM_MONSTER_L4: 75,
  RANDOM_RESOURCE: 76,
  RANDOM_TOWN: 77,
  REFUGEE_CAMP: 78,
  RESOURCE: 79,
  SANCTUARY: 80,
  SCHOLAR: 81,
  SEA_CHEST: 82,
  SEER_HUT: 83,
  CRYPT: 84,
  SHIPWRECK: 85,
  SHIPWRECK_SURVIVOR: 86,
  SHIPYARD: 87,
  SHRINE_OF_MAGIC_INCANTATION: 88,
  SHRINE_OF_MAGIC_GESTURE: 89,
  SHRINE_OF_MAGIC_THOUGHT: 90,
  SIGN: 91,
  SIRENS: 92,
  SPELL_SCROLL: 93,
  STABLES: 94,
  TAVERN: 95,
  TEMPLE: 96,
  DEN_OF_THIEVES: 97,
  TOWN: 98,
  TRADING_POST: 99,
  LEARNING_STONE: 100,
  TREASURE_CHEST: 101,
  TREE_OF_KNOWLEDGE: 102,
  SUBTERRANEAN_GATE: 103,
  UNIVERSITY: 104,
  WAGON: 105,
  WAR_MACHINE_FACTORY: 106,
  SCHOOL_OF_WAR: 107,
  WARRIORS_TOMB: 108,
  WATER_WHEEL: 109,
  WATERING_HOLE: 110,
  WHIRLPOOL: 111,
  WINDMILL: 112,
  WITCH_HUT: 113,
  HOLE: 124,
  RANDOM_MONSTER_L5: 162,
  RANDOM_MONSTER_L6: 163,
  RANDOM_MONSTER_L7: 164,
  BORDER_GATE: 212,
  FREELANCERS_GUILD: 213,
  HERO_PLACEHOLDER: 214,
  QUEST_GUARD: 215,
  RANDOM_DWELLING: 216,
  RANDOM_DWELLING_LVL: 217,
  RANDOM_DWELLING_FACTION: 218,
  GARRISON2: 219,
  ABANDONED_MINE: 220,
  TRADING_POST_SNOW: 221,
  CLOVER_FIELD: 222,
  CURSED_GROUND2: 223,
  EVIL_FOG: 224,
  FAVORABLE_WINDS: 225,
  FIERY_FIELDS: 226,
  HOLY_GROUNDS: 227,
  LUCID_POOLS: 228,
  MAGIC_CLOUDS: 229,
  MAGIC_PLAINS2: 230,
  ROCKLANDS: 231,
} as const

/** H3M body layout families (data-model.md ObjectBody). */
export type BodyFamily =
  | 'none'
  | 'event'
  | 'hero'
  | 'monster'
  | 'message'
  | 'seerHut'
  | 'witchHut'
  | 'scholar'
  | 'garrison'
  | 'artifact'
  | 'spellScroll'
  | 'resource'
  | 'town'
  | 'owned'
  | 'shrine'
  | 'pandora'
  | 'grail'
  | 'randomDwelling'
  | 'randomDwellingLevel'
  | 'randomDwellingFaction'
  | 'questGuard'
  | 'heroPlaceholder'

const C = OBJECT_CLASS

const BODY_BY_CLASS: ReadonlyMap<number, BodyFamily> = new Map<number, BodyFamily>([
  [C.EVENT, 'event'],
  [C.HERO, 'hero'],
  [C.RANDOM_HERO, 'hero'],
  [C.PRISON, 'hero'],
  [C.MONSTER, 'monster'],
  [C.RANDOM_MONSTER, 'monster'],
  [C.RANDOM_MONSTER_L1, 'monster'],
  [C.RANDOM_MONSTER_L2, 'monster'],
  [C.RANDOM_MONSTER_L3, 'monster'],
  [C.RANDOM_MONSTER_L4, 'monster'],
  [C.RANDOM_MONSTER_L5, 'monster'],
  [C.RANDOM_MONSTER_L6, 'monster'],
  [C.RANDOM_MONSTER_L7, 'monster'],
  [C.OCEAN_BOTTLE, 'message'],
  [C.SIGN, 'message'],
  [C.SEER_HUT, 'seerHut'],
  [C.WITCH_HUT, 'witchHut'],
  [C.SCHOLAR, 'scholar'],
  [C.GARRISON, 'garrison'],
  [C.GARRISON2, 'garrison'],
  [C.ARTIFACT, 'artifact'],
  [C.RANDOM_ART, 'artifact'],
  [C.RANDOM_TREASURE_ART, 'artifact'],
  [C.RANDOM_MINOR_ART, 'artifact'],
  [C.RANDOM_MAJOR_ART, 'artifact'],
  [C.RANDOM_RELIC_ART, 'artifact'],
  [C.SPELL_SCROLL, 'spellScroll'],
  [C.RESOURCE, 'resource'],
  [C.RANDOM_RESOURCE, 'resource'],
  [C.TOWN, 'town'],
  [C.RANDOM_TOWN, 'town'],
  [C.MINE, 'owned'],
  [C.ABANDONED_MINE, 'owned'],
  [C.CREATURE_GENERATOR1, 'owned'],
  [C.CREATURE_GENERATOR2, 'owned'],
  [C.CREATURE_GENERATOR3, 'owned'],
  [C.CREATURE_GENERATOR4, 'owned'],
  [C.SHIPYARD, 'owned'],
  [C.LIGHTHOUSE, 'owned'],
  [C.SHRINE_OF_MAGIC_INCANTATION, 'shrine'],
  [C.SHRINE_OF_MAGIC_GESTURE, 'shrine'],
  [C.SHRINE_OF_MAGIC_THOUGHT, 'shrine'],
  [C.PANDORAS_BOX, 'pandora'],
  [C.GRAIL, 'grail'],
  [C.RANDOM_DWELLING, 'randomDwelling'],
  [C.RANDOM_DWELLING_LVL, 'randomDwellingLevel'],
  [C.RANDOM_DWELLING_FACTION, 'randomDwellingFaction'],
  [C.QUEST_GUARD, 'questGuard'],
  [C.HERO_PLACEHOLDER, 'heroPlaceholder'],
])

/** Highest class id used by the base game. */
export const MAX_BASE_CLASS_ID = 231

/**
 * Class ids that exist in RoE/AB/SoD maps. Ids without a named constant (40, 114–161 except
 * 124, 165–211) are decorations and obstacles with no body.
 */
export function isKnownClass(classId: number): boolean {
  return Number.isInteger(classId) && classId >= 1 && classId <= MAX_BASE_CLASS_ID
}

/** Body layout of a known class; `undefined` for classes outside the base game. */
export function bodyFamily(classId: number): BodyFamily | undefined {
  if (!isKnownClass(classId)) return undefined
  return BODY_BY_CLASS.get(classId) ?? 'none'
}

const NAME_BY_ID: ReadonlyMap<number, string> = new Map(
  Object.entries(OBJECT_CLASS).map(([name, id]) => [id, name.toLowerCase()]),
)

export function className(classId: number): string {
  return NAME_BY_ID.get(classId) ?? (isKnownClass(classId) ? 'decoration' : 'unknown')
}

/** How the outcome of a random object is chosen (research.md §9). */
export type RandomRule =
  | { kind: 'artifact' }
  | { kind: 'monster'; level: number | 'any' }
  | { kind: 'resource' }
  | { kind: 'town' }
  | { kind: 'hero' }
  | { kind: 'dwelling'; factionFrom: 'body'; levelFrom: 'body' }
  | { kind: 'dwelling'; factionFrom: 'body'; levelFrom: 'subclass' }
  | { kind: 'dwelling'; factionFrom: 'subclass'; levelFrom: 'body' }

const RANDOM_RULES: ReadonlyMap<number, RandomRule> = new Map<number, RandomRule>([
  [C.RANDOM_ART, { kind: 'artifact' }],
  [C.RANDOM_TREASURE_ART, { kind: 'artifact' }],
  [C.RANDOM_MINOR_ART, { kind: 'artifact' }],
  [C.RANDOM_MAJOR_ART, { kind: 'artifact' }],
  [C.RANDOM_RELIC_ART, { kind: 'artifact' }],
  [C.RANDOM_HERO, { kind: 'hero' }],
  [C.HERO_PLACEHOLDER, { kind: 'hero' }],
  [C.RANDOM_MONSTER, { kind: 'monster', level: 'any' }],
  [C.RANDOM_MONSTER_L1, { kind: 'monster', level: 1 }],
  [C.RANDOM_MONSTER_L2, { kind: 'monster', level: 2 }],
  [C.RANDOM_MONSTER_L3, { kind: 'monster', level: 3 }],
  [C.RANDOM_MONSTER_L4, { kind: 'monster', level: 4 }],
  [C.RANDOM_MONSTER_L5, { kind: 'monster', level: 5 }],
  [C.RANDOM_MONSTER_L6, { kind: 'monster', level: 6 }],
  [C.RANDOM_MONSTER_L7, { kind: 'monster', level: 7 }],
  [C.RANDOM_RESOURCE, { kind: 'resource' }],
  [C.RANDOM_TOWN, { kind: 'town' }],
  [C.RANDOM_DWELLING, { kind: 'dwelling', factionFrom: 'body', levelFrom: 'body' }],
  [C.RANDOM_DWELLING_LVL, { kind: 'dwelling', factionFrom: 'body', levelFrom: 'subclass' }],
  [C.RANDOM_DWELLING_FACTION, { kind: 'dwelling', factionFrom: 'subclass', levelFrom: 'body' }],
])

export function randomRule(classId: number): RandomRule | undefined {
  return RANDOM_RULES.get(classId)
}

/** Number of towns (factions) in SoD: Castle … Conflux. */
/** Base-game factions: Castle … Conflux. Random towns roll only among these. */
export const FACTION_COUNT = 9

/**
 * HotA adds Cove (9), Factory (10) and a twelfth town (11, sprite stem `bul`). The twelfth is not
 * playable in 1.8.1, but its five adventure sprites ship in `HotA.lod`, the editor places it and
 * the game draws it — `test_map_hota.h3m` has all five of its forms, and a capture of them
 * matched sprite for sprite (spec 005 research "Town forms measured against the game").
 * The map header agrees: sub-version 10 reports 12 town types.
 */
export const HOTA_FACTION_COUNT = 12

/**
 * Adventure-map hero sprites, one per hero class. Heroes are not listed in Objects.txt; these are
 * the sprites the game draws for heroes on the map (research.md §9).
 */
export const HERO_MAP_DEFS: readonly string[] = Array.from({ length: 24 }, (_, i) => `ah${String(i).padStart(2, '0')}_.def`)

/** Adventure-map hero flag sprites, one per player colour. */
export const HERO_FLAG_DEFS: readonly string[] = Array.from({ length: 8 }, (_, i) => `af0${i}.def`)

/**
 * Tile a hero stands on relative to its object anchor: hero templates in maps have their visitable
 * bit one tile left of the anchor (active mask byte 5, bit 6).
 */
export const HERO_VISIT_OFFSET = { dx: -1, dy: 0 } as const

/** Classes the game never draws on the adventure map (research.md §5). */
export const HIDDEN_CLASSES: ReadonlySet<number> = new Set([C.EVENT, C.GRAIL])

export interface TownSprites {
  /** Town without a fort. */
  readonly village: string
  /** HotA only: fort built (`…f0`). The base game has no separate sprite for this. */
  readonly fort: string | null
  /** HotA only: citadel built (`…c0`). */
  readonly citadel: string | null
  /** Castle (`…x0`) — the only fortified form the base game's Objects.txt declares. */
  readonly castle: string
  /** Capitol built (`…z0`). */
  readonly capitol: string
}

/**
 * Adventure-map town sprites per faction, lower-case DEF names.
 *
 * Base game (factions 0–8, Castle … Conflux): only `village`, `castle` and `capitol` are ever
 * chosen, because its `Objects.txt` declares the `x0` template alone (spec 005 research M7); the
 * `fort` and `citadel` forms are HotA repaints of the same nine factions and are selected only for
 * HotA maps. Cove (9) and Factory (10) are HotA-only.
 *
 * The stems are irregular, so no naming formula works: Fortress mixes `for`/`ftr`, and Conflux
 * truncates to eight characters with no trailing zero.
 */
export const TOWN_SPRITES: readonly TownSprites[] = [
  { village: 'avccast0.def', fort: 'avccasf0.def', citadel: 'avccasc0.def', castle: 'avccasx0.def', capitol: 'avccasz0.def' },
  { village: 'avcramp0.def', fort: 'avcramf0.def', citadel: 'avcramc0.def', castle: 'avcramx0.def', capitol: 'avcramz0.def' },
  { village: 'avctowr0.def', fort: 'avctowf0.def', citadel: 'avctowc0.def', castle: 'avctowx0.def', capitol: 'avctowz0.def' },
  { village: 'avcinft0.def', fort: 'avcinff0.def', citadel: 'avcinfc0.def', castle: 'avcinfx0.def', capitol: 'avcinfz0.def' },
  { village: 'avcnecr0.def', fort: 'avcnecf0.def', citadel: 'avcnecc0.def', castle: 'avcnecx0.def', capitol: 'avcnecz0.def' },
  { village: 'avcdung0.def', fort: 'avcdunf0.def', citadel: 'avcdunc0.def', castle: 'avcdunx0.def', capitol: 'avcdunz0.def' },
  { village: 'avcstro0.def', fort: 'avcstrf0.def', citadel: 'avcstrc0.def', castle: 'avcstrx0.def', capitol: 'avcstrz0.def' },
  { village: 'avcftrt0.def', fort: 'avcforf0.def', citadel: 'avcforc0.def', castle: 'avcftrx0.def', capitol: 'avcforz0.def' },
  { village: 'avchfor0.def', fort: 'avchfof0.def', citadel: 'avchfoc0.def', castle: 'avchforx.def', capitol: 'avchforz.def' },
  { village: 'avccove0.def', fort: 'avccovf0.def', citadel: 'avccovc0.def', castle: 'avccovx0.def', capitol: 'avccovz0.def' },
  { village: 'avcface0.def', fort: 'avcfacf0.def', citadel: 'avcfacc0.def', castle: 'avcfacx0.def', capitol: 'avcfacz0.def' },
  { village: 'avcbule0.def', fort: 'avcbulf0.def', citadel: 'avcbulc0.def', castle: 'avcbulx0.def', capitol: 'avcbulz0.def' },
]

/** Random town (class 77), same five forms. */
export const RANDOM_TOWN_SPRITES: TownSprites = {
  village: 'avcrand0.def',
  fort: 'avcranf0.def',
  citadel: 'avcranc0.def',
  castle: 'avcranx0.def',
  capitol: 'avcranz0.def',
}

