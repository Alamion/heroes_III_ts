// Independent check of a capture's recorded pixel mapping: the project's terrain rendering at the
// recorded mapping must match the capture clearly better than at any one-tile shift
// (specs/003-map-objects/research.md §10, plan.md thresholds).

export interface MappingRender {
  /** RGBA of the viewport for a camera offset (world pixel at the viewport's top-left). */
  rgba: Uint8Array
  /** 1 = pixel may be compared (terrain that is neither animated nor covered by objects). */
  comparable: Uint8Array
}

export interface MappingCheckInput {
  width: number
  height: number
  /** Capture pixels of the viewport, `channels` per pixel, row-major. */
  capture: Uint8Array
  channels: number
  /** Camera offset implied by the recorded mapping. */
  offset: { x: number; y: number }
  tileSize: number
  render(offsetX: number, offsetY: number): MappingRender
}

export interface MappingCheck {
  ok: boolean
  comparedRecorded: number
  differingRecorded: number
  /** Shift in tiles with the fewest differing pixels (0, 0 when the recorded mapping is best). */
  bestShift: { dx: number; dy: number }
  bestDiffering: number
}

/** Fail when a shift has ≥ 5× fewer differences and the recorded mapping differs on > 1 %. */
export const MAPPING_THRESHOLDS = { shiftAdvantage: 5, recordedShare: 0.01 } as const

function differing(input: MappingCheckInput, r: MappingRender): { compared: number; differing: number } {
  let compared = 0
  let diff = 0
  const n = input.width * input.height
  for (let i = 0; i < n; i++) {
    if (r.comparable[i] !== 1) continue
    compared++
    const c = i * input.channels
    const g = i * 4
    if (input.capture[c] !== r.rgba[g] || input.capture[c + 1] !== r.rgba[g + 1] || input.capture[c + 2] !== r.rgba[g + 2]) diff++
  }
  return { compared, differing: diff }
}

export function verifyMapping(input: MappingCheckInput): MappingCheck {
  const recorded = differing(input, input.render(input.offset.x, input.offset.y))
  let best = { dx: 0, dy: 0, differing: recorded.differing, share: recorded.compared === 0 ? 1 : recorded.differing / recorded.compared }
  for (const dy of [-1, 0, 1]) {
    for (const dx of [-1, 0, 1]) {
      if (dx === 0 && dy === 0) continue
      const r = differing(input, input.render(input.offset.x + dx * input.tileSize, input.offset.y + dy * input.tileSize))
      const share = r.compared === 0 ? 1 : r.differing / r.compared
      if (share < best.share) best = { dx, dy, differing: r.differing, share }
    }
  }
  const recordedShare = recorded.compared === 0 ? 0 : recorded.differing / recorded.compared
  const shiftWins = (best.dx !== 0 || best.dy !== 0) && best.share * MAPPING_THRESHOLDS.shiftAdvantage <= recordedShare
  const ok = !(shiftWins && recordedShare > MAPPING_THRESHOLDS.recordedShare)
  return { ok, comparedRecorded: recorded.compared, differingRecorded: recorded.differing, bestShift: { dx: best.dx, dy: best.dy }, bestDiffering: best.differing }
}
