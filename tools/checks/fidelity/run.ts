// Runs one fidelity comparison (still or clip) against the real renderer in headless Chromium.

import { TILE_SIZE } from '../../../src/core/data/terrain.ts'
import { PALETTE_STEP_MS } from '../../../src/core/data/palette-rotation.ts'
import { CHECK_THRESHOLDS } from '../../../src/core/data/thresholds.ts'
import { visibleRange } from '../../../src/core/render/camera.ts'
import { buildDrawPlan } from '../../../src/core/render/draw-plan.ts'
import { rasterize, rasterizeRows } from '../../../src/core/render/software.ts'
import { palettesAt } from '../../../src/core/render/palette.ts'
import { animationStateCount } from '../../../src/core/render/palette.ts'
import { className } from '../../../src/core/data/object-classes.ts'
import { coveredPixels, tileKey } from '../../../src/core/state/footprint.ts'
import type { Region } from '../../shared/cli-runner.ts'
import type { HeadlessRenderer } from '../../shared/render-page.ts'
import type { LoadedCapture, UiMask } from './captures.ts'
import { classifyPixels, countDiffs, decideOutcome, diffImage, evaluateClipSteps, PIXEL, samePixel, tileStats } from './compare.ts'
import type { CaptureSampler, Outcome, TileStat } from './compare.ts'
import type { MapContext } from './masks.ts'

export interface FidelityResult {
  outcome: Outcome
  /** GPU frame at the chosen global step equals the reference rasterizer's (bit-exact). */
  gpuMatchesReference: boolean
  paletteStep: number
  /** Stills only: step chosen per animated sprite (may be ±1 from paletteStep, see research.md §5). */
  paletteStepsBySprite?: Record<string, number>
  pixels: { inMap: number; compared: number; comparedAnimated: number; differing: number; excluded: Record<string, number> }
  tiles: TileStat[]
  randomCauses: { kind: 'randomObject' | 'generatedHero'; objectIndex?: number; classId?: number; className?: string; player?: number; x: number; y: number; excludedPixels: number }[]
  clip?: { steps: { frame: number; tStartMs: number; paletteStep: number | null; differing: number }[]; stepMsMeasured: number; stepMsExpected: number; pass: boolean }
  diff: { width: number; height: number; rgba: Uint8Array }
}

function regionForView(offsetX: number, offsetY: number, width: number, height: number): Region {
  return { x0: Math.floor(offsetX / TILE_SIZE), y0: Math.floor(offsetY / TILE_SIZE), x1: Math.floor((offsetX + width - 1) / TILE_SIZE), y1: Math.floor((offsetY + height - 1) / TILE_SIZE) }
}

export async function runFidelity(opts: {
  capture: LoadedCapture
  ctx: MapContext
  renderer: HeadlessRenderer
  region: Region | undefined
  ui: UiMask | null
  /** false: skip the GPU cross-check (misregistration probing). */
  verifyGpu?: boolean
}): Promise<FidelityResult> {
  const { capture, ctx, renderer } = opts
  const rec = capture.record
  const vp = rec.mapping.viewport
  const level = rec.level
  // Camera: world pixel at the viewport's top-left.
  const offsetX = rec.mapping.originTile.x * TILE_SIZE - (rec.mapping.originPixel.x - vp.x)
  const offsetY = rec.mapping.originTile.y * TILE_SIZE - (rec.mapping.originPixel.y - vp.y)
  const region = opts.region ?? regionForView(offsetX, offsetY, vp.w, vp.h)
  const plan = buildDrawPlan(ctx.state, ctx.atlas.layout, level, visibleRange({ level, offsetX, offsetY, width: vp.w, height: vp.h, scale: 1 }, 1))
  const pw = plan.range.x1 - plan.range.x0 + 1
  const animatedTile = (tx: number, ty: number): boolean => {
    const lx = tx - plan.range.x0
    const ly = ty - plan.range.y0
    return lx >= 0 && ly >= 0 && lx < pw && plan.animatedTileMask[ly * pw + lx] === 1
  }
  // Viewport-cropped masks.
  const crop = (screen: Uint8Array | null, stride: number): Uint8Array | null => {
    if (screen === null) return null
    const out = new Uint8Array(vp.w * vp.h)
    for (let y = 0; y < vp.h; y++) out.set(screen.subarray((y + vp.y) * stride + vp.x, (y + vp.y) * stride + vp.x + vp.w), y * vp.w)
    return out
  }
  const stride = rec.display.width
  const volatile = capture.kind === 'still' ? crop(capture.volatile, stride) : null
  const ui = opts.ui !== null && opts.ui.width === vp.w && opts.ui.height === vp.h ? opts.ui.mask : null
  const floating = ctx.floating.levels[level]
  const ex = classifyPixels({ width: vp.w, height: vp.h, offsetX, offsetY, mapSize: ctx.state.size, region, ui, volatile, objects: ctx.objects[level] ?? new Map(), floating: floating?.footprint ?? new Map(), animatedTile })

  const states = animationStateCount()
  const cam = { level, offsetX, offsetY, width: vp.w, height: vp.h, scale: 1 }
  // The animation-state search uses the reference rasterizer (bit-exact with the WebGL renderer,
  // verified below for the chosen state), so up to 72 states per view need no page round trips.
  const renders: Uint8Array[] = []
  const renderState = (step: number): Uint8Array => {
    renders[step] ??= rasterize(plan, ctx.atlas, palettesAt(ctx.atlas.layout, ctx.atlas.palettes, step), cam)
    return renders[step] as Uint8Array
  }
  const gpuMatches = async (step: number): Promise<boolean> => {
    const frame = await renderer.render({ archive: ctx.archivePath, map: ctx.mapPath, width: vp.w, height: vp.h, level, originTile: rec.mapping.originTile, originPixel: { x: rec.mapping.originPixel.x - vp.x, y: rec.mapping.originPixel.y - vp.y }, step })
    const ref = renderState(step)
    if (frame.rgba.length !== ref.length) return false
    for (let i = 0; i < ref.length; i += 4) if (frame.rgba[i] !== ref[i] || frame.rgba[i + 1] !== ref[i + 1] || frame.rgba[i + 2] !== ref[i + 2]) return false
    return true
  }

  const excluded = { outsideViewport: ex.counts.outsideViewport, volatile: ex.counts.volatile, object: ex.counts.object, floating: ex.counts.floating, border: 0, ui: ex.counts.ui }
  const causes = randomCauses(ctx, level, ex)

  if (capture.kind === 'still') {
    const cap: CaptureSampler = { data: capture.image.data, channels: capture.image.channels, stride: capture.image.width, x0: vp.x, y0: vp.y }
    let best = { step: 0, diff: Infinity }
    for (let step = 0; step < states; step++) {
      const d = countDiffs(ex, cap, renderState(step), vp.w)
      if (d < best.diff) best = { step, diff: d }
      if (d === 0) break
    }
    let rendered = renderState(best.step)
    const bySprite: Record<string, number> = {}
    if (best.diff > 0 && ex.counts.comparedAnimated > 0) {
      // A still can catch the game between palette updates of different sprites: let each animated
      // sprite use the global step or a neighbour (research.md §5) and compose from real renders.
      const rows = rasterizeRows(plan, ctx.atlas, ctx.atlas.palettes, { level, offsetX, offsetY, width: vp.w, height: vp.h, scale: 1 })
      const composite = rendered.slice()
      for (const sprite of Object.values(ctx.atlas.layout.sprites)) {
        if (!plan.animatedRows.includes(sprite.row)) continue
        let pick = { step: best.step, diff: Infinity }
        for (const delta of [0, -1, 1]) {
          const step = (best.step + delta + states) % states
          const img = renderState(step)
          let d = 0
          for (let i = 0; i < rows.length; i++) if (rows[i] === sprite.row && ex.cls[i] === PIXEL.compared && !samePixel(cap, img, vp.w, i)) d++
          if (d < pick.diff) pick = { step, diff: d }
        }
        bySprite[sprite.name] = pick.step
        if (pick.step !== best.step) {
          const img = renderState(pick.step)
          for (let i = 0; i < rows.length; i++) if (rows[i] === sprite.row) composite.set(img.subarray(i * 4, i * 4 + 4), i * 4)
        }
      }
      rendered = composite
      best = { step: best.step, diff: countDiffs(ex, cap, rendered, vp.w) }
    }
    const gpuOk = opts.verifyGpu === false ? true : await gpuMatches(best.step)
    return {
      outcome: gpuOk ? decideOutcome(best.diff, ex.counts.comparedInMap, ex.counts.inMap) : 'fail',
      gpuMatchesReference: gpuOk,
      paletteStep: best.step,
      ...(Object.keys(bySprite).length > 0 ? { paletteStepsBySprite: bySprite } : {}),
      pixels: { inMap: ex.counts.inMap, compared: ex.counts.compared, comparedAnimated: ex.counts.comparedAnimated, differing: best.diff, excluded },
      tiles: tileStats(ex, cap, rendered, vp.w),
      randomCauses: causes,
      diff: { width: vp.w, height: vp.h, rgba: diffImage(ex, cap, rendered, vp.w) },
    }
  }

  // Clip: frames are cropped to the viewport.
  const steps: NonNullable<FidelityResult['clip']>['steps'] = []
  let totalDiff = 0
  let lastRendered: Uint8Array | undefined
  let lastCap: CaptureSampler | undefined
  for (let f = 0; f < capture.timeline.frames.length; f++) {
    const img = capture.frame(f)
    const cap: CaptureSampler = { data: img.data, channels: img.channels, stride: img.width, x0: 0, y0: 0 }
    let best = { step: -1, anim: Infinity }
    // Try the previous step and its successor first so equivalent states keep a continuous index.
    const prev = steps[steps.length - 1]?.paletteStep
    const order = prev === null || prev === undefined ? [...Array(states).keys()] : [prev, (prev + 1) % states, ...[...Array(states).keys()].filter((k) => k !== prev && k !== (prev + 1) % states)]
    for (const step of order) {
      const d = countDiffs(ex, cap, renderState(step), vp.w, true)
      if (d < best.anim) best = { step, anim: d }
      if (d === 0) break
    }
    const rendered = renderState(Math.max(0, best.step))
    const differing = countDiffs(ex, cap, rendered, vp.w)
    totalDiff += differing
    steps.push({ frame: f, tStartMs: (capture.timeline.frames[f] as { tStartMs: number }).tStartMs, paletteStep: ex.counts.comparedAnimated === 0 ? null : best.step, differing })
    lastRendered = rendered
    lastCap = cap
  }
  const clipEval = evaluateClipSteps(steps, states, capture.timeline.grabFps, PALETTE_STEP_MS)
  const clipPass = clipEval.pass && totalDiff === 0
  const measured = clipEval.stepMsMeasured
  const gpuOk = opts.verifyGpu === false ? true : await gpuMatches(Math.max(0, steps[0]?.paletteStep ?? 0))
  const outcomeBase = decideOutcome(totalDiff, ex.counts.comparedInMap, ex.counts.inMap)
  return {
    outcome: !gpuOk || (outcomeBase === 'pass' && !clipPass) ? 'fail' : outcomeBase,
    gpuMatchesReference: gpuOk,
    paletteStep: steps[0]?.paletteStep ?? 0,
    pixels: { inMap: ex.counts.inMap, compared: ex.counts.compared, comparedAnimated: ex.counts.comparedAnimated, differing: totalDiff, excluded },
    tiles: lastCap !== undefined && lastRendered !== undefined ? tileStats(ex, lastCap, lastRendered, vp.w) : [],
    randomCauses: causes,
    clip: { steps, stepMsMeasured: measured, stepMsExpected: PALETTE_STEP_MS, pass: clipPass },
    diff: lastCap !== undefined && lastRendered !== undefined ? { width: vp.w, height: vp.h, rgba: diffImage(ex, lastCap, lastRendered, vp.w) } : { width: 0, height: 0, rgba: new Uint8Array(0) },
  }
}

function randomCauses(ctx: MapContext, level: number, ex: ReturnType<typeof classifyPixels>): FidelityResult['randomCauses'] {
  const lvl = ctx.floating.levels[level]
  if (lvl === undefined || ex.counts.floating === 0) return []
  const seen = new Map<string, FidelityResult['randomCauses'][number]>()
  const tilesInView = new Set<string>()
  for (let i = 0; i < ex.cls.length; i++) if (ex.cls[i] === 2) tilesInView.add(`${ex.tileX[i]},${ex.tileY[i]}`)
  for (const t of lvl.tiles) {
    const key = `${t.x},${t.y}`
    if (!tilesInView.has(key)) continue
    const px = coveredPixels(lvl.footprint.get(tileKey(t.x, t.y)) ?? { x: 0, y: 0, rows: new Uint32Array(32) })
    for (const c of t.causes) {
      const id = c.kind === 'randomObject' ? `o${c.objectId}` : `h${c.player}`
      const obj = c.kind === 'randomObject' ? ctx.state.objects.get(c.objectId) : undefined
      const entry = seen.get(id) ?? (c.kind === 'randomObject'
        ? { kind: c.kind, objectIndex: c.objectId, classId: c.classId, className: className(c.classId), x: obj?.x ?? t.x, y: obj?.y ?? t.y, excludedPixels: 0 }
        : { kind: c.kind, player: c.player, ...(c.townObjectId !== null ? { objectIndex: c.townObjectId } : {}), x: t.x, y: t.y, excludedPixels: 0 })
      entry.excludedPixels += px
      seen.set(id, entry)
    }
  }
  return [...seen.values()]
}

export { CHECK_THRESHOLDS }
