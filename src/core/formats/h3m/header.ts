// H3M sections before the tiles: map info, players, victory/loss conditions, teams, allowed
// heroes/artifacts/spells/skills, rumors and SoD hero settings.

import type { H3mContext } from './context.ts'
import { readArtifactId, readCreatureId, readHeroArtifacts, readPrimarySkills, readSecondarySkillsU32, readSpellMask } from './objects/common.ts'
import type {
  CustomHero,
  H3mInfo,
  HeroSettings,
  LossCondition,
  PlayerInfo,
  Pos,
  Rumor,
  VictoryCondition,
} from './types.ts'

const MAX_MAP_SIZE = 252

export function readPos(c: H3mContext): Pos {
  return { x: c.r.u8(), y: c.r.u8(), z: c.r.u8() }
}

export function readInfo(c: H3mContext): H3mInfo {
  return c.r.scope('info', () => {
    const hasHero = c.r.bool()
    const sizeAt = c.r.offset
    const size = c.r.u32()
    if (size < 1 || size > MAX_MAP_SIZE) c.r.invalid(`map size ${size} outside 1..${MAX_MAP_SIZE}`, sizeAt)
    const hasUnderground = c.r.bool()
    const name = c.r.string()
    const description = c.r.string()
    const difficulty = c.r.u8()
    const levelCap = c.ab ? c.r.u8() : null
    return { hasHero, size, hasUnderground, name, description, difficulty, levelCap }
  })
}

function readPlayer(c: H3mContext, index: number): PlayerInfo {
  return c.r.scope(`players[${index}]`, () => {
    const canHuman = c.r.bool()
    const canComputer = c.r.bool()
    const base: PlayerInfo = {
      canHuman,
      canComputer,
      playable: canHuman || canComputer,
      behavior: 0,
      sodAlignments: null,
      allowedFactions: 0,
      randomFaction: false,
      mainTown: null,
      randomHero: false,
      mainHeroType: 0xff,
      mainHeroPortrait: null,
      mainHeroName: null,
      abUnknown: null,
      heroes: [],
      unusedBlock: null,
    }
    if (!base.playable) {
      // Slots nobody can play store a fixed-size unused block (6 / 12 / 13 bytes).
      base.unusedBlock = c.r.bytesCopy(c.sod ? 13 : c.ab ? 12 : 6)
      return base
    }
    base.behavior = c.r.u8()
    base.sodAlignments = c.sod ? c.r.u8() : null
    base.allowedFactions = c.ab ? c.r.u16() : c.r.u8()
    base.randomFaction = c.r.bool()
    if (c.r.bool()) {
      c.r.scope('mainTown', () => {
        const generateHero = c.ab ? c.r.bool() : true
        const townType = c.ab ? c.r.u8() : null
        base.mainTown = { generateHero, townType, pos: readPos(c) }
      })
    }
    base.randomHero = c.r.bool()
    base.mainHeroType = c.r.u8()
    if (base.mainHeroType !== 0xff) {
      base.mainHeroPortrait = c.r.u8()
      base.mainHeroName = c.r.string()
    }
    if (c.ab) {
      base.abUnknown = c.r.u8()
      const at = c.r.offset
      const count = c.r.u32()
      if (count > 255) c.r.invalid(`player hero count ${count} exceeds 255`, at)
      base.heroes = c.r.scope('heroes', () => Array.from({ length: count }, () => ({ type: c.r.u8(), name: c.r.string() })))
    }
    return base
  })
}

export function readPlayers(c: H3mContext): PlayerInfo[] {
  return Array.from({ length: 8 }, (_, i) => readPlayer(c, i))
}

export function readVictory(c: H3mContext): VictoryCondition {
  return c.r.scope('victory', () => {
    const at = c.r.offset
    const type = c.r.u8()
    if (type === 0xff) return { kind: 'none' }
    const allowNormal = c.r.bool()
    const appliesToAi = c.r.bool()
    const common = { allowNormal, appliesToAi }
    switch (type) {
      case 0:
        return { ...common, kind: 'acquireArtifact', artifact: readArtifactId(c) }
      case 1:
        return { ...common, kind: 'accumulateCreatures', creature: readCreatureId(c), amount: c.r.u32() }
      case 2:
        return { ...common, kind: 'accumulateResources', resource: c.r.u8(), amount: c.r.u32() }
      case 3:
        return { ...common, kind: 'upgradeTown', pos: readPos(c), hallLevel: c.r.u8(), castleLevel: c.r.u8() }
      case 4:
        return { ...common, kind: 'buildGrail', pos: readPos(c) }
      case 5:
        return { ...common, kind: 'defeatHero', pos: readPos(c) }
      case 6:
        return { ...common, kind: 'captureTown', pos: readPos(c) }
      case 7:
        return { ...common, kind: 'defeatMonster', pos: readPos(c) }
      case 8:
        return { ...common, kind: 'flagDwellings' }
      case 9:
        return { ...common, kind: 'flagMines' }
      case 10:
        return { ...common, kind: 'transportArtifact', artifact: c.r.u8(), pos: readPos(c) }
      default:
        return c.r.invalid(`unknown victory condition ${type}`, at)
    }
  })
}

export function readLoss(c: H3mContext): LossCondition {
  return c.r.scope('loss', () => {
    const at = c.r.offset
    const type = c.r.u8()
    switch (type) {
      case 0xff:
        return { kind: 'none' }
      case 0:
        return { kind: 'loseTown', pos: readPos(c) }
      case 1:
        return { kind: 'loseHero', pos: readPos(c) }
      case 2:
        return { kind: 'timeExpires', days: c.r.u16() }
      default:
        return c.r.invalid(`unknown loss condition ${type}`, at)
    }
  })
}

export function readTeams(c: H3mContext): number[] | null {
  return c.r.scope('teams', () => {
    const count = c.r.u8()
    if (count === 0) return null
    return Array.from({ length: 8 }, () => c.r.u8())
  })
}

export function readHeroSettings(c: H3mContext): HeroSettings {
  const experience = c.r.bool() ? c.r.u32() : null
  const secondarySkills = c.r.bool() ? readSecondarySkillsU32(c) : null
  const artifacts = c.r.bool() ? readHeroArtifacts(c) : null
  const biography = c.r.bool() ? c.r.string() : null
  const gender = c.r.u8()
  const spells = c.r.bool() ? readSpellMask(c) : null
  const primarySkills = c.r.bool() ? readPrimarySkills(c) : null
  return { experience, secondarySkills, artifacts, biography, gender, spells, primarySkills }
}

export interface HeaderRest {
  teams: number[] | null
  allowedHeroes: Uint8Array
  placeholderHeroIds: number[]
  customHeroes: CustomHero[]
  allowedArtifacts: Uint8Array | null
  allowedSpells: Uint8Array | null
  allowedSkills: Uint8Array | null
  rumors: Rumor[]
  heroSettings: (HeroSettings | null)[] | null
}

/** Everything between the loss condition and the tiles. */
export function readHeaderRest(c: H3mContext): HeaderRest {
  const teams = readTeams(c)
  const allowedHeroes = c.r.scope('allowedHeroes', () => c.r.bytesCopy(c.ab ? 20 : 16))
  const placeholderHeroIds = c.ab
    ? c.r.scope('placeholderHeroes', () => {
        const at = c.r.offset
        const count = c.r.u32()
        if (count > 256) c.r.invalid(`placeholder hero count ${count} exceeds 256`, at)
        return Array.from({ length: count }, () => c.r.u8())
      })
    : []
  const customHeroes: CustomHero[] = c.sod
    ? c.r.scope('customHeroes', () => Array.from({ length: c.r.u8() }, () => ({ type: c.r.u8(), portrait: c.r.u8(), name: c.r.string(), players: c.r.u8() })))
    : []
  c.r.scope('reserved', () => c.r.zeros(31, 'reserved bytes'))
  const allowedArtifacts = c.ab ? c.r.scope('allowedArtifacts', () => c.r.bytesCopy(c.sod ? 18 : 17)) : null
  const allowedSpells = c.sod ? c.r.scope('allowedSpells', () => c.r.bytesCopy(9)) : null
  const allowedSkills = c.sod ? c.r.scope('allowedSkills', () => c.r.bytesCopy(4)) : null
  const rumors = c.r.scope('rumors', () => {
    const at = c.r.offset
    const count = c.r.u32()
    if (count > 10_000) c.r.invalid(`rumor count ${count} exceeds 10000`, at)
    return Array.from({ length: count }, (_, i) => c.r.scope(`[${i}]`, () => ({ name: c.r.string(), text: c.r.string() })))
  })
  const heroSettings = c.sod
    ? c.r.scope('heroSettings', () => Array.from({ length: 156 }, (_, i) => c.r.scope(`[${i}]`, () => (c.r.bool() ? readHeroSettings(c) : null))))
    : null
  return { teams, allowedHeroes, placeholderHeroIds, customHeroes, allowedArtifacts, allowedSpells, allowedSkills, rumors, heroSettings }
}
