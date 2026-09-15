import type { H3mContext } from '../context.ts'
import type { ObjectBody, TimedEvent, TownEvent } from '../types.ts'
import { readArmy, readResources, readSpellMask } from './common.ts'

/** Global events and the common part of town events. */
export function readTimedEvent(c: H3mContext): TimedEvent {
  const r = c.r
  const name = r.string()
  const message = r.string()
  const resources = readResources(c)
  const players = r.u8()
  const humanAffected = c.sod ? r.flag() : true
  const computerAffected = r.flag()
  const firstDay = r.u16()
  const repeatEvery = r.u8()
  r.zeros(17, 'event padding')
  return { name, message, resources, players, humanAffected, computerAffected, firstDay, repeatEvery }
}

function readTownEvent(c: H3mContext): TownEvent {
  const base = readTimedEvent(c)
  const buildings = c.r.bytesCopy(6)
  const creatures = Array.from({ length: 7 }, () => c.r.u16())
  c.r.zeros(4, 'town event padding')
  return { ...base, buildings, creatures }
}

/** Towns and random towns. */
export function readTown(c: H3mContext): ObjectBody {
  const r = c.r
  const identifier = c.ab ? r.u32() : null
  const owner = r.u8()
  const name = r.bool() ? r.string() : null
  const garrison = r.bool() ? readArmy(c) : null
  const formation = r.u8()
  const buildings = r.scope('buildings', () =>
    r.bool() ? { custom: true as const, built: r.bytesCopy(6), forbidden: r.bytesCopy(6) } : { custom: false as const, hasFort: r.bool() },
  )
  const spellsMustHave = c.ab ? readSpellMask(c) : null
  const spellsMayHave = readSpellMask(c)
  const events = r.scope('events', () => {
    const at = r.offset
    const count = r.u32()
    if (count > 1000) r.invalid(`town event count ${count} exceeds 1000`, at)
    return Array.from({ length: count }, (_, i) => r.scope(`[${i}]`, () => readTownEvent(c)))
  })
  const alignment = c.sod ? r.u8() : null
  r.zeros(3, 'town padding')
  return { kind: 'town', identifier, owner, name, garrison, formation, buildings, spellsMustHave, spellsMayHave, events, alignment }
}
