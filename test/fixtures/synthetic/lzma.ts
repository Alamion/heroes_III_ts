// Synthetic raw LZMA1 encoder (spec 008): turns fixture bytes into the stream HotA stores as
// compression type 2, so archive tests need no real HotA file and no external tool. It is the mirror
// of src/core/util/lzma.ts — a greedy parser that emits every packet kind (literal, matched literal,
// match with every distance slot, short rep, rep0–rep3) — not a good compressor.

import type { LzmaProperties } from '../../../src/core/util/lzma.ts'
import { HOTA_LZMA_PROPERTIES } from '../../../src/core/util/lzma.ts'

const NUM_STATES = 12
const POS_STATES_MAX = 16
const END_POS_MODEL_INDEX = 14
const NUM_FULL_DISTANCES = 128
const MATCH_MAX_LEN = 273
const LEN_LOW = 2
const LEN_MID = LEN_LOW + (POS_STATES_MAX << 3)
const LEN_HIGH = LEN_MID + (POS_STATES_MAX << 3)
const LEN_PROBS = LEN_HIGH + 256

class RangeEncoder {
  private low = 0
  private range = 0xffffffff
  private cache = 0
  private cacheSize = 1
  readonly out: number[] = []

  private shiftLow(): void {
    const lo32 = this.low % 0x100000000
    const carry = this.low >= 0x100000000 ? 1 : 0
    if (lo32 < 0xff000000 || carry !== 0) {
      let temp = this.cache
      do {
        this.out.push((temp + carry) & 0xff)
        temp = 0xff
      } while (--this.cacheSize !== 0)
      this.cache = lo32 >>> 24
    }
    this.cacheSize++
    this.low = (lo32 & 0x00ffffff) * 256
  }

  private normalize(): void {
    while (this.range < 1 << 24) {
      this.range = (this.range << 8) >>> 0
      this.shiftLow()
    }
  }

  bit(probs: Uint16Array, i: number, b: number): void {
    const p = probs[i] as number
    const bound = (this.range >>> 11) * p
    if (b === 0) {
      this.range = bound
      probs[i] = p + ((2048 - p) >>> 5)
    } else {
      this.low += bound
      this.range -= bound
      probs[i] = p - (p >>> 5)
    }
    this.normalize()
  }

  direct(value: number, count: number): void {
    for (let i = count - 1; i >= 0; i--) {
      this.range >>>= 1
      if (((value >>> i) & 1) !== 0) this.low += this.range
      this.normalize()
    }
  }

  flush(): void {
    for (let i = 0; i < 5; i++) this.shiftLow()
  }
}

export interface LzmaEncodeOptions {
  /** Appends the end-of-stream marker (liblzma's raw encoder always does). */
  endMarker?: boolean
  props?: LzmaProperties
}

export function lzmaEncodeRaw(data: Uint8Array, opts: LzmaEncodeOptions = {}): Uint8Array {
  const { lc, lp, pb } = opts.props ?? HOTA_LZMA_PROPERTIES
  const rc = new RangeEncoder()
  const p = (n: number): Uint16Array => new Uint16Array(n).fill(1024)
  const literals = p(0x300 << (lc + lp))
  const isMatch = p(NUM_STATES << 4)
  const isRep = p(NUM_STATES)
  const isRepG0 = p(NUM_STATES)
  const isRepG1 = p(NUM_STATES)
  const isRepG2 = p(NUM_STATES)
  const isRep0Long = p(NUM_STATES << 4)
  const posSlots = p(4 << 6)
  const posEncoders = p(1 + NUM_FULL_DISTANCES - END_POS_MODEL_INDEX)
  const align = p(16)
  const lenProbs = p(LEN_PROBS)
  const repLenProbs = p(LEN_PROBS)

  const tree = (probs: Uint16Array, base: number, bits: number, sym: number): void => {
    let m = 1
    for (let i = bits - 1; i >= 0; i--) {
      const b = (sym >>> i) & 1
      rc.bit(probs, base + m, b)
      m = (m << 1) | b
    }
  }
  const treeReverse = (probs: Uint16Array, base: number, bits: number, sym: number): void => {
    let m = 1
    for (let i = 0; i < bits; i++) {
      const b = (sym >>> i) & 1
      rc.bit(probs, base + m, b)
      m = (m << 1) | b
    }
  }
  const encodeLen = (probs: Uint16Array, len: number, posState: number): void => {
    const l = len - 2
    if (l < 8) {
      rc.bit(probs, 0, 0)
      tree(probs, LEN_LOW + (posState << 3), 3, l)
    } else if (l < 16) {
      rc.bit(probs, 0, 1)
      rc.bit(probs, 1, 0)
      tree(probs, LEN_MID + (posState << 3), 3, l - 8)
    } else {
      rc.bit(probs, 0, 1)
      rc.bit(probs, 1, 1)
      tree(probs, LEN_HIGH, 8, l - 16)
    }
  }
  /** `dist` is the stored value (distance − 1); 0xFFFFFFFF is the end marker. */
  const encodeDistance = (dist: number, len: number): void => {
    const lenState = Math.min(len - 2, 3)
    let posSlot: number
    if (dist < 4) posSlot = dist
    else {
      const n = 31 - Math.clz32(dist)
      posSlot = (n << 1) | ((dist >>> (n - 1)) & 1)
    }
    tree(posSlots, lenState << 6, 6, posSlot)
    if (posSlot < 4) return
    const numDirectBits = (posSlot >>> 1) - 1
    const base = ((2 | (posSlot & 1)) << numDirectBits) >>> 0
    const reduced = (dist - base) >>> 0
    if (posSlot < END_POS_MODEL_INDEX) {
      treeReverse(posEncoders, base - posSlot, numDirectBits, reduced)
    } else {
      rc.direct(reduced >>> 4, numDirectBits - 4)
      treeReverse(align, 0, 4, reduced & 15)
    }
  }

  const pbMask = (1 << pb) - 1
  const lpMask = (1 << lp) - 1
  let state = 0
  const reps = [0, 0, 0, 0]
  const chains = new Map<number, number[]>()
  const key = (i: number): number => ((data[i] as number) << 16) | ((data[i + 1] as number) << 8) | (data[i + 2] as number)
  const matchLen = (a: number, b: number): number => {
    let n = 0
    while (n < MATCH_MAX_LEN && b + n < data.length && data[a + n] === data[b + n]) n++
    return n
  }
  const remember = (i: number): void => {
    if (i + 2 >= data.length) return
    const k = key(i)
    const list = chains.get(k) ?? []
    list.push(i)
    if (list.length > 16) list.shift()
    chains.set(k, list)
  }

  let pos = 0
  while (pos < data.length) {
    const posState = pos & pbMask
    // Candidates: the four reps, then a fresh match from the hash chain.
    let bestRep = -1
    let bestRepLen = 0
    for (let r = 0; r < 4 && pos > 0; r++) {
      const from = pos - (reps[r] as number) - 1
      if (from < 0) continue
      const n = matchLen(from, pos)
      if (n > bestRepLen) {
        bestRepLen = n
        bestRep = r
      }
    }
    let bestLen = 0
    let bestDist = 0
    if (pos + 2 < data.length) {
      for (const cand of chains.get(key(pos)) ?? []) {
        const n = matchLen(cand, pos)
        if (n > bestLen) {
          bestLen = n
          bestDist = pos - cand - 1
        }
      }
    }
    const litByte = (): void => {
      rc.bit(isMatch, (state << 4) + posState, 0)
      const prev = pos > 0 ? (data[pos - 1] as number) : 0
      const base = 0x300 * (((pos & lpMask) << lc) + (prev >>> (8 - lc)))
      const byte = data[pos] as number
      let symbol = 1
      let matched = state >= 7
      const matchByte = matched ? (data[pos - (reps[0] as number) - 1] as number) : 0
      for (let i = 7; i >= 0; i--) {
        const b = (byte >>> i) & 1
        if (matched) {
          const mb = (matchByte >>> i) & 1
          rc.bit(literals, base + ((1 + mb) << 8) + symbol, b)
          matched = mb === b
        } else {
          rc.bit(literals, base + symbol, b)
        }
        symbol = (symbol << 1) | b
      }
      state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
      remember(pos)
      pos++
    }
    if (bestRepLen >= 2 && bestRepLen + 1 >= bestLen) {
      rc.bit(isMatch, (state << 4) + posState, 1)
      rc.bit(isRep, state, 1)
      if (bestRep === 0) {
        rc.bit(isRepG0, state, 0)
        rc.bit(isRep0Long, (state << 4) + posState, 1)
      } else {
        rc.bit(isRepG0, state, 1)
        const dist = reps[bestRep] as number
        if (bestRep === 1) rc.bit(isRepG1, state, 0)
        else {
          rc.bit(isRepG1, state, 1)
          rc.bit(isRepG2, state, bestRep === 2 ? 0 : 1)
          if (bestRep === 3) reps[3] = reps[2] as number
          reps[2] = reps[1] as number
        }
        reps[1] = reps[0] as number
        reps[0] = dist
      }
      encodeLen(repLenProbs, bestRepLen, posState)
      state = state < 7 ? 8 : 11
      for (let i = 0; i < bestRepLen; i++) remember(pos + i)
      pos += bestRepLen
    } else if (bestLen >= 3) {
      rc.bit(isMatch, (state << 4) + posState, 1)
      rc.bit(isRep, state, 0)
      encodeLen(lenProbs, bestLen, posState)
      encodeDistance(bestDist, bestLen)
      reps[3] = reps[2] as number
      reps[2] = reps[1] as number
      reps[1] = reps[0] as number
      reps[0] = bestDist
      state = state < 7 ? 7 : 10
      for (let i = 0; i < bestLen; i++) remember(pos + i)
      pos += bestLen
    } else if (pos > (reps[0] as number) && data[pos] === data[pos - (reps[0] as number) - 1] && state >= 7) {
      // Short rep: one byte from rep0 (only after a match, so the literal path stays exercised too).
      rc.bit(isMatch, (state << 4) + posState, 1)
      rc.bit(isRep, state, 1)
      rc.bit(isRepG0, state, 0)
      rc.bit(isRep0Long, (state << 4) + posState, 0)
      state = state < 7 ? 9 : 11
      remember(pos)
      pos++
    } else {
      litByte()
    }
  }
  if (opts.endMarker === true) {
    const posState = pos & pbMask
    rc.bit(isMatch, (state << 4) + posState, 1)
    rc.bit(isRep, state, 0)
    encodeLen(lenProbs, 2, posState)
    encodeDistance(0xffffffff, 2)
  }
  rc.flush()
  return Uint8Array.from(rc.out)
}

/**
 * HotA's framing of an LZMA entry (hota-lod-convert `read_file`): a 0 byte, the raw stream, then a
 * footer of two little-endian i64 — the uncompressed size and the stored size plus 5.
 */
export function hotaLzmaEntry(data: Uint8Array, opts: LzmaEncodeOptions = { endMarker: true }): Uint8Array {
  const stream = lzmaEncodeRaw(data, opts)
  const stored = 1 + stream.length + 16
  const out = new Uint8Array(stored)
  out.set(stream, 1)
  const footer = new DataView(out.buffer, 1 + stream.length, 16)
  footer.setBigInt64(0, BigInt(data.length), true)
  footer.setBigInt64(8, BigInt(stored + 5), true)
  return out
}
