// HotA event-system block ("script section"), sub-version 9+
// (specs/005-hota-support/contracts/map-format.md, research M5).
//
// It sits between the map options and the allowed-artifact mask: one u8 flag, and when that flag
// is set a variable-length body with NO length prefix and NO terminator, so the body can only be
// walked. Guessing or searching for its length is forbidden (constitution VII), and a map whose
// body cannot be walked fails honestly instead.
//
// 4 of the 72 local HotA maps have the flag set.

import { FORMAT_ERROR_CODES } from '../../util/errors.ts'
import type { H3mContext } from './context.ts'

export interface ScriptSection {
  active: boolean
  /** Bytes consumed by the body (0 when inactive). */
  bytes: number
}

/** Reads the block; returns how many bytes its body took. */
export function readScriptSection(c: H3mContext): ScriptSection {
  if (!c.f.hotaScriptSection) return { active: false, bytes: 0 }
  return c.r.scope('scriptSection', () => {
    const at = c.r.offset
    const active = c.r.bool()
    if (!active) return { active: false, bytes: 0 }
    return c.r.fail(FORMAT_ERROR_CODES.UNSUPPORTED_VERSION, 'this map uses the HotA event system; reading that block is not implemented yet', at)
  })
}
