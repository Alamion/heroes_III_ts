// Project icon (constitution I: original art, no game imagery or logos): a 32×32 pixel-art island of
// map tiles — grass, a river, a dirt road and a player flag — defined procedurally. The favicon
// (public/favicon.svg) and the package previews are rendered from the same pixels.
//
// node tools/package/icon.ts   rewrites public/favicon.svg

import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export const ICON_SIZE = 32

type Rgb = readonly [number, number, number]

const GRASS: readonly Rgb[] = [
  [79, 138, 46],
  [96, 156, 56],
]
const SIDE_LEFT: Rgb = [122, 85, 48]
const SIDE_RIGHT: Rgb = [94, 63, 34]
const RIVER: Rgb = [47, 111, 179]
const RIVER_LIGHT: Rgb = [98, 158, 222]
const ROAD: Rgb = [176, 138, 82]
const POLE: Rgb = [70, 48, 28]
const FLAG: Rgb = [200, 48, 44]
const FLAG_DARK: Rgb = [150, 30, 30]
const OUTLINE: Rgb = [26, 18, 12]

/** Icon pixels, row-major; `null` is transparent. */
export function iconPixels(): (Rgb | null)[] {
  const n = ICON_SIZE
  const px: (Rgb | null)[] = new Array<Rgb | null>(n * n).fill(null)
  const cx = 16
  const cy = 15
  const hw = 15
  const hh = 8
  const depth = 5
  const inTop = (x: number, y: number) => Math.abs(x - cx) / hw + Math.abs(y - cy) / hh <= 1
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = x + 0.5
      const fy = y + 0.5
      if (inTop(fx, fy)) {
        // Diamond axes: a runs along the river, b across it; 4×4 tiles in a checker.
        const a = (fx - cx) / hw + (fy - cy) / hh
        const b = (fy - cy) / hh - (fx - cx) / hw
        const tile = Math.floor((a + 1) * 2) + Math.floor((b + 1) * 2)
        let c = GRASS[tile & 1] as Rgb
        if (Math.abs(b + 0.52) < 0.09) c = ROAD
        const r = b - 0.35 * Math.sin(a * 3) - 0.18
        if (Math.abs(r) < 0.17) c = r > 0.06 ? RIVER_LIGHT : RIVER
        px[y * n + x] = c
        continue
      }
      for (let k = 1; k <= depth; k++) {
        if (fy > cy && inTop(fx, fy - k)) {
          px[y * n + x] = fx < cx ? SIDE_LEFT : SIDE_RIGHT
          break
        }
      }
    }
  }
  // Flag on a pole, standing on the grass.
  for (let y = 2; y <= 13; y++) px[y * n + 22] = POLE
  for (let y = 2; y <= 6; y++) {
    for (let x = 23; x <= 28; x++) {
      const notch = x >= 27 && y === 4
      if (!notch) px[y * n + x] = y === 6 || x === 28 ? FLAG_DARK : FLAG
    }
  }
  // One-pixel dark outline around everything opaque.
  const out = px.slice()
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      if (px[y * n + x] !== null) continue
      const near = [
        [x - 1, y],
        [x + 1, y],
        [x, y - 1],
        [x, y + 1],
      ].some(([nx, ny]) => nx! >= 0 && ny! >= 0 && nx! < n && ny! < n && px[ny! * n + nx!] !== null)
      if (near) out[y * n + x] = OUTLINE
    }
  }
  return out
}

const hex = (c: Rgb): string => `#${c.map((v) => v.toString(16).padStart(2, '0')).join('')}`

/** The icon as a crisp-edged SVG: one rect per horizontal run of one colour. */
export function iconSvg(): string {
  const n = ICON_SIZE
  const px = iconPixels()
  const rects: string[] = []
  for (let y = 0; y < n; y++) {
    let x = 0
    while (x < n) {
      const c = px[y * n + x]
      if (c === null || c === undefined) {
        x++
        continue
      }
      let end = x + 1
      while (end < n && px[y * n + end] === c) end++
      rects.push(`<rect x="${x}" y="${y}" width="${end - x}" height="1" fill="${hex(c)}"/>`)
      x = end
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${n} ${n}" width="${n}" height="${n}" shape-rendering="crispEdges">\n${rects.join('\n')}\n</svg>\n`
}

if (import.meta.url === `file://${process.argv[1]}`) {
  writeFileSync(resolve(import.meta.dirname, '../../public/favicon.svg'), iconSvg())
}
