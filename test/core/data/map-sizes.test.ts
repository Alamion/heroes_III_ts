import { describe, expect, it } from 'vitest'
import { compareSizeClass, isSizeClass, sizeClassOf } from '../../../src/core/data/map-sizes.ts'

describe('map size classes (spec 007 research R4)', () => {
  it('standard sizes map to their class, others to the next one up', () => {
    expect([36, 72, 108, 144, 180, 216, 252].map(sizeClassOf)).toEqual(['s', 'm', 'l', 'xl', 'h', 'xh', 'g'])
    expect([1, 37, 100, 145, 200, 217, 300].map(sizeClassOf)).toEqual(['s', 'm', 'l', 'h', 'xh', 'g', 'g'])
  })

  it('orders classes and recognises ids', () => {
    expect(compareSizeClass('s', 'g')).toBeLessThan(0)
    expect(compareSizeClass('xl', 'xl')).toBe(0)
    expect(isSizeClass('xh')).toBe(true)
    expect(isSizeClass('huge')).toBe(false)
  })
})
