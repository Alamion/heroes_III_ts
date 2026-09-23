// Rendering a HotA map from the owner's files (spec 005 FR-011, FR-012, FR-016, FR-017, SC-002).
//
// The map is rendered through the same headless page the fidelity checks use, so this exercises
// the real runtime: archive set, terrain tile sets, object atlas and draw order. It renders from
// the dev server: the preview server serves dist/, which a concurrently running browser test may
// be rebuilding.
// Skips with a message when the files are absent.

import { describe, expect, it } from 'vitest'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { gameDirs, requireGameFile } from '../../tools/shared/game-files.ts'
import { HeadlessRenderer } from '../../tools/shared/render-page.ts'

const map = requireGameFile('test_map_hota.h3m')
const sprites = requireGameFile('h3sprite.lod')
// Both installs may ship a HotA.lod and only the 1.8 one is obfuscated, so the archive is taken
// from the configured HotA install rather than by bare name.
const hotaDir = gameDirs().hotaDataDir
const hotaCandidate = hotaDir === undefined ? undefined : join(hotaDir, 'HotA.lod')
const hota = process.env.H3_HOTA_ARCHIVE ?? (hotaCandidate !== undefined && existsSync(hotaCandidate) ? hotaCandidate : null)
const ready = map !== null && sprites !== null && hota !== null
if (!ready) process.stderr.write('[real-file test skipped] HotA render: needs test_map_hota.h3m, h3sprite.lod and the HotA install\n')

describe.skipIf(!ready)('rendering test_map_hota.h3m', () => {
  it('draws the underground novelty zone with no unresolved object', async () => {
    const renderer = await HeadlessRenderer.open({ mode: 'dev', width: 640, height: 640 })
    try {
      const frame = await renderer.render({
        archive: sprites as string,
        hotaArchive: hota as string,
        map: map as string,
        width: 640,
        height: 640,
        level: 1,
        originTile: { x: 0, y: 100 },
        originPixel: { x: 0, y: 0 },
        step: 0,
        tick: 0,
        seed: 1,
        objects: true,
      })
      // Objects of the novelty zone are drawn ...
      expect(frame.stats.objectQuads as number).toBeGreaterThan(100)
      // ... and nothing was skipped for want of a sprite (FR-017).
      const unresolved = (frame.diagnostics ?? []).filter((d) => d.code === 'MISSING_SPRITE')
      expect(unresolved).toEqual([])
      // The frame is not blank: HotA terrain reached the atlas.
      const distinct = new Set<number>()
      for (let i = 0; i < frame.rgba.length; i += 4) distinct.add(((frame.rgba[i] as number) << 16) | ((frame.rgba[i + 1] as number) << 8) | (frame.rgba[i + 2] as number))
      expect(distinct.size).toBeGreaterThan(1000)
    } finally {
      await renderer.close()
    }
  }, 300_000)

  it('draws a surface region of the same map', async () => {
    const renderer = await HeadlessRenderer.open({ mode: 'dev', width: 512, height: 512 })
    try {
      const frame = await renderer.render({
        archive: sprites as string,
        hotaArchive: hota as string,
        map: map as string,
        width: 512,
        height: 512,
        level: 0,
        originTile: { x: 20, y: 20 },
        originPixel: { x: 0, y: 0 },
        step: 0,
        tick: 0,
        seed: 1,
        objects: true,
      })
      expect((frame.diagnostics ?? []).filter((d) => d.code === 'MISSING_SPRITE')).toEqual([])
    } finally {
      await renderer.close()
    }
  }, 300_000)
})
