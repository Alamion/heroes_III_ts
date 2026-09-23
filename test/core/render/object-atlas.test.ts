import { describe, expect, it } from 'vitest'
import { decodeFrame } from '../../../src/core/formats/def/def.ts'
import { buildObjectAtlas, objectAtlasGpuBytes } from '../../../src/core/render/object-atlas.ts'
import { SHADOW_KINDS, SHADOW_MARKER_ALPHA, isShadowMarker } from '../../../src/core/data/animation.ts'
import { parseDef } from '../../../src/core/formats/def/def.ts'
import { objectPalette, writeObjectDef } from '../../fixtures/synthetic/object-defs.ts'
import { objectScene } from './objects-helpers.ts'

describe('object atlas', async () => {
  const { defs, atlas } = await objectScene()

  it('is deterministic and independent of input order', () => {
    const again = buildObjectAtlas([...defs].reverse())
    expect(again.layout).toEqual(atlas.layout)
    expect(again.pages.map((p) => Buffer.from(p).toString('base64'))).toEqual(atlas.pages.map((p) => Buffer.from(p).toString('base64')))
  })

  it('stores cropped frames at their offsets with pixels intact', () => {
    for (const def of defs) {
      const sprite = atlas.layout.sprites[def.name.toLowerCase()]
      expect(sprite).toBeDefined()
      def.groups.forEach((g, gi) =>
        g.frames.forEach((ref, fi) => {
          const cell = sprite?.groups[gi]?.[fi]
          const frame = decodeFrame(def, ref)
          expect([cell?.width, cell?.height, cell?.x, cell?.y]).toEqual([frame.width, frame.height, frame.x, frame.y])
          const page = atlas.pages[cell?.page as number] as Uint8Array
          for (const [x, y] of [[0, 0], [frame.width - 1, frame.height - 1], [frame.width >> 1, frame.height >> 1]] as const) {
            expect(page[((cell?.v as number) + y) * atlas.layout.pageSize + (cell?.u as number) + x]).toBe(frame.pixels[y * frame.width + x])
          }
        }),
      )
    }
  })

  it('shares cells for frames with the same data offset', () => {
    const def = defs.find((d) => d.frameOrder.length > 1) as (typeof defs)[number]
    const cells = atlas.layout.sprites[def.name.toLowerCase()]?.groups.flat() ?? []
    const offsets = def.groups.flatMap((g) => g.frames.map((f) => f.header.offset))
    offsets.forEach((o, i) => offsets.forEach((p, j) => {
      if (o === p) expect(cells[i]).toEqual(cells[j])
    }))
  })

  it('makes index 0 transparent and marks shadow kinds in the alpha channel', () => {
    for (const [i, kind] of SHADOW_KINDS) expect(Array.from(atlas.palettes.subarray(i * 4, i * 4 + 4))).toEqual([0, 0, 0, SHADOW_MARKER_ALPHA[kind]])
    expect(atlas.palettes[3]).toBe(0)
  })

  it('treats a special index as a colour when the sprite does not mark it as a shadow', () => {
    // Most HotA sprites keep ordinary colours at 2, 3, 6 and 7; the game draws them opaque.
    const palette = objectPalette(9)
    const colours: Record<number, [number, number, number]> = { 2: [7, 2, 2], 3: [14, 17, 0], 6: [24, 4, 3], 7: [23, 19, 5] }
    for (const [i, c] of Object.entries(colours)) palette.set(c, Number(i) * 3)
    const def = parseDef(writeObjectDef({ width: 64, height: 64, frames: 1, seed: 9, shadow: true, palette }), 'hotalike.def')
    const own = buildObjectAtlas([def])
    const row = own.layout.sprites['hotalike.def']?.row as number
    const entry = (i: number): number[] => Array.from(own.palettes.subarray((row * 256 + i) * 4, (row * 256 + i) * 4 + 4))
    for (const i of [2, 3, 6, 7]) expect(entry(i)[3]).toBe(255)
    // The marked indices of the same sprite stay shadows.
    expect(entry(1)).toEqual([0, 0, 0, SHADOW_MARKER_ALPHA.light])
    expect(entry(4)).toEqual([0, 0, 0, SHADOW_MARKER_ALPHA.dark])
  })

  it('recognises the marker colours, including the one-off reef marker, and nothing else', () => {
    const markers: [number, number, number][] = [[255, 150, 255], [255, 151, 255], [255, 100, 255], [255, 50, 255], [255, 0, 255], [180, 0, 255], [0, 255, 0]]
    for (const [r, g, b] of markers) expect(isShadowMarker(r, g, b)).toBe(true)
    const colours: [number, number, number][] = [[7, 2, 2], [24, 4, 3], [163, 180, 198], [255, 0, 0], [128, 0, 0]]
    for (const [r, g, b] of colours) expect(isShadowMarker(r, g, b)).toBe(false)
  })

  it('reports overflow with sizes and counts GPU bytes', () => {
    expect(() => buildObjectAtlas(defs, 256, 1)).toThrow(/more than 1 256² pages/)
    expect(objectAtlasGpuBytes(atlas.layout)).toBe(atlas.layout.pageCount * 2048 * 2048 + 256 * atlas.layout.rowCount * 4)
  })
})
