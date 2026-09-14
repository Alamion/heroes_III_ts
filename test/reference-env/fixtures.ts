// Synthetic fixtures for reference-env unit tests. No game data.
import type { CaptureRecord } from '../../tools/reference-env/model/types.ts'

export const HASH_A = 'a'.repeat(64)
export const HASH_B = 'b'.repeat(64)

export function makeRecord(overrides: Partial<CaptureRecord> = {}): CaptureRecord {
  return {
    schemaVersion: 1,
    id: '2026-09-14T10-00-00-000Z_x0-18_y0-17',
    createdAt: '2026-09-14T10:00:00.000Z',
    source: 'game',
    kind: 'still',
    map: { name: 'Test.h3m', key: 'Test-aaaaaaaa', sha256: HASH_A, sizeTiles: 36, hasUnderground: true, formatVersion: 'SoD' },
    level: 0,
    requested: { x: 10, y: 12 },
    visible: { x0: 1, y0: 3, x1: 19, y1: 21, partialEdges: [] },
    mapping: { tileSize: 32, originTile: { x: 1, y: 3 }, originPixel: { x: 8, y: 8 }, viewport: { x: 8, y: 8, w: 592, h: 544 } },
    positionSource: 'minimap-rect',
    startSetup: { mode: 'fixed', choices: { town: 'first-listed', hero: 'first-listed', bonus: 'gold' } },
    visibility: { method: 'cheat', code: 'nwcwhatisthematrix', verified: true },
    cursor: { drawnByX: false, parkedAt: { x: 700, y: 590 } },
    executable: { file: 'Heroes3.exe', sha256: HASH_B, label: 'Heroes3.exe (original)' },
    archives: [{ file: 'Data/h3sprite.lod', sha256: HASH_A }],
    settings: { profileId: 'test', values: {} },
    display: { width: 800, height: 600, depth: 24 },
    files: { still: 'still.png', volatileMask: 'volatile-mask.png' },
    tooling: { version: '0.0.1', gitCommit: 'abc', wine: 'wine-11', ffmpeg: '7', xvfb: '21', xdotool: '3' },
    ...overrides,
  }
}
