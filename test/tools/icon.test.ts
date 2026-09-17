import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ICON_SIZE, iconPixels, iconSvg } from '../../tools/package/icon.ts'

describe('project icon', () => {
  it('public/favicon.svg matches the generator (regenerate: node tools/package/icon.ts)', () => {
    expect(readFileSync(resolve(import.meta.dirname, '../../public/favicon.svg'), 'utf8')).toBe(iconSvg())
  })

  it('is a 32×32 image with transparent corners', () => {
    const px = iconPixels()
    expect(px).toHaveLength(ICON_SIZE * ICON_SIZE)
    expect(px[0]).toBeNull()
    expect(px[ICON_SIZE * ICON_SIZE - 1]).toBeNull()
  })
})
