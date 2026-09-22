import type { H3mContext } from '../context.ts'
import type { ObjectBody, TimedEvent, TownEvent } from '../types.ts'
import { readArmy, readResources, readSpellMask } from './common.ts'
import { readEventSystemHook } from './hota.ts'

/** Global events and the common part of town events. */
export function readTimedEvent(c: H3mContext, isTownEvent = false): TimedEvent {
  const r = c.r
  const name = r.string()
  const message = r.string()
  const resources = readResources(c)
  const players = r.u8()
  const humanAffected = c.sod ? r.flag() : true
  const computerAffected = r.flag()
  const firstDay = r.u16()
  // HotA widened the repeat field to u16 and shortened the padding by the same byte (research M4).
  const repeatEvery = c.f.hotaEventOccurrenceU16 ? r.u16() : r.u8()
  r.zeros(c.f.hotaEventOccurrenceU16 ? 16 : 17, 'event padding')
  if (c.f.hotaEventDifficulties) r.scope('affectedDifficulties', () => r.i32())
  if (c.f.hotaEventLegacyTail && !isTownEvent) {
    // Sub 5-6 global events carry the town-event block here instead of the difficulty mask.
    r.scope('hotaLegacyEventTail', () => {
      r.i32()
      r.i32()
      r.i32()
      r.i16()
    })
  }
  readEventSystemHook(c)
  return { name, message, resources, players, humanAffected, computerAffected, firstDay, repeatEvery }
}

function readTownEvent(c: H3mContext): TownEvent {
  const base = readTimedEvent(c, true)
  if (c.f.hotaTownEventExtras) {
    // Level-8 creature growth and three HotA-only values (names from VCMI, sizes measured).
    c.r.scope('hotaTownEvent', () => {
      c.r.i32()
      c.r.i32()
      c.r.i32()
      c.r.i16()
    })
  }
  if (c.f.hotaTownEventNeutral) c.r.scope('neutralAffected', () => c.r.u8())
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
  // HotA: "spell research allowed", then a counted table of special-building states.
  const hotaExtra = r.scope('hotaTown', () => {
    if (!c.f.hotaTownSpellResearch) return null
    const research = c.r.u8()
    if (!c.f.hotaTownSpecialBuildings) return Uint8Array.of(research)
    const at = c.r.offset
    const count = c.r.u32()
    if (count > 1024) c.r.invalid(`town special building count ${count} exceeds 1024`, at)
    const buildings = c.r.bytesCopy(count)
    const out = new Uint8Array(1 + buildings.length)
    out[0] = research
    out.set(buildings, 1)
    return out
  })
  const events = r.scope('events', () => {
    const at = r.offset
    const count = r.u32()
    if (count > 1000) r.invalid(`town event count ${count} exceeds 1000`, at)
    return Array.from({ length: count }, (_, i) => r.scope(`[${i}]`, () => readTownEvent(c)))
  })
  const alignment = c.sod ? r.u8() : null
  r.zeros(3, 'town padding')
  return { kind: 'town', identifier, owner, name, garrison, formation, buildings, spellsMustHave, spellsMayHave, hotaExtra, events, alignment }
}
