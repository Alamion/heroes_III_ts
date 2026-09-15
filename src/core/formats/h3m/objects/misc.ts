import type { H3mContext } from '../context.ts'
import type { ObjectBody } from '../types.ts'
import { readArmy, readGuard, readReward } from './common.ts'

export function readMessage(c: H3mContext): ObjectBody {
  const text = c.r.string()
  c.r.zeros(4, 'message padding')
  return { kind: 'message', text }
}

export function readGarrison(c: H3mContext): ObjectBody {
  const owner = c.r.u32()
  const creatures = readArmy(c)
  const removableUnits = c.ab ? c.r.bool() : null
  c.r.zeros(8, 'garrison padding')
  return { kind: 'garrison', owner, creatures, removableUnits }
}

export function readOwned(c: H3mContext): ObjectBody {
  return { kind: 'owned', owner: c.r.u32() }
}

export function readShrine(c: H3mContext): ObjectBody {
  return { kind: 'shrine', spell: c.r.u32() }
}

export function readWitchHut(c: H3mContext): ObjectBody {
  return { kind: 'witchHut', allowedSkills: c.ab ? c.r.u32() : null }
}

export function readScholar(c: H3mContext): ObjectBody {
  const bonusType = c.r.u8()
  const bonusId = c.r.u8()
  c.r.zeros(6, 'scholar padding')
  return { kind: 'scholar', bonusType, bonusId }
}

export function readPandora(c: H3mContext): ObjectBody {
  const guard = readGuard(c)
  return { kind: 'pandora', guard, reward: readReward(c) }
}

export function readEvent(c: H3mContext): ObjectBody {
  const guard = readGuard(c)
  const reward = readReward(c)
  const players = c.r.u8()
  const computerActivate = c.r.bool()
  const removeAfterVisit = c.r.bool()
  c.r.zeros(4, 'event padding')
  return { kind: 'event', guard, reward, players, computerActivate, removeAfterVisit }
}

export function readGrail(c: H3mContext): ObjectBody {
  return { kind: 'grail', radius: c.r.u32() }
}

/**
 * Random dwellings. 216: faction info + level range; 217 (level fixed by subclass): faction
 * info; 218 (faction fixed by subclass): level range. Faction info is a linked town identifier,
 * or 0 followed by a 16-bit faction mask.
 */
export function readRandomDwelling(c: H3mContext, withFaction: boolean, withLevels: boolean): ObjectBody {
  const r = c.r
  const owner = r.u32()
  let linkedTown: number | null = null
  let factions: number | null = null
  if (withFaction) {
    linkedTown = r.u32()
    if (linkedTown === 0) factions = r.u16()
  }
  let minLevel: number | null = null
  let maxLevel: number | null = null
  if (withLevels) {
    minLevel = r.u8()
    maxLevel = r.u8()
  }
  return { kind: 'randomDwelling', owner, linkedTown, factions, minLevel, maxLevel }
}
