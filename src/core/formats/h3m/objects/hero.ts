import type { H3mContext } from '../context.ts'
import type { HeroBody, ObjectBody } from '../types.ts'
import { readArmy, readHeroArtifacts, readPrimarySkills, readSecondarySkillsU32, readSpellMask } from './common.ts'

/** Heroes, random heroes and prisons. */
export function readHero(c: H3mContext): HeroBody {
  const r = c.r
  const identifier = c.ab ? r.u32() : null
  const owner = r.u8()
  const type = r.u8()
  const name = r.bool() ? r.string() : null
  let experience: number | null
  if (c.sod) experience = r.bool() ? r.u32() : null
  else experience = r.u32()
  const portrait = r.bool() ? r.u8() : null
  const secondarySkills = r.bool() ? readSecondarySkillsU32(c) : null
  const garrison = r.bool() ? readArmy(c) : null
  const formation = r.u8()
  const artifacts = r.bool() ? readHeroArtifacts(c) : null
  const patrolRadius = r.u8()
  let biography = null
  let gender: number | null = null
  if (c.ab) {
    biography = r.bool() ? r.string() : null
    gender = r.u8()
  }
  let abSpell: number | null = null
  let spells: Uint8Array | null = null
  if (c.sod) spells = r.bool() ? readSpellMask(c) : null
  else if (c.ab) abSpell = r.u8()
  const primarySkills = c.sod && r.bool() ? readPrimarySkills(c) : null
  r.zeros(16, 'hero padding')
  return { kind: 'hero', identifier, owner, type, name, experience, portrait, secondarySkills, garrison, formation, artifacts, patrolRadius, biography, gender, abSpell, spells, primarySkills }
}

export function readHeroPlaceholder(c: H3mContext): ObjectBody {
  const owner = c.r.u8()
  const heroType = c.r.u8()
  const powerRank = heroType === 0xff ? c.r.u8() : null
  return { kind: 'heroPlaceholder', owner, heroType, powerRank }
}
