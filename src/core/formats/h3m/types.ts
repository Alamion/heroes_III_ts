// Parsed H3M map (data-model.md H3mMap). Field layouts ported from homm3-parser (MIT) and
// verified against the base-game map corpus; see THIRD_PARTY_NOTICES.md.

import type { H3String } from '../../util/byte-reader.ts'

export type H3mVersion = 'RoE' | 'AB' | 'SoD'

export const H3M_VERSION_CODES: Record<H3mVersion, number> = { RoE: 0x0e, AB: 0x15, SoD: 0x1c }

export interface Pos {
  x: number
  y: number
  z: number
}

export interface H3mInfo {
  hasHero: boolean
  size: number
  hasUnderground: boolean
  name: H3String
  description: H3String
  difficulty: number
  /** AB+: hero level cap (0 = none). */
  levelCap: number | null
}

export interface PlayerMainTown {
  /** AB+: whether the game generates a hero at this town; always true in RoE. */
  generateHero: boolean
  /** AB+: unused byte kept for exactness (VCMI: "type"). */
  townType: number | null
  pos: Pos
}

export interface NamedHero {
  type: number
  name: H3String
}

export interface PlayerInfo {
  canHuman: boolean
  canComputer: boolean
  /** Absent for slots nobody can play (their block is fixed-size padding). */
  playable: boolean
  behavior: number
  /** SoD: unknown byte after behavior (allowed alignments). */
  sodAlignments: number | null
  /** Bitmask of allowed factions (bit 8 = Conflux, AB+). */
  allowedFactions: number
  randomFaction: boolean
  mainTown: PlayerMainTown | null
  randomHero: boolean
  /** 0xFF = none. */
  mainHeroType: number
  mainHeroPortrait: number | null
  mainHeroName: H3String | null
  /** AB+: unknown byte before the hero list. */
  abUnknown: number | null
  heroes: NamedHero[]
  /** Raw fixed-size block of an unplayable slot (kept for exactness), else null. */
  unusedBlock: Uint8Array | null
}

export type VictoryCondition =
  | { kind: 'none' }
  | ({ allowNormal: boolean; appliesToAi: boolean } & (
      | { kind: 'acquireArtifact'; artifact: number }
      | { kind: 'accumulateCreatures'; creature: number; amount: number }
      | { kind: 'accumulateResources'; resource: number; amount: number }
      | { kind: 'upgradeTown'; pos: Pos; hallLevel: number; castleLevel: number }
      | { kind: 'buildGrail'; pos: Pos }
      | { kind: 'defeatHero'; pos: Pos }
      | { kind: 'captureTown'; pos: Pos }
      | { kind: 'defeatMonster'; pos: Pos }
      | { kind: 'flagDwellings' }
      | { kind: 'flagMines' }
      | { kind: 'transportArtifact'; artifact: number; pos: Pos }
    ))

export type LossCondition =
  | { kind: 'none' }
  | { kind: 'loseTown'; pos: Pos }
  | { kind: 'loseHero'; pos: Pos }
  | { kind: 'timeExpires'; days: number }

export interface CustomHero {
  type: number
  portrait: number
  name: H3String
  players: number
}

export interface SecondarySkill {
  skill: number
  level: number
}

export interface PrimarySkills {
  attack: number
  defense: number
  spellPower: number
  knowledge: number
}

export interface HeroArtifacts {
  /** 18 (RoE/AB) or 19 (SoD) worn slots; 0xFF / 0xFFFF = empty. */
  worn: number[]
  backpack: number[]
}

export interface HeroSettings {
  experience: number | null
  secondarySkills: SecondarySkill[] | null
  artifacts: HeroArtifacts | null
  biography: H3String | null
  gender: number
  spells: Uint8Array | null
  primarySkills: PrimarySkills | null
}

export interface Rumor {
  name: H3String
  text: H3String
}

export interface MapTile {
  terrain: number
  terrainView: number
  river: number
  riverView: number
  road: number
  roadView: number
  flags: number
}

export interface ObjectTemplate {
  defName: string
  /**
   * 6 bytes, 6 rows × 8 columns: byte 0 is the top row (y − 5), byte 5 the object's row; bit 7 is
   * the object's column (x), bit 0 is x − 7. Bit set = passable.
   */
  passable: Uint8Array
  /** Same layout; bit set = visitable. */
  active: Uint8Array
  allowedTerrains: number
  editorGroups: number
  classId: number
  subclassId: number
  group: number
  isOverlay: boolean
}

export interface CreatureStack {
  /** 0xFF (RoE) / 0xFFFF (AB+) = empty slot. */
  creature: number
  count: number
}

export interface Guard {
  message: H3String
  creatures: CreatureStack[] | null
}

export interface Reward {
  experience: number
  spellPoints: number
  morale: number
  luck: number
  resources: number[]
  primarySkills: PrimarySkills
  secondarySkills: SecondarySkill[]
  artifacts: number[]
  spells: number[]
  creatures: CreatureStack[]
}

export type Quest =
  | { kind: 'none' }
  | ({ deadline: number; proposal: H3String; progress: H3String; completion: H3String } & (
      | { kind: 'experienceLevel'; value: number }
      | { kind: 'primarySkills'; skills: PrimarySkills }
      | { kind: 'defeatHero'; targetId: number }
      | { kind: 'defeatMonster'; targetId: number }
      | { kind: 'artifacts'; artifacts: number[] }
      | { kind: 'creatures'; creatures: CreatureStack[] }
      | { kind: 'resources'; resources: number[] }
      | { kind: 'beHero'; hero: number }
      | { kind: 'bePlayer'; player: number }
    ))

export type SeerReward =
  | { kind: 'none' }
  | { kind: 'experience'; value: number }
  | { kind: 'spellPoints'; value: number }
  | { kind: 'morale'; value: number }
  | { kind: 'luck'; value: number }
  | { kind: 'resource'; resource: number; amount: number }
  | { kind: 'primarySkill'; skill: number; value: number }
  | { kind: 'secondarySkill'; skill: number; level: number }
  | { kind: 'artifact'; artifact: number }
  | { kind: 'spell'; spell: number }
  | { kind: 'creature'; creature: number; count: number }

export interface TimedEvent {
  name: H3String
  message: H3String
  resources: number[]
  players: number
  humanAffected: boolean
  computerAffected: boolean
  firstDay: number
  repeatEvery: number
}

export interface TownEvent extends TimedEvent {
  buildings: Uint8Array
  creatures: number[]
}

export interface HeroBody {
  kind: 'hero'
  identifier: number | null
  owner: number
  type: number
  name: H3String | null
  experience: number | null
  portrait: number | null
  secondarySkills: SecondarySkill[] | null
  garrison: CreatureStack[] | null
  formation: number
  artifacts: HeroArtifacts | null
  patrolRadius: number
  biography: H3String | null
  gender: number | null
  /** AB: single spell byte; SoD: 9-byte mask when customized. */
  abSpell: number | null
  spells: Uint8Array | null
  primarySkills: PrimarySkills | null
}

export type ObjectBody =
  | { kind: 'none' }
  | HeroBody
  | {
      kind: 'monster'
      identifier: number | null
      count: number
      disposition: number
      message: H3String | null
      resources: number[] | null
      artifact: number | null
      neverFlees: boolean
      noGrowth: boolean
    }
  | { kind: 'message'; text: H3String }
  | { kind: 'seerHut'; quest: Quest; reward: SeerReward }
  | { kind: 'witchHut'; allowedSkills: number | null }
  | { kind: 'scholar'; bonusType: number; bonusId: number }
  | { kind: 'garrison'; owner: number; creatures: CreatureStack[]; removableUnits: boolean | null }
  | { kind: 'artifact'; guard: Guard | null }
  | { kind: 'spellScroll'; guard: Guard | null; spell: number }
  | { kind: 'resource'; guard: Guard | null; amount: number }
  | {
      kind: 'town'
      identifier: number | null
      owner: number
      name: H3String | null
      garrison: CreatureStack[] | null
      formation: number
      buildings: { custom: true; built: Uint8Array; forbidden: Uint8Array } | { custom: false; hasFort: boolean }
      spellsMustHave: Uint8Array | null
      spellsMayHave: Uint8Array
      events: TownEvent[]
      alignment: number | null
    }
  | { kind: 'owned'; owner: number }
  | { kind: 'shrine'; spell: number }
  | { kind: 'pandora'; guard: Guard | null; reward: Reward }
  | { kind: 'event'; guard: Guard | null; reward: Reward; players: number; computerActivate: boolean; removeAfterVisit: boolean }
  | { kind: 'grail'; radius: number }
  | { kind: 'randomDwelling'; owner: number; linkedTown: number | null; factions: number | null; minLevel: number | null; maxLevel: number | null }
  | { kind: 'questGuard'; quest: Quest }
  | { kind: 'heroPlaceholder'; owner: number; heroType: number; powerRank: number | null }

export interface MapObject {
  index: number
  x: number
  y: number
  z: number
  templateIndex: number
  classId: number
  subclassId: number
  /** Offset of the object record in the decompressed map. */
  offset: number
  body: ObjectBody
}

export interface H3mMap {
  fileName: string
  version: H3mVersion
  versionCode: number
  info: H3mInfo
  players: PlayerInfo[]
  victory: VictoryCondition
  loss: LossCondition
  teams: number[] | null
  allowedHeroes: Uint8Array
  placeholderHeroIds: number[]
  customHeroes: CustomHero[]
  allowedArtifacts: Uint8Array | null
  allowedSpells: Uint8Array | null
  allowedSkills: Uint8Array | null
  rumors: Rumor[]
  heroSettings: (HeroSettings | null)[] | null
  /** levels × size² × 7 bytes. */
  tiles: Uint8Array
  templates: ObjectTemplate[]
  objects: MapObject[]
  events: TimedEvent[]
  /** Zero bytes after the global events. */
  trailerLength: number
  /** Size of the decompressed map data. */
  byteLength: number
}

export const TILE_RECORD_SIZE = 7

export function tileIndex(size: number, x: number, y: number, z: number): number {
  return (z * size * size + y * size + x) * TILE_RECORD_SIZE
}

export function readTile(tiles: Uint8Array, size: number, x: number, y: number, z: number): MapTile {
  const i = tileIndex(size, x, y, z)
  return {
    terrain: tiles[i] as number,
    terrainView: tiles[i + 1] as number,
    river: tiles[i + 2] as number,
    riverView: tiles[i + 3] as number,
    road: tiles[i + 4] as number,
    roadView: tiles[i + 5] as number,
    flags: tiles[i + 6] as number,
  }
}

/** Tile offsets (dx ≤ 0, dy ≤ 0) of set bits in a 6-byte template mask. */
export function maskOffsets(mask: Uint8Array): { dx: number; dy: number }[] {
  const out: { dx: number; dy: number }[] = []
  for (let row = 0; row < 6; row++) {
    const byte = mask[row] as number
    for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) out.push({ dx: bit - 7, dy: row - 5 })
  }
  return out
}
