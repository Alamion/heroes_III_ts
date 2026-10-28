// How much of a view map objects occupy (spec 009, research R2): a summed-area table over the tiles
// each object's template marks as blocked or visitable. It is built from the map alone, so a random
// place is known as soon as the terrain is and never moves when sprites arrive. The idea of scoring
// candidate views by object coverage comes from h3lwp (GPL-3.0, studied only); the definition is ours.

import { HIDDEN_CLASSES } from '../data/object-classes.ts'
import { TILE_SIZE } from '../data/terrain.ts'
import type { WorldState } from './world.ts'

export interface CoverageGrid {
  readonly size: number
  readonly levels: number
  /** levels × (size + 1)²; entry (z, y, x) = covered tiles in rows < y and columns < x of level z. */
  readonly sums: Uint32Array
}

/** The camera fields a coverage needs (structural, so this layer does not import render). */
export interface CoverageView {
  readonly level: number
  readonly offsetX: number
  readonly offsetY: number
  readonly width: number
  readonly height: number
  readonly scale: number
}

export function coverageGrid(world: Pick<WorldState, 'size' | 'levels' | 'objects'>): CoverageGrid {
  const n = world.size
  const covered = new Uint8Array(world.levels * n * n)
  for (const o of world.objects.values()) {
    if (HIDDEN_CLASSES.has(o.classId) || o.z < 0 || o.z >= world.levels) continue
    const { passable, active } = o.template
    for (let row = 0; row < 6; row++) {
      const y = o.y + row - 5
      if (y < 0 || y >= n) continue
      // Blocked (passable bit clear) or visitable (active bit set); bit b is column x + b − 7.
      const marks = (~(passable[row] ?? 0xff) | (active[row] ?? 0)) & 0xff
      if (marks === 0) continue
      for (let bit = 0; bit < 8; bit++) {
        if ((marks & (1 << bit)) === 0) continue
        const x = o.x + bit - 7
        if (x >= 0 && x < n) covered[(o.z * n + y) * n + x] = 1
      }
    }
  }
  const w = n + 1
  const sums = new Uint32Array(world.levels * w * w)
  for (let z = 0; z < world.levels; z++) {
    const base = z * w * w
    for (let y = 0; y < n; y++) {
      let row = 0
      for (let x = 0; x < n; x++) {
        row += covered[(z * n + y) * n + x] as number
        sums[base + (y + 1) * w + x + 1] = (sums[base + y * w + x + 1] as number) + row
      }
    }
  }
  return { size: n, levels: world.levels, sums }
}

/** Covered tiles in the inclusive tile rectangle, clamped to the map. */
export function coveredTiles(grid: CoverageGrid, z: number, x0: number, y0: number, x1: number, y1: number): number {
  const n = grid.size
  if (z < 0 || z >= grid.levels) return 0
  const ax = Math.max(0, x0)
  const ay = Math.max(0, y0)
  const bx = Math.min(n - 1, x1)
  const by = Math.min(n - 1, y1)
  if (ax > bx || ay > by) return 0
  const w = n + 1
  const s = grid.sums
  const base = z * w * w
  const at = (x: number, y: number): number => s[base + y * w + x] as number
  return at(bx + 1, by + 1) - at(ax, by + 1) - at(bx + 1, ay) + at(ax, ay)
}

/** The view's tile rectangle (may reach past the map edge). */
export function viewTiles(view: CoverageView): { x0: number; y0: number; x1: number; y1: number } {
  const w = view.width / view.scale
  const h = view.height / view.scale
  return {
    x0: Math.floor(view.offsetX / TILE_SIZE),
    y0: Math.floor(view.offsetY / TILE_SIZE),
    x1: Math.floor((view.offsetX + w - 1) / TILE_SIZE),
    y1: Math.floor((view.offsetY + h - 1) / TILE_SIZE),
  }
}

/**
 * Share 0..1 of the view's tiles that objects cover. Tiles past the map edge count as uncovered, but
 * along an axis where the whole map fits in the view only the map's extent is counted: no place can
 * avoid that black, so it must not sink every candidate of a small map (research R2).
 */
export function viewCoverage(grid: CoverageGrid, view: CoverageView): number {
  const t = viewTiles(view)
  const cols = Math.min(t.x1 - t.x0 + 1, grid.size)
  const rows = Math.min(t.y1 - t.y0 + 1, grid.size)
  if (cols <= 0 || rows <= 0) return 0
  return Math.min(1, coveredTiles(grid, view.level, t.x0, t.y0, t.x1, t.y1) / (cols * rows))
}
