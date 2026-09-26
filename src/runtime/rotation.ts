// Map rotation and filters (spec 007 research R7, data-model "Rotation", "MapFilter"). DOM-free and
// seeded: the same seed and catalogue give the same sequence of maps.

import { compareSizeClass } from '../core/data/map-sizes.ts'
import type { SizeClass } from '../core/data/map-sizes.ts'
import type { MapSummary } from '../core/formats/h3m/summary.ts'
import { createRng, hashInts } from '../core/util/rng.ts'

/** Which maps the underground rule lets through (the `mapunderground` setting). */
export type UndergroundFilter = 'any' | 'two' | 'one'

export interface MapFilter {
  sizeMin: SizeClass
  sizeMax: SizeClass
  underground: UndergroundFilter
}

/** The filter of the settings; a minimum above the maximum is read as the same range swapped. */
export function mapFilter(s: { mapsizemin: SizeClass; mapsizemax: SizeClass; mapunderground: UndergroundFilter }): MapFilter {
  const swapped = compareSizeClass(s.mapsizemin, s.mapsizemax) > 0
  return { sizeMin: swapped ? s.mapsizemax : s.mapsizemin, sizeMax: swapped ? s.mapsizemin : s.mapsizemax, underground: s.mapunderground }
}

export function passesFilter(summary: Pick<MapSummary, 'sizeClass' | 'levels'>, f: MapFilter): boolean {
  if (compareSizeClass(summary.sizeClass, f.sizeMin) < 0 || compareSizeClass(summary.sizeClass, f.sizeMax) > 0) return false
  if (f.underground === 'two') return summary.levels === 2
  if (f.underground === 'one') return summary.levels === 1
  return true
}

export const filterIsOpen = (f: MapFilter): boolean => f.sizeMin === 's' && f.sizeMax === 'g' && f.underground === 'any'

/**
 * Cycles through `count` entries in a seeded random order: every eligible entry once per cycle, and
 * never the entry shown last twice in a row while another one is eligible (FR-011).
 */
export class Rotation {
  readonly count: number
  private readonly seed: number
  private order: number[] = []
  private cursor = 0
  private cycle = -1
  private last: number | null = null

  constructor(count: number, seed: number) {
    this.count = count
    this.seed = seed >>> 0
  }

  private shuffle(): void {
    this.cycle++
    const rng = createRng(hashInts(this.seed, this.cycle))
    const order = Array.from({ length: this.count }, (_, i) => i)
    for (let i = order.length - 1; i > 0; i--) {
      const j = rng.int(i + 1)
      ;[order[i], order[j]] = [order[j] as number, order[i] as number]
    }
    this.order = order
    this.cursor = 0
  }

  /**
   * The next entry for which `eligible` holds, or undefined when none does. The entry shown last is
   * moved to the end of its cycle instead of being returned again right away; it is returned only when
   * no other entry is eligible.
   */
  next(eligible: (id: number) => boolean): number | undefined {
    if (this.count === 0) return undefined
    if (this.cycle < 0) this.shuffle()
    const others = (): boolean => {
      for (let id = 0; id < this.count; id++) if (id !== this.last && eligible(id)) return true
      return false
    }
    // The rest of this cycle, then one full new cycle (plus the deferred entry): every entry is looked at.
    for (let step = 0; step <= this.count * 2 + 1; step++) {
      if (this.cursor >= this.order.length) this.shuffle()
      const id = this.order[this.cursor++] as number
      if (!eligible(id)) continue
      if (id === this.last && this.count > 1 && others()) {
        // Later in this cycle if another eligible entry follows; otherwise it waits for the next cycle.
        if (this.order.slice(this.cursor).some((o) => o !== id && eligible(o))) this.order.push(id)
        continue
      }
      return id
    }
    return undefined
  }

  markShown(id: number): void {
    this.last = id
  }

  get shownLast(): number | null {
    return this.last
  }
}
