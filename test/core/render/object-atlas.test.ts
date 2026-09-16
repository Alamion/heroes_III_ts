import { describe, expect, it } from 'vitest'
import { decodeFrame } from '../../../src/core/formats/def/def.ts'
import { buildObjectAtlas, objectAtlasGpuBytes } from '../../../src/core/render/object-atlas.ts'
import { SHADOW_KINDS, SHADOW_MARKER_ALPHA } from '../../../src/core/data/animation.ts'
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

  it('reports overflow with sizes and counts GPU bytes', () => {
    expect(() => buildObjectAtlas(defs, 256, 1)).toThrow(/more than 1 256² pages/)
    expect(objectAtlasGpuBytes(atlas.layout)).toBe(atlas.layout.pageCount * 2048 * 2048 + 256 * atlas.layout.rowCount * 4)
  })
})
