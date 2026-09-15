// Structures shared by several H3M object bodies and the header.

import type { H3mContext } from '../context.ts'
import type { CreatureStack, Guard, HeroArtifacts, PrimarySkills, Quest, Reward, SecondarySkill } from '../types.ts'

/** Artifact id: u8 in RoE (0xFF none), u16 in AB+ (0xFFFF none). */
export function readArtifactId(c: H3mContext): number {
  return c.ab ? c.r.u16() : c.r.u8()
}

/** Creature id: u8 in RoE (0xFF none), u16 in AB+ (0xFFFF none). */
export function readCreatureId(c: H3mContext): number {
  return c.ab ? c.r.u16() : c.r.u8()
}

export function readStack(c: H3mContext): CreatureStack {
  return { creature: readCreatureId(c), count: c.r.u16() }
}

/** Seven army slots. */
export function readArmy(c: H3mContext): CreatureStack[] {
  return c.r.scope('army', () => Array.from({ length: 7 }, () => readStack(c)))
}

export function readResources(c: H3mContext): number[] {
  return c.r.scope('resources', () => Array.from({ length: 7 }, () => c.r.i32()))
}

export function readPrimarySkills(c: H3mContext): PrimarySkills {
  return c.r.scope('primarySkills', () => ({ attack: c.r.u8(), defense: c.r.u8(), spellPower: c.r.u8(), knowledge: c.r.u8() }))
}

export function readSecondarySkill(c: H3mContext): SecondarySkill {
  return { skill: c.r.u8(), level: c.r.u8() }
}

export function readSecondarySkillsU32(c: H3mContext): SecondarySkill[] {
  return c.r.scope('secondarySkills', () => {
    const at = c.r.offset
    const count = c.r.u32()
    if (count > 28) c.r.invalid(`secondary skill count ${count} exceeds 28`, at)
    return Array.from({ length: count }, () => readSecondarySkill(c))
  })
}

/** 9-byte spell mask (70 spells). */
export function readSpellMask(c: H3mContext): Uint8Array {
  return c.r.scope('spells', () => c.r.bytesCopy(9))
}

export function readHeroArtifacts(c: H3mContext): HeroArtifacts {
  return c.r.scope('artifacts', () => {
    const slots = c.sod ? 19 : 18
    const worn = Array.from({ length: slots }, () => readArtifactId(c))
    const at = c.r.offset
    const count = c.r.u16()
    if (count > 64) c.r.invalid(`backpack count ${count} exceeds 64`, at)
    const backpack = Array.from({ length: count }, () => readArtifactId(c))
    return { worn, backpack }
  })
}

/** Optional block: message, optional guards, then 4 zero bytes. */
export function readGuard(c: H3mContext): Guard | null {
  return c.r.scope('guard', () => {
    if (!c.r.bool()) return null
    const message = c.r.string()
    const creatures = c.r.bool() ? readArmy(c) : null
    c.r.zeros(4, 'guard padding')
    return { message, creatures }
  })
}

/** Contents of Pandora's boxes and events. */
export function readReward(c: H3mContext): Reward {
  return c.r.scope('reward', () => {
    const experience = c.r.u32()
    const spellPoints = c.r.i32()
    const morale = c.r.i8()
    const luck = c.r.i8()
    const resources = readResources(c)
    const primarySkills = readPrimarySkills(c)
    const secondarySkills = c.r.scope('secondarySkills', () => Array.from({ length: c.r.u8() }, () => readSecondarySkill(c)))
    const artifacts = c.r.scope('artifacts', () => Array.from({ length: c.r.u8() }, () => readArtifactId(c)))
    const spells = c.r.scope('spells', () => Array.from({ length: c.r.u8() }, () => c.r.u8()))
    const creatures = c.r.scope('creatures', () => Array.from({ length: c.r.u8() }, () => readStack(c)))
    c.r.zeros(8, 'reward padding')
    return { experience, spellPoints, morale, luck, resources, primarySkills, secondarySkills, artifacts, spells, creatures }
  })
}

/** AB+ quest (seer huts, quest guards). */
export function readQuest(c: H3mContext): Quest {
  return c.r.scope('quest', () => {
    const at = c.r.offset
    const type = c.r.u8()
    if (type === 0) return { kind: 'none' }
    type QuestCore = Quest extends infer T ? (T extends { deadline: number } ? Omit<T, 'deadline' | 'proposal' | 'progress' | 'completion'> : never) : never
    let q: QuestCore
    switch (type) {
      case 1:
        q = { kind: 'experienceLevel', value: c.r.u32() }
        break
      case 2:
        q = { kind: 'primarySkills', skills: readPrimarySkills(c) }
        break
      case 3:
        q = { kind: 'defeatHero', targetId: c.r.u32() }
        break
      case 4:
        q = { kind: 'defeatMonster', targetId: c.r.u32() }
        break
      case 5:
        q = { kind: 'artifacts', artifacts: Array.from({ length: c.r.u8() }, () => readArtifactId(c)) }
        break
      case 6:
        q = { kind: 'creatures', creatures: Array.from({ length: c.r.u8() }, () => readStack(c)) }
        break
      case 7:
        q = { kind: 'resources', resources: Array.from({ length: 7 }, () => c.r.u32()) }
        break
      case 8:
        q = { kind: 'beHero', hero: c.r.u8() }
        break
      case 9:
        q = { kind: 'bePlayer', player: c.r.u8() }
        break
      default:
        return c.r.invalid(`unknown quest type ${type}`, at)
    }
    const deadline = c.r.i32()
    const proposal = c.r.string()
    const progress = c.r.string()
    const completion = c.r.string()
    return { ...q, deadline, proposal, progress, completion } as Quest
  })
}
