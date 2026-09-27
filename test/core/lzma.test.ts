// Raw LZMA1 decoder (spec 008 FR-009): an independent vector from liblzma, and round trips through
// the synthetic encoder for every packet kind.

import { describe, expect, it } from 'vitest'
import { HOTA_LZMA_PROPERTIES, lzmaDecodeRaw } from '../../src/core/util/lzma.ts'
import { lzmaEncodeRaw } from '../fixtures/synthetic/lzma.ts'

const ctx = { file: 'test.lzma', format: 'lod' as const, offset: 0, structure: 'entry' }
const decode = (bytes: Uint8Array, size: number): Uint8Array => lzmaDecodeRaw(bytes, HOTA_LZMA_PROPERTIES, size, ctx)

/**
 * Python's lzma (liblzma 5): FORMAT_RAW, FILTER_LZMA1, preset 6, dict 16 MiB, lc 3 lp 0 pb 2 — the
 * decoder settings of hota-lod-convert — with liblzma's end marker. Input: see `vectorInput`.
 */
const LIBLZMA_VECTOR =
  'ADkby1Agn62haACyTEPdyD0tNSetGLxGy5Id4Qq012vN9uu1b8vBSyBUheaC+waPju+E/YCRFxzwlcezIOkBC/g4ZwxjFIchmzgmYk5DD0aB7Qg1wTl26n29z5Z6vrLGtlPPsk0ZwmH7wwWEiPDLgK42n2xZQOlBx11qL3rSeDJQawdKFTmAtheec28qIrVnCbjLF2xhq9/rxpnvobfxD6mAms+XFYbN/nGPVKyH9swR6gcBIn4abJ/hNnh3wSYlMzk9ZBQqRuTWiAM02gL0lBHywOv8TwrRO28YaC9jEDlE88vB68jC1mA6dh6hIGp9YqxmGW+LxkYMpkt2W7TEdaz7ZgraBznBekYYkktib4daMXooO4sjQ6SD51K0ZHlZYgbE6+0Gm5oVOBeqyYBBVhd+nygifdADPMwHocUnbL78JCosz5EuGazpTXgicLaXWIje7NpnJtuhzbHTq4Ng2q85tXXTliiTELtiECu2Dsm6ZDbRkikL7kKINqLlBBoJzUMM0HxsCYTaXEv857JgAyylJGbiUAraJ0v9c9MnZwpVlAvYYqDHmLmvBsdCIl/2b3fVpjdJZex5XIdAbPqHn8Wie/CwLszBtTf8TXseMmbRik88ehUzCQma7k1UvTcJofw92/+QgKBj///tMS5x'
const vectorInput = (): Uint8Array =>
  new TextEncoder().encode(Array.from({ length: 300 }, (_, i) => `row ${i % 23} value ${(i * 7919) % 101};`).join(''))

function pseudoRandom(length: number, seed: number, alphabet = 256): Uint8Array {
  const out = new Uint8Array(length)
  let x = seed >>> 0
  for (let i = 0; i < length; i++) {
    x = (x * 1664525 + 1013904223) >>> 0
    out[i] = (x >>> 24) % alphabet
  }
  return out
}

describe('lzmaDecodeRaw', () => {
  it('decodes a liblzma stream byte for byte', () => {
    const expected = vectorInput()
    expect(expected.length).toBe(4642)
    expect(decode(Uint8Array.from(Buffer.from(LIBLZMA_VECTOR, 'base64')), expected.length)).toEqual(expected)
  })

  it.each([
    ['empty', new Uint8Array(0)],
    ['one byte', new Uint8Array([7])],
    ['runs', new TextEncoder().encode('abc'.repeat(2000))],
    ['incompressible', pseudoRandom(5000, 1)],
    ['two symbols', pseudoRandom(20_000, 2, 2)],
    ['long distances', (() => {
      const b = pseudoRandom(300_000, 3, 16)
      for (let k = 0; k < 50; k++) b.copyWithin((k * 5813) % 290_000, (k * 104_729) % 290_000, ((k * 104_729) % 290_000) + 3000)
      return b
    })()],
  ])('round-trips %s, with and without an end marker', (_label, data) => {
    for (const endMarker of [false, true]) expect(decode(lzmaEncodeRaw(data, { endMarker }), data.length)).toEqual(data)
  })

  it('fails with a typed error on a cut stream, a wrong size and a bad start', () => {
    const data = pseudoRandom(4000, 4, 8)
    const enc = lzmaEncodeRaw(data, { endMarker: true })
    expect(() => decode(enc.subarray(0, enc.length >> 1), data.length)).toThrow(expect.objectContaining({ code: 'DECOMPRESS_FAILED', message: expect.stringContaining('input ended') }))
    expect(() => decode(enc, data.length + 10)).toThrow(expect.objectContaining({ code: 'DECOMPRESS_FAILED', message: expect.stringContaining('end marker') }))
    const bad = enc.slice()
    bad[0] = 1
    expect(() => decode(bad, data.length)).toThrow(expect.objectContaining({ code: 'DECOMPRESS_FAILED' }))
  })
})
