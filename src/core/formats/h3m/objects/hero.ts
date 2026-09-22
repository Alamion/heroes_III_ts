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
  if (c.f.hotaHeroLevelBlock) {
    // HotA: the same per-hero block the header carries for predefined heroes.
    r.scope('hotaHeroLevel', () => {
      r.u8()
      r.u8()
      r.i32()
    })
  }
  return { kind: 'hero', identifier, owner, type, name, experience, portrait, secondarySkills, garrison, formation, artifacts, patrolRadius, biography, gender, abSpell, spells, primarySkills }
}

export function readHeroPlaceholder(c: H3mContext): ObjectBody {
  const owner = c.r.u8()
  const heroType = c.r.u8()
  const powerRank = heroType === 0xff ? c.r.u8() : null
  if (c.f.hotaHeroPlaceholderArmy) {
    // HotA: customised starting units and artifacts (names from VCMI, sizes measured).
    c.r.scope('hotaPlaceholder', () => {
      c.r.u8()
      for (let i = 0; i < 7; i++) {
        c.r.i32()
        c.r.u32()
      }
      const at = c.r.offset
      const count = c.r.i32()
      if (count < 0 || count > 256) c.r.invalid(`hero placeholder artifact count ${count} outside 0..256`, at)
      for (let i = 0; i < count; i++) c.r.u32()
    })
  }
  return { kind: 'heroPlaceholder', owner, heroType, powerRank }
}
