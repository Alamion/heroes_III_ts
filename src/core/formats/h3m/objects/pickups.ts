import type { H3mContext } from '../context.ts'
import type { ObjectBody } from '../types.ts'
import { readArtifactId, readGuard, readResources } from './common.ts'

/** Monsters and random monsters. */
export function readMonster(c: H3mContext): ObjectBody {
  const r = c.r
  const identifier = c.ab ? r.u32() : null
  const count = r.u16()
  const disposition = r.u8()
  let message = null
  let resources = null
  let artifact = null
  if (r.bool()) {
    message = r.string()
    resources = readResources(c)
    artifact = readArtifactId(c)
  }
  const neverFlees = r.bool()
  const noGrowth = r.bool()
  r.zeros(2, 'monster padding')
  if (c.f.hotaMonsterAggression) {
    // HotA: joining behaviour and stack handling (names from VCMI, sizes measured).
    r.scope('hotaAggression', () => {
      r.i32()
      r.u8()
      r.i32()
      r.i32()
      r.i32()
    })
  }
  if (c.f.hotaMonsterValue) {
    // HotA: the stack size may be derived from a target value instead of being fixed.
    r.scope('hotaValue', () => {
      r.u8()
      r.i32()
    })
  }
  return { kind: 'monster', identifier, count, disposition, message, resources, artifact, neverFlees, noGrowth }
}

export function readArtifact(c: H3mContext): ObjectBody {
  const guard = readGuard(c)
  if (c.f.hotaArtifactPickup) {
    // HotA: how the artifact may be picked up (names from VCMI, sizes measured).
    c.r.scope('hotaPickup', () => {
      c.r.u32()
      c.r.u8()
    })
  }
  return { kind: 'artifact', guard }
}

export function readSpellScroll(c: H3mContext): ObjectBody {
  const guard = readGuard(c)
  return { kind: 'spellScroll', guard, spell: c.r.u32() }
}

export function readResource(c: H3mContext): ObjectBody {
  const guard = readGuard(c)
  const amount = c.r.u32()
  c.r.zeros(4, 'resource padding')
  return { kind: 'resource', guard, amount }
}
