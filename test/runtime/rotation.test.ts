import { describe, expect, it } from 'vitest'
import { filterIsOpen, mapFilter, passesFilter, Rotation } from '../../src/runtime/rotation.ts'

/** Picks `n` maps like the controller does: next, then mark as shown. */
function run(r: Rotation, n: number, eligible: (id: number) => boolean = () => true): (number | undefined)[] {
  const out: (number | undefined)[] = []
  for (let i = 0; i < n; i++) {
    const id = r.next(eligible)
    out.push(id)
    if (id !== undefined) r.markShown(id)
  }
  return out
}

describe('Rotation (spec 007 FR-011, research R7)', () => {
  it('shows every entry once per cycle and never the same entry twice in a row', () => {
    for (const count of [2, 3, 5, 17]) {
      for (const seed of [1, 7, 12345]) {
        const seq = run(new Rotation(count, seed), count * 6) as number[]
        for (let c = 0; c < 6; c++) expect(new Set(seq.slice(c * count, (c + 1) * count)).size, `count ${count} seed ${seed} cycle ${c}`).toBe(count)
        for (let i = 1; i < seq.length; i++) expect(seq[i], `count ${count} seed ${seed} at ${i}`).not.toBe(seq[i - 1])
      }
    }
  })

  it('the same seed gives the same sequence; another seed another one', () => {
    expect(run(new Rotation(9, 42), 27)).toEqual(run(new Rotation(9, 42), 27))
    expect(run(new Rotation(9, 42), 27)).not.toEqual(run(new Rotation(9, 43), 27))
  })

  it('a single entry keeps coming back; an empty catalogue gives nothing', () => {
    expect(run(new Rotation(1, 3), 4)).toEqual([0, 0, 0, 0])
    expect(run(new Rotation(0, 3), 2)).toEqual([undefined, undefined])
  })

  it('skips ineligible entries and reports when none is left', () => {
    const failed = new Set([1, 3])
    const seq = run(new Rotation(5, 9), 12, (id) => !failed.has(id)) as number[]
    expect(seq.every((id) => !failed.has(id))).toBe(true)
    expect(new Set(seq)).toEqual(new Set([0, 2, 4]))
    expect(run(new Rotation(4, 9), 3, () => false)).toEqual([undefined, undefined, undefined])
  })

  it('the only eligible entry is returned again even right after it was shown', () => {
    const r = new Rotation(4, 5)
    const only = run(r, 1)[0] as number
    expect(run(r, 3, (id) => id === only)).toEqual([only, only, only])
  })
})

describe('map filters (spec 007 FR-015, FR-016)', () => {
  const s = (sizeClass: 's' | 'm' | 'l' | 'xl' | 'h' | 'xh' | 'g', levels: 1 | 2) => ({ sizeClass, levels })

  it('size range is inclusive and swaps when given upside down', () => {
    const f = mapFilter({ mapsizemin: 'm', mapsizemax: 'xl', mapunderground: 'any' })
    expect(['s', 'm', 'l', 'xl', 'h'].map((c) => passesFilter(s(c as 's', 1), f))).toEqual([false, true, true, true, false])
    expect(mapFilter({ mapsizemin: 'xl', mapsizemax: 'm', mapunderground: 'any' })).toEqual(f)
  })

  it('underground rule', () => {
    const two = mapFilter({ mapsizemin: 's', mapsizemax: 'g', mapunderground: 'two' })
    const one = mapFilter({ mapsizemin: 's', mapsizemax: 'g', mapunderground: 'one' })
    expect([passesFilter(s('m', 2), two), passesFilter(s('m', 1), two)]).toEqual([true, false])
    expect([passesFilter(s('m', 2), one), passesFilter(s('m', 1), one)]).toEqual([false, true])
  })

  it('the default filter lets every map through', () => {
    const f = mapFilter({ mapsizemin: 's', mapsizemax: 'g', mapunderground: 'any' })
    expect(filterIsOpen(f)).toBe(true)
    for (const c of ['s', 'm', 'l', 'xl', 'h', 'xh', 'g'] as const) for (const l of [1, 2] as const) expect(passesFilter(s(c, l), f)).toBe(true)
  })
})
