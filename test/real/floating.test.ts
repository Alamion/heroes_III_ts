// SC-003: generated floating tiles for Arrogance contain the tiles found by hand in item 1.
import { describe, expect, it } from 'vitest'
import { requireGameFile } from '../../tools/shared/game-files.ts'
import { runTool } from '../fixtures/run-tool.ts'

const arrogance = requireGameFile('Arrogance.h3m')
const bitmaps = requireGameFile('h3bitmap.lod')
const sprites = requireGameFile('h3sprite.lod')

describe.skipIf(arrogance === null || bitmaps === null || sprites === null)('floating tiles on Arrogance (SC-003)', () => {
  it('include the hand-found random monster tiles', async () => {
    const r = await runTool('tools/inspect/cli.ts', ['map', 'floating', 'Arrogance.h3m', '--level', '0'])
    expect(r.code).toBe(0)
    const tiles = String(r.json.tiles).split(';')
    for (const t of ['20,24', '21,24', '20,25', '21,25']) expect(tiles).toContain(t)
  }, 120_000)
})
