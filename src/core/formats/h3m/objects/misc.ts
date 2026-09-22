import type { H3mContext } from '../context.ts'
import type { ObjectBody } from '../types.ts'
import { readArmy, readGuard, readReward } from './common.ts'
import { readBoxHotaTail } from './hota.ts'

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

/**
 * Abandoned mines: a resource bitmask instead of an owner, plus HotA's custom guards. The 12
 * guard bytes are skipped whether or not the flag is set — that is byte-correct on every local
 * map, but the branch itself is unverified (spec 005 research, "measured vs assumed").
 */
export function readAbandonedMine(c: H3mContext): ObjectBody {
  const resources = c.r.bytesCopy(4)
  if (c.f.hotaMineGuards) {
    c.r.scope('hotaMineGuards', () => {
      c.r.u8()
      c.r.bytesCopy(12)
    })
  }
  return { kind: 'abandonedMine', resources }
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
  // The base game leaves these six bytes zero; HotA does not, so they are skipped, not checked.
  if (c.f.hota) c.r.scope('scholar padding', () => c.r.bytesCopy(6))
  else c.r.zeros(6, 'scholar padding')
  return { kind: 'scholar', bonusType, bonusId }
}

export function readPandora(c: H3mContext): ObjectBody {
  const guard = readGuard(c)
  const reward = readReward(c)
  if (c.f.hotaPandoraPad) c.r.zeros(1, 'pandora padding')
  readBoxHotaTail(c)
  return { kind: 'pandora', guard, reward }
}

export function readEvent(c: H3mContext): ObjectBody {
  const guard = readGuard(c)
  const reward = readReward(c)
  const players = c.r.u8()
  const computerActivate = c.r.bool()
  const removeAfterVisit = c.r.bool()
  c.r.zeros(4, 'event padding')
  if (c.f.hotaEventHumanActivate) c.r.scope('humanActivate', () => c.r.u8())
  readBoxHotaTail(c)
  return { kind: 'event', guard, reward, players, computerActivate, removeAfterVisit }
}

/** Grail. HotA reuses subtypes >= 1000 for arena battle locations, which carry no radius. */
export function readGrail(c: H3mContext, subclassId: number): ObjectBody {
  if (c.f.hota && subclassId >= 1000) return { kind: 'grail', radius: null }
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
