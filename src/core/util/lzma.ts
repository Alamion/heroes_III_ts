// Raw LZMA1 decoder (no header, no container): what HotA archives newer or older than 1.8.1 store
// as compression type 2 (spec 008 research R1). Written from the algorithm of Igor Pavlov's LZMA
// SDK reference decoder (LzmaSpec.cpp, public domain); hota-lod-convert (MIT OR Apache-2.0) gave the
// parameters HotA uses — lc 3, lp 0, pb 2, a 16 MiB dictionary — and the entry framing.
//
// The whole output is one buffer of a known size, so the dictionary is that buffer: a distance
// beyond the bytes decoded so far is corrupt data, never a wrap.

import { FORMAT_ERROR_CODES, FormatError } from './errors.ts'
import type { InflateContext } from './inflate.ts'

export interface LzmaProperties {
  /** Literal context bits (0–8). */
  lc: number
  /** Literal position bits (0–4). */
  lp: number
  /** Position bits (0–4). */
  pb: number
  /** Dictionary size in bytes; a distance above it is corrupt data. */
  dictSize: number
}

/** Properties of HotA's LZMA entries (hota-lod-convert: liblzma preset 6 with a 16 MiB dictionary). */
export const HOTA_LZMA_PROPERTIES: LzmaProperties = { lc: 3, lp: 0, pb: 2, dictSize: 1 << 24 }

const NUM_STATES = 12
const POS_STATES_MAX = 16
const MATCH_MIN_LEN = 2
const END_POS_MODEL_INDEX = 14
const NUM_FULL_DISTANCES = 128
const ALIGN_BITS = 4
const LEN_LOW_BITS = 3
const LEN_MID_BITS = 3
const LEN_HIGH_BITS = 8
const PROB_INIT = 1024
const TOP = 1 << 24

/** Probability layout shared by the two length decoders (offsets inside one length block). */
const LEN_CHOICE = 0
const LEN_CHOICE2 = 1
const LEN_LOW = 2
const LEN_MID = LEN_LOW + (POS_STATES_MAX << LEN_LOW_BITS)
const LEN_HIGH = LEN_MID + (POS_STATES_MAX << LEN_MID_BITS)
const LEN_PROBS = LEN_HIGH + (1 << LEN_HIGH_BITS)

// All probabilities live in one array (one typed-array access path keeps V8's hot loop monomorphic);
// these are the offsets of each model part. Literals come last because their size depends on lc + lp.
const IS_MATCH = 0
const IS_REP = IS_MATCH + (NUM_STATES << 4)
const IS_REP_G0 = IS_REP + NUM_STATES
const IS_REP_G1 = IS_REP_G0 + NUM_STATES
const IS_REP_G2 = IS_REP_G1 + NUM_STATES
const IS_REP0_LONG = IS_REP_G2 + NUM_STATES
const POS_SLOT = IS_REP0_LONG + (NUM_STATES << 4)
const POS_DECODERS = POS_SLOT + (4 << 6)
const ALIGN = POS_DECODERS + 1 + NUM_FULL_DISTANCES - END_POS_MODEL_INDEX
const LEN_CODER = ALIGN + (1 << ALIGN_BITS)
const REP_LEN_CODER = LEN_CODER + LEN_PROBS
const LITERAL = REP_LEN_CODER + LEN_PROBS

/** Thrown inside the decoder and turned into the typed error with the context by lzmaDecodeRaw. */
class LzmaFailure extends Error {
  readonly at: number
  constructor(message: string, at: number) {
    super(message)
    this.at = at
  }
}

/**
 * The range decoder and model as fields of one object: closures over `let` variables made the first
 * version ~4 MB/s in V8; fields are what the hot loop wants (measured on HotA 1.8.0's archive, spec 008 R1).
 */
class Decoder {
  range = 0xffffffff
  code = 0
  inPos = 1
  readonly probs: Uint16Array
  readonly input: Uint8Array

  constructor(input: Uint8Array, lc: number, lp: number) {
    this.input = input
    this.probs = new Uint16Array(LITERAL + (0x300 << (lc + lp))).fill(PROB_INIT)
    for (let i = 0; i < 4; i++) this.code = ((this.code << 8) | (input[this.inPos++] as number)) >>> 0
  }

  nextByte(): number {
    if (this.inPos >= this.input.length) throw new LzmaFailure(`input ended after ${this.input.length} bytes`, this.inPos)
    return this.input[this.inPos++] as number
  }

  bit(i: number): number {
    const probs = this.probs
    const p = probs[i] as number
    const bound = (this.range >>> 11) * p
    let b: number
    if (this.code < bound) {
      this.range = bound
      probs[i] = p + ((2048 - p) >>> 5)
      b = 0
    } else {
      this.range -= bound
      this.code -= bound
      probs[i] = p - (p >>> 5)
      b = 1
    }
    if (this.range < TOP) {
      this.range = (this.range << 8) >>> 0
      this.code = ((this.code << 8) | this.nextByte()) >>> 0
    }
    return b
  }

  directBits(count: number): number {
    let res = 0
    for (let i = 0; i < count; i++) {
      this.range >>>= 1
      let b = 0
      if (this.code >= this.range) {
        this.code -= this.range
        b = 1
      }
      res = ((res << 1) | b) >>> 0
      if (this.range < TOP) {
        this.range = (this.range << 8) >>> 0
        this.code = ((this.code << 8) | this.nextByte()) >>> 0
      }
    }
    return res
  }

  bitTree(base: number, numBits: number): number {
    let m = 1
    for (let i = 0; i < numBits; i++) m = (m << 1) | this.bit(base + m)
    return m - (1 << numBits)
  }

  bitTreeReverse(base: number, numBits: number): number {
    let m = 1
    let sym = 0
    for (let i = 0; i < numBits; i++) {
      const b = this.bit(base + m)
      m = (m << 1) | b
      sym |= b << i
    }
    return sym
  }

  len(coder: number, posState: number): number {
    if (this.bit(coder + LEN_CHOICE) === 0) return this.bitTree(coder + LEN_LOW + (posState << LEN_LOW_BITS), LEN_LOW_BITS)
    if (this.bit(coder + LEN_CHOICE2) === 0) return 8 + this.bitTree(coder + LEN_MID + (posState << LEN_MID_BITS), LEN_MID_BITS)
    return 16 + this.bitTree(coder + LEN_HIGH, LEN_HIGH_BITS)
  }

  distance(len: number): number {
    const lenState = len < 3 ? len : 3
    const posSlot = this.bitTree(POS_SLOT + (lenState << 6), 6)
    if (posSlot < 4) return posSlot
    const numDirectBits = (posSlot >>> 1) - 1
    let dist = ((2 | (posSlot & 1)) << numDirectBits) >>> 0
    if (posSlot < END_POS_MODEL_INDEX) return dist + this.bitTreeReverse(POS_DECODERS + dist - posSlot, numDirectBits)
    dist = (dist + ((this.directBits(numDirectBits - ALIGN_BITS) << ALIGN_BITS) >>> 0)) >>> 0
    return (dist + this.bitTreeReverse(ALIGN, ALIGN_BITS)) >>> 0
  }
}

/**
 * Decodes a raw LZMA1 stream into exactly `expectedSize` bytes. An end marker may follow the data
 * or end it early (then the size is wrong and this throws); input that runs out, a distance past the
 * decoded bytes or a size mismatch is a typed DECOMPRESS_FAILED error.
 */
export function lzmaDecodeRaw(input: Uint8Array, props: LzmaProperties, expectedSize: number, ctx: InflateContext): Uint8Array {
  const fail = (at: number, message: string): FormatError =>
    new FormatError({
      code: FORMAT_ERROR_CODES.DECOMPRESS_FAILED,
      file: ctx.file,
      offset: ctx.offset + at,
      format: ctx.format,
      structure: ctx.structure,
      message: `LZMA: ${message}`,
      ...(ctx.version !== undefined ? { version: ctx.version } : {}),
    })
  const { lc, lp, pb } = props
  if (lc > 8 || lp > 4 || pb > 4) throw fail(0, `bad properties lc=${lc} lp=${lp} pb=${pb}`)
  if (input.length < 5) throw fail(0, `stream of ${input.length} bytes is shorter than the range coder start`)
  if (input[0] !== 0) throw fail(0, `first byte is ${input[0]}, a range coder stream starts with 0`)
  const out = new Uint8Array(expectedSize)
  const d = new Decoder(input, lc, lp)
  if (d.code === d.range) throw fail(1, 'corrupt range coder start')
  const pbMask = (1 << pb) - 1
  const lpMask = (1 << lp) - 1
  let outPos = 0
  let state = 0
  let rep0 = 0
  let rep1 = 0
  let rep2 = 0
  let rep3 = 0
  try {
    while (outPos < expectedSize) {
      const posState = outPos & pbMask
      if (d.bit(IS_MATCH + (state << 4) + posState) === 0) {
        const prev = outPos > 0 ? (out[outPos - 1] as number) : 0
        const base = LITERAL + 0x300 * (((outPos & lpMask) << lc) + (prev >>> (8 - lc)))
        let symbol = 1
        if (state >= 7) {
          let matchByte = out[outPos - rep0 - 1] as number
          do {
            const matchBit = (matchByte >>> 7) & 1
            matchByte <<= 1
            const b = d.bit(base + ((1 + matchBit) << 8) + symbol)
            symbol = (symbol << 1) | b
            if (matchBit !== b) break
          } while (symbol < 0x100)
        }
        while (symbol < 0x100) symbol = (symbol << 1) | d.bit(base + symbol)
        out[outPos++] = symbol - 0x100
        state = state < 4 ? 0 : state < 10 ? state - 3 : state - 6
        continue
      }
      let len: number
      if (d.bit(IS_REP + state) !== 0) {
        if (outPos === 0) throw new LzmaFailure('repeated match before any data', d.inPos)
        if (d.bit(IS_REP_G0 + state) === 0) {
          if (d.bit(IS_REP0_LONG + (state << 4) + posState) === 0) {
            state = state < 7 ? 9 : 11
            out[outPos] = out[outPos - rep0 - 1] as number
            outPos++
            continue
          }
        } else {
          let dist: number
          if (d.bit(IS_REP_G1 + state) === 0) {
            dist = rep1
          } else {
            if (d.bit(IS_REP_G2 + state) === 0) {
              dist = rep2
            } else {
              dist = rep3
              rep3 = rep2
            }
            rep2 = rep1
          }
          rep1 = rep0
          rep0 = dist
        }
        len = d.len(REP_LEN_CODER, posState)
        state = state < 7 ? 8 : 11
      } else {
        rep3 = rep2
        rep2 = rep1
        rep1 = rep0
        len = d.len(LEN_CODER, posState)
        state = state < 7 ? 7 : 10
        rep0 = d.distance(len)
        if (rep0 === 0xffffffff) throw new LzmaFailure(`end marker after ${outPos} of ${expectedSize} bytes`, d.inPos)
        if (rep0 >= outPos || rep0 >= props.dictSize) throw new LzmaFailure(`distance ${rep0 + 1} reaches before the start (${outPos} bytes decoded)`, d.inPos)
      }
      len += MATCH_MIN_LEN
      if (outPos + len > expectedSize) throw new LzmaFailure(`match of ${len} bytes at ${outPos} runs past the expected size ${expectedSize}`, d.inPos)
      // copyWithin is a memmove, but an LZMA match may overlap the bytes it produces (distance < len).
      const from = outPos - rep0 - 1
      if (rep0 + 1 >= len) out.copyWithin(outPos, from, from + len)
      else for (let i = 0; i < len; i++) out[outPos + i] = out[from + i] as number
      outPos += len
    }
  } catch (err) {
    if (err instanceof LzmaFailure) throw fail(err.at, err.message.startsWith('input ended') ? `${err.message} with ${outPos} of ${expectedSize} decoded` : err.message)
    throw err
  }
  return out
}
