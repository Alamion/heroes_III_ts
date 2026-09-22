// HotA-only object bodies and the blocks HotA appends to base-game bodies
// (specs/005-hota-support/contracts/map-format.md).
//
// The renderer needs none of these values — it needs the map to stay aligned — so most of them are
// read as named, fixed-size blocks and kept as raw bytes on the object. Sizes are verified: every
// local HotA map parses to the exact end of file. Where a field's *meaning* comes from studying
// VCMI rather than from measurement, the comment says so.

import type { H3mContext } from '../context.ts'
import type { ObjectBody } from '../types.ts'

/**
 * Event hook of the HotA event system (sub-version 9+): a flag, and when set an event id and one
 * more byte. Appears at the end of every event record and of box-like bodies.
 */
export function readEventSystemHook(c: H3mContext): void {
  if (!c.f.hotaEventSystemHook) return
  c.r.scope('eventSystemHook', () => {
    if (!c.r.bool()) return
    c.r.i32()
    c.r.u8()
  })
}

/** Tail shared by Pandora's box and map events. */
export function readBoxHotaTail(c: H3mContext): void {
  if (c.f.hotaBoxMovement) {
    c.r.scope('hotaMovement', () => {
      c.r.i32()
      c.r.i32()
    })
  }
  if (c.f.hotaBoxDifficulties) c.r.scope('hotaDifficulties', () => c.r.i32())
  readEventSystemHook(c)
}

/**
 * Reward block of the classes that gained a body in HotA. `payload` is 14 bytes for the large form
 * and 4 for the small one; its internal shape depends on the content value (understood from VCMI,
 * not measured), so it is kept raw.
 */
function readRewardBlock(c: H3mContext, payload: number, what: string): ObjectBody {
  return c.r.scope(what, () => {
    const content = c.r.i32()
    const bytes = c.r.bytesCopy(payload)
    return { kind: 'hotaReward', content, bytes }
  })
}

/** Campfire, lean-to, wagon, and HotA custom class 145 subtypes 0–1. */
export function readRewardCustom18(c: H3mContext): ObjectBody {
  return readRewardBlock(c, 14, 'hotaReward18')
}

/** Corpse, sea chest, shipwreck survivor, treasure chest, warrior's tomb, 145 subtypes 2–3. */
export function readRewardCustom8(c: H3mContext): ObjectBody {
  return readRewardBlock(c, 4, 'hotaReward8')
}

/** Flotsam, tree of knowledge, pyramid, university (its 4 bytes are the skill mask), 146/0. */
export function readRewardContent4(c: H3mContext): ObjectBody {
  return readRewardBlock(c, 4, 'hotaContent4')
}

/** Black market: seven artifact slots, each with its scroll spell. */
export function readBlackMarket(c: H3mContext): ObjectBody {
  return c.r.scope('blackMarket', () => {
    const bytes = c.r.bytesCopy(7 * 4)
    return { kind: 'hotaReward', content: 0, bytes }
  })
}

/** Creature banks: which guard preset and which artifacts the bank holds. */
export function readCreatureBank(c: H3mContext): ObjectBody {
  if (!c.f.hotaCreatureBank) return { kind: 'none' }
  return c.r.scope('creatureBank', () => {
    const guardsPreset = c.r.i32()
    const upgradedStack = c.r.i8()
    const at = c.r.offset
    const count = c.r.u32()
    if (count > 64) c.r.invalid(`creature bank artifact count ${count} exceeds 64`, at)
    const artifacts = Array.from({ length: count }, () => c.r.u32())
    return { kind: 'creatureBank', guardsPreset, upgradedStack, artifacts }
  })
}

/** HotA custom class 144: only subtype 12 (Trapper Lodge) carries a body. */
export function readCustomClass144(c: H3mContext, subclassId: number): ObjectBody {
  if (subclassId !== 12 || !c.f.hotaCustomClass144) return { kind: 'none' }
  return c.r.scope('hota144', () => {
    const content = c.r.i32()
    const bytes = c.r.bytesCopy(12) // gold, creature amount, creature type
    return { kind: 'hotaReward', content, bytes }
  })
}

/** HotA custom class 145: Ancient Lamp, Sea Barrel, Jetsam, Vial of Mana. */
export function readCustomClass145(c: H3mContext, subclassId: number): ObjectBody {
  if (!c.f.hotaRewardBodies) return { kind: 'none' }
  return subclassId <= 1 ? readRewardCustom18(c) : readRewardCustom8(c)
}

/** HotA custom class 146: only subtype 0 (Seafaring Academy) carries a body. */
export function readCustomClass146(c: H3mContext, subclassId: number): ObjectBody {
  if (subclassId !== 0 || !c.f.hotaRewardBodies) return { kind: 'none' }
  return readRewardContent4(c)
}
