// Pixels that change over a short sequence of grabs (animation, palette cycling).

export function buildVolatileMask(frames: Buffer[], width: number, height: number): Buffer {
  const mask = Buffer.alloc(width * height)
  const first = frames[0]
  if (first === undefined) return mask
  for (const f of frames.slice(1)) {
    for (let p = 0; p < width * height; p++) {
      const i = p * 3
      if (f[i] !== first[i] || f[i + 1] !== first[i + 1] || f[i + 2] !== first[i + 2]) mask[p] = 255
    }
  }
  return mask
}

export interface MaskedComparison {
  compared: number
  differing: number
}

/** Compares two RGB frames of equal size, ignoring pixels set in either mask (masks optional). */
export function compareWithMasks(a: Buffer, b: Buffer, width: number, height: number, maskA?: Buffer, maskB?: Buffer): MaskedComparison {
  let compared = 0
  let differing = 0
  for (let p = 0; p < width * height; p++) {
    if ((maskA !== undefined && maskA[p] !== 0) || (maskB !== undefined && maskB[p] !== 0)) continue
    compared++
    const i = p * 3
    if (a[i] !== b[i] || a[i + 1] !== b[i + 1] || a[i + 2] !== b[i + 2]) differing++
  }
  return { compared, differing }
}

/** Crops a 1-byte-per-pixel mask. */
export function cropMask(mask: Buffer, width: number, rect: { x: number; y: number; w: number; h: number }): Buffer {
  const out = Buffer.alloc(rect.w * rect.h)
  for (let y = 0; y < rect.h; y++) {
    const src = (rect.y + y) * width + rect.x
    mask.copy(out, y * rect.w, src, src + rect.w)
  }
  return out
}

/** Tiles (in view-relative 32 px cells from `origin`) that contain unmasked differing pixels. */
export function differingCells(a: Buffer, b: Buffer, width: number, height: number, maskA: Buffer, maskB: Buffer, origin: { x: number; y: number }): Record<string, number> {
  const cells: Record<string, number> = {}
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x
      if (maskA[p] !== 0 || maskB[p] !== 0) continue
      const i = p * 3
      if (a[i] === b[i] && a[i + 1] === b[i + 1] && a[i + 2] === b[i + 2]) continue
      const key = `${Math.floor((x - origin.x) / 32)},${Math.floor((y - origin.y) / 32)}`
      cells[key] = (cells[key] ?? 0) + 1
    }
  }
  return cells
}
