// HotA event-system block ("script section"), sub-version 9+
// (specs/005-hota-support/contracts/map-format.md, research M5).
//
// It sits between the map options and the allowed-artifact mask: one u8 flag, and when that flag
// is set a variable-length body with NO length prefix and NO terminator. Nothing inside is
// length-prefixed either, so a wrong opcode silently desynchronises the reader — which is why
// every structure below is walked, never skipped, and why unknown codes throw instead of guessing
// (constitution VII). The parse is finally validated by the map ending exactly at end of file.
//
// The grammar was derived for this project and verified byte-exactly against the four local maps
// that carry a body (3574, 10630, 3371 and 4051 bytes, with no length hint given to the walker).
// Behaviour was understood from VCMI, which is GPL: it was studied, not copied. Structures the
// four maps do not exercise are marked "not exercised" below; they follow the same understanding
// and would surface as a failed end-of-file check rather than as a silent misread.

import { FORMAT_ERROR_CODES } from '../../util/errors.ts'
import type { H3mContext } from './context.ts'

export interface ScriptSection {
  active: boolean
  /** Bytes consumed by the body (0 when inactive). */
  bytes: number
}

/** Event buckets, in the order they are stored. */
const EVENT_LISTS = ['hero', 'player', 'town', 'quest'] as const

const MAX_COUNT = 100_000

function count(c: H3mContext, what: string): number {
  const at = c.r.offset
  const n = c.r.i32()
  if (n < 0 || n > MAX_COUNT) c.r.invalid(`${what} count ${n} outside 0..${MAX_COUNT}`, at)
  return n
}

/** A value that is always the same in every measured block; a difference means desynchronisation. */
function expect(c: H3mContext, actual: number | boolean, wanted: number | boolean, what: string): void {
  if (actual !== wanted) c.r.invalid(`${what}: expected ${String(wanted)}, got ${String(actual)}`, c.r.offset)
}

function readExpressionInternal(c: H3mContext): void {
  expect(c, c.r.bool(), true, 'expression marker')
  const at = c.r.offset
  const code = c.r.i32()
  switch (code) {
    case 0: // integer value
    case 1: // variable value
      c.r.i32()
      return
    case 2: // negate (not exercised)
      c.r.i32()
      readExpression(c)
      return
    case 3: // add
    case 4: // subtract (not exercised)
    case 6: // multiply (not exercised)
    case 7: // divide (not exercised)
    case 8: // modulo (not exercised)
      readExpressionInternal(c)
      readExpressionInternal(c)
      return
    case 5: // resource of a player: the player is one byte here, unlike elsewhere
      c.r.u8()
      c.r.i32()
      return
    case 9: // creature count in army
    case 11: // compare difficulty (not exercised)
    case 15: // hero primary skill (not exercised)
      c.r.i32()
      return
    case 10: // current difficulty
    case 12: // current date (not exercised)
    case 13: // hero experience (not exercised)
    case 14: // hero level
      return
    case 16: // random number
      readExpression(c)
      readExpression(c)
      return
    case 17: // hero owned artifacts (not exercised)
      c.r.i32()
      c.r.i32()
      return
    default:
      return c.r.fail(FORMAT_ERROR_CODES.UNSUPPORTED_OBJECT, `unknown event-system expression ${code}`, at)
  }
}

/** A literal, or a flag followed by an expression tree. */
function readExpression(c: H3mContext): void {
  if (!c.r.bool()) {
    c.r.i32()
    return
  }
  readExpressionInternal(c)
}

function readConditionInternal(c: H3mContext): void {
  const at = c.r.offset
  const code = c.r.i32()
  switch (code) {
    case 0: // constant
      c.r.bool()
      return
    case 1: // all of
    case 2: { // any of (not exercised)
      const n = count(c, 'condition list')
      for (let i = 0; i < n; i++) readConditionInternal(c)
      return
    }
    case 3:
    case 4:
    case 5:
    case 8:
    case 9: // comparisons; 9 and 10 not exercised
    case 10:
      readExpression(c)
      readExpression(c)
      return
    case 6: // not
      readCondition(c)
      return
    case 7: // has artifact
      c.r.i32()
      c.r.i32()
      return
    case 11: // current player
      c.r.u32()
      return
    case 12: // hero owner (not exercised)
      c.r.i32()
      c.r.u32()
      return
    case 14: // defeated monster (not exercised)
    case 15: // defeated hero
    case 18: // owns town
      c.r.u32()
      c.r.u32()
      return
    case 16: // hero secondary skill
      c.r.i32()
      c.r.i32()
      return
    case 17: // player defeated (not exercised)
    case 19: // player is human
    case 20: // player starting faction
      c.r.u32()
      if (code === 20) c.r.i32()
      return
    case 21: // town is neutral (not exercised)
      return
    default:
      return c.r.fail(FORMAT_ERROR_CODES.UNSUPPORTED_OBJECT, `unknown event-system condition ${code}`, at)
  }
}

function readCondition(c: H3mContext): void {
  expect(c, c.r.bool(), true, 'condition marker')
  readConditionInternal(c)
}

/** `count` × { kind, subtype, amount }: the pictures a message or reward shows. */
function readImages(c: H3mContext, n: number): void {
  for (let i = 0; i < n; i++) {
    c.r.i32()
    c.r.i32()
    readExpression(c)
  }
}

function readAction(c: H3mContext): void {
  const at = c.r.offset
  const op = c.r.i32()
  switch (op) {
    case 1: { // conditional chain
      let more = 1
      while (more !== 0) {
        readCondition(c)
        readActionBlock(c)
        c.r.bool()
        more = c.r.i32()
      }
      expect(c, c.r.i32(), 0, 'conditional chain terminator')
      return
    }
    case 2: // set variable conditionally
      c.r.i32()
      readCondition(c)
      readExpression(c)
      readExpression(c)
      return
    case 3: // modify variable
      c.r.i32()
      c.r.i8()
      readExpressionInternal(c)
      return
    case 4: // resources
      c.r.i8()
      for (let i = 0; i < 7; i++) readExpression(c)
      c.r.bool()
      return
    case 5: // remove object / finish quest
    case 27: // disable event
      return
    case 6: // show rewards message
      c.r.string()
      readActionBlock(c)
      return
    case 7: // quest action
      readCondition(c)
      c.r.string()
      c.r.string()
      c.r.string()
      c.r.string()
      readActionBlock(c)
      c.r.bool()
      return
    case 8: // creatures
      c.r.bool()
      c.r.i32()
      readExpression(c)
      c.r.bool()
      return
    case 9: // artifact
      c.r.bool()
      c.r.i32()
      c.r.i32()
      c.r.bool()
      return
    case 10: // construct building (not exercised)
      c.r.u32()
      c.r.i16()
      c.r.i16()
      c.r.bool()
      return
    case 11: { // set quest hint
      c.r.string()
      readImages(c, count(c, 'quest hint images'))
      c.r.bool()
      return
    }
    case 12: { // show question
      const mode = c.r.i8()
      c.r.string()
      readActionBlock(c)
      readActionBlock(c)
      if (mode === 2) readActionBlock(c)
      // Modes 0 and 3 store the image count; modes 1 and 2 always show two (modes 0 and 1 are not
      // exercised by the local maps).
      const images = mode === 0 || mode === 3 ? count(c, 'question images') : 2
      readImages(c, images)
      if (mode === 1 || mode === 2) {
        c.r.bool()
        c.r.i32()
      }
      return
    }
    case 13: // conditional
      readCondition(c)
      readActionBlock(c)
      readActionBlock(c)
      return
    case 14: // creatures to hire
      c.r.u32()
      readExpression(c)
      c.r.i32()
      c.r.bool()
      return
    case 15: // spell (not exercised)
    case 21: // luck (not exercised)
    case 22: // morale (not exercised)
      c.r.i32()
      c.r.bool()
      return
    case 16: // experience (not exercised)
      readExpression(c)
      c.r.bool()
      return
    case 17: // spell points (not exercised)
    case 18: // movement points (not exercised)
    case 19: // primary skill
      readExpression(c)
      c.r.i32()
      c.r.bool()
      return
    case 20: // secondary skill (not exercised)
      c.r.i32()
      c.r.i32()
      c.r.bool()
      return
    case 23: // start combat (not exercised)
      for (let i = 0; i < 7; i++) {
        readExpression(c)
        c.r.i32()
      }
      return
    case 24: // execute another event
      c.r.i32()
      c.r.i32()
      return
    case 25: // war machine (not exercised)
      c.r.bool()
      c.r.i32()
      c.r.bytesCopy(4)
      c.r.bool()
      return
    case 26: // spellbook (not exercised)
      c.r.bool()
      c.r.bytesCopy(8)
      c.r.bool()
      return
    case 28: // loop: the body is stored before its bounds (not exercised)
      readActionBlock(c)
      readExpression(c)
      readExpression(c)
      c.r.i32()
      return
    case 29: // show message
      c.r.string()
      readImages(c, count(c, 'message images'))
      return
    default:
      return c.r.fail(FORMAT_ERROR_CODES.UNSUPPORTED_OBJECT, `unknown event-system action ${op}`, at)
  }
}

function readActionBlock(c: H3mContext): void {
  expect(c, c.r.i32(), 1, 'action block marker')
  expect(c, c.r.i8(), 0, 'action block reserved byte')
  const n = count(c, 'action')
  for (let i = 0; i < n; i++) c.r.scope(`action[${i}]`, () => readAction(c))
}

/** Reads the block; returns how many bytes its body took. */
export function readScriptSection(c: H3mContext): ScriptSection {
  if (!c.f.hotaScriptSection) return { active: false, bytes: 0 }
  return c.r.scope('scriptSection', () => {
    const active = c.r.bool()
    if (!active) return { active: false, bytes: 0 }
    const start = c.r.offset
    for (const list of EVENT_LISTS) {
      c.r.scope(`${list}Events`, () => {
        const n = count(c, `${list} event`)
        for (let i = 0; i < n; i++) {
          c.r.scope(`[${i}]`, () => {
            c.r.i32()
            readActionBlock(c)
            c.r.string()
          })
        }
      })
    }
    // Next free id per bucket: variable, hero, player, town, quest.
    c.r.scope('nextIds', () => {
      for (let i = 0; i < 5; i++) c.r.i32()
    })
    c.r.scope('variables', () => {
      const n = count(c, 'variable')
      for (let i = 0; i < n; i++) {
        c.r.i32()
        c.r.string()
        c.r.bool()
        c.r.bool()
        c.r.i32()
      }
    })
    // Five ordering tables: the ids of each event list, then of the variables.
    c.r.scope('idTables', () => {
      for (let t = 0; t < 5; t++) {
        const n = count(c, 'id table')
        for (let i = 0; i < n; i++) c.r.i32()
      }
    })
    return { active: true, bytes: c.r.offset - start }
  })
}
