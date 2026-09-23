import { describe, expect, it } from 'vitest'
import { LodArchive } from '../../../src/core/formats/lod/lod.ts'
import { decodeFrame, fullFramePixels, parseDef } from '../../../src/core/formats/def/def.ts'
import { parsePcx, pcxToRgba } from '../../../src/core/formats/pcx/pcx.ts'
import { parseObjectsTxt } from '../../../src/core/formats/text/objects-txt.ts'
import { MemorySource } from '../../../src/core/util/byte-source.ts'
import { FormatError } from '../../../src/core/util/errors.ts'
import { writeLod } from '../../fixtures/synthetic/lod.ts'
import { patternPixels, proceduralPalette, writeDef } from '../../fixtures/synthetic/def.ts'
import type { SyntheticFrame } from '../../fixtures/synthetic/def.ts'
import { writePcxBgr, writePcxIndexed } from '../../fixtures/synthetic/pcx.ts'

const enc = (s: string) => new TextEncoder().encode(s)

describe('LOD', () => {
  const a = enc('stored entry payload')
  const b = patternPixels(64, 64, 3)
  const lodBytes = writeLod([
    { name: 'Alpha.TXT', data: a },
    { name: 'beta.def', data: b, compress: true },
    { name: 'ALPHA.txt', data: enc('duplicate') },
    { name: 'empty.bin', data: new Uint8Array(0) },
  ])

  it('lists entries and extracts stored and compressed data byte-exact', async () => {
    const lod = await LodArchive.open(new MemorySource('test.lod', lodBytes))
    expect(lod.entries.map((e) => e.name)).toEqual(['Alpha.TXT', 'beta.def', 'ALPHA.txt', 'empty.bin'])
    expect(await lod.read('alpha.txt')).toEqual(a)
    expect(await lod.read('BETA.DEF')).toEqual(b)
    expect((await lod.read('empty.bin')).length).toBe(0)
    expect(lod.find('beta.def')?.compressedSize).toBeGreaterThan(0)
    expect(lod.warnings).toHaveLength(1)
  })

  it('rejects bad magic, truncated index and out-of-file entries', async () => {
    const bad = lodBytes.slice()
    bad[0] = 0x58
    await expect(LodArchive.open(new MemorySource('bad.lod', bad))).rejects.toMatchObject({ code: 'BAD_MAGIC' })
    await expect(LodArchive.open(new MemorySource('short.lod', lodBytes.slice(0, 100)))).rejects.toMatchObject({ code: 'TRUNCATED', offset: 92 })
    const cut = lodBytes.slice(0, lodBytes.length - 10)
    await expect(LodArchive.open(new MemorySource('cut.lod', cut))).rejects.toMatchObject({ code: 'TRUNCATED', structure: expect.stringContaining('entries[') })
  })

  it('reports missing entries and corrupt compressed data', async () => {
    const lod = await LodArchive.open(new MemorySource('test.lod', lodBytes))
    await expect(lod.read('nope.def')).rejects.toMatchObject({ code: 'NOT_FOUND' })
    const corrupt = lodBytes.slice()
    const entry = lod.find('beta.def')
    if (entry === undefined) throw new Error('fixture')
    corrupt.fill(0x55, entry.offset + 2, entry.offset + 20)
    const lod2 = await LodArchive.open(new MemorySource('corrupt.lod', corrupt))
    await expect(lod2.read('beta.def')).rejects.toBeInstanceOf(FormatError)
  })
})

describe('DEF', () => {
  const frame = (name: string, compression: 0 | 1 | 2 | 3, seed: number, w = 32, h = 32, x = 0, y = 0): SyntheticFrame => ({
    name,
    compression,
    width: w,
    height: h,
    x,
    y,
    pixels: patternPixels(w, h, seed),
  })

  it('decodes every compression type and keeps the view-index order across groups', () => {
    const frames0 = [frame('f0.pcx', 0, 1), frame('f1.pcx', 1, 2), frame('f2.pcx', 2, 3, 30, 20, 1, 5)]
    const frames1 = [frame('g0.pcx', 3, 4, 64, 32, 0, 0), frame('g1.pcx', 1, 5, 10, 7, 20, 25)]
    const bytes = writeDef({ fullWidth: 64, fullHeight: 32, groups: [{ type: 0, frames: frames0 }, { type: 1, frames: frames1 }] })
    const def = parseDef(bytes, 'syn.def')
    expect(def.groups).toHaveLength(2)
    expect(def.frameOrder.map((f) => f.name)).toEqual(['f0.pcx', 'f1.pcx', 'f2.pcx', 'g0.pcx', 'g1.pcx'])
    expect(def.frameOrder.map((f) => f.viewIndex)).toEqual([0, 1, 2, 3, 4])
    expect(def.palette).toEqual(proceduralPalette())
    const all = [...frames0, ...frames1]
    def.frameOrder.forEach((ref, i) => {
      const src = all[i] as SyntheticFrame
      const decoded = decodeFrame(def, ref)
      expect(decoded.compression).toBe(src.compression)
      expect([decoded.width, decoded.height, decoded.x, decoded.y]).toEqual([src.width, src.height, src.x, src.y])
      expect(decoded.pixels).toEqual(src.pixels)
    })
    const placed = fullFramePixels(decodeFrame(def, def.frameOrder[4] as never))
    expect(placed[25 * 64 + 20]).toBe(frames1[1]?.pixels[0])
    expect(placed[0]).toBe(0)
  })

  it('handles the old 16-byte frame header and repeated frame offsets', () => {
    const f = { ...frame('old.pcx', 1, 9), oldFormat: true }
    const bytes = writeDef({ fullWidth: 32, fullHeight: 32, groups: [{ type: 0, frames: [f, frame('dup.pcx', 0, 1)], aliases: { 1: 0 } }] })
    const def = parseDef(bytes, 'old.def')
    const [a, b] = def.frameOrder
    expect(a?.header).toBe(b?.header)
    expect(a?.header.dataOffset).toBe((a?.header.offset ?? 0) + 16)
    expect(decodeFrame(def, a as never).pixels).toEqual(f.pixels)
  })

  it('fails with offsets on corrupted runs and bad headers', () => {
    const bytes = writeDef({ fullWidth: 32, fullHeight: 32, groups: [{ type: 0, frames: [frame('a.pcx', 1, 2)] }] })
    const def = parseDef(bytes, 'c.def')
    const header = def.frameOrder[0]?.header
    if (header === undefined) throw new Error('fixture')
    const broken = bytes.slice()
    // First row offset → point past the frame data.
    new DataView(broken.buffer).setUint32(header.dataOffset, 0x7fffff, true)
    const err = (() => {
      try {
        decodeFrame(parseDef(broken, 'c.def'), header)
      } catch (e) {
        return e as FormatError
      }
      throw new Error('expected failure')
    })()
    expect(err).toBeInstanceOf(FormatError)
    expect(err.structure).toContain('compression 1')

    const badRect = bytes.slice()
    new DataView(badRect.buffer).setInt32(header.offset + 24, 10, true)
    expect(() => parseDef(badRect, 'r.def')).toThrow(/outside full size/)
    expect(() => parseDef(bytes.slice(0, 500), 't.def')).toThrow(FormatError)
  })
})

describe('PCX', () => {
  it('reads indexed and 24-bit images', () => {
    const palette = proceduralPalette(3)
    const px = patternPixels(5, 4, 1)
    const idx = parsePcx(writePcxIndexed(5, 4, px, palette), 'a.pcx')
    expect(idx.kind).toBe('indexed')
    expect(idx.pixels).toEqual(px)
    const rgba = pcxToRgba(idx)
    const i0 = (px[0] as number) * 3
    expect(Array.from(rgba.subarray(0, 4))).toEqual([palette[i0], palette[i0 + 1], palette[i0 + 2], 255])
    const bgr = parsePcx(writePcxBgr(2, 1, Uint8Array.of(1, 2, 3, 4, 5, 6)), 'b.pcx')
    expect(Array.from(pcxToRgba(bgr))).toEqual([3, 2, 1, 255, 6, 5, 4, 255])
  })

  it('rejects inconsistent size fields', () => {
    const bytes = writePcxBgr(2, 1, Uint8Array.of(1, 2, 3, 4, 5, 6))
    new DataView(bytes.buffer).setUint32(0, 7, true)
    expect(() => parsePcx(bytes, 'bad.pcx')).toThrow(FormatError)
  })
})

describe('Objects.txt', () => {
  const line = (def: string, cls: number, sub: number) =>
    `${def} 0${'1'.repeat(47)} 1${'0'.repeat(47)} 011111111 000000001 ${cls} ${sub} 2 0`

  it('parses template rows', () => {
    const text = ['2', line('AVWmon0.def', 54, 3), line('AVCcast0.def', 98, 0), ''].join('\r\n')
    const rows = parseObjectsTxt(enc(text))
    expect(rows).toHaveLength(2)
    expect(rows[0]).toMatchObject({ defName: 'AVWmon0.def', classId: 54, subclassId: 3, group: 2, isOverlay: false })
    // Character 0 is the bottom-right tile: byte 5, most significant bit.
    expect(Array.from(rows[0]?.passable ?? [])).toEqual([0xff, 0xff, 0xff, 0xff, 0xff, 0x7f])
    expect(Array.from(rows[0]?.active ?? [])).toEqual([0, 0, 0, 0, 0, 0x80])
    expect(rows[0]?.allowedTerrains).toBe(0b011111111)
    expect(rows[0]?.allowedTerrains & (1 << 8)).toBe(0)
  })

  it('reports malformed lines with line numbers', () => {
    expect(() => parseObjectsTxt(enc(['1', 'bad line'].join('\r\n')))).toThrow(/line 2/)
    expect(() => parseObjectsTxt(enc(['3', line('a.def', 1, 0)].join('\r\n')))).toThrow(FormatError)
  })
})
