// Runs one fidelity comparison (still or clip) against the real renderer in headless Chromium.

import { TILE_SIZE } from '../../../src/core/data/terrain.ts'
import { PALETTE_STEP_MS } from '../../../src/core/data/palette-rotation.ts'
import { CHECK_THRESHOLDS } from '../../../src/core/data/thresholds.ts'
import { visibleRange } from '../../../src/core/render/camera.ts'
import { buildDrawPlan } from '../../../src/core/render/draw-plan.ts'
import { rasterizeRows, rasterizeScene } from '../../../src/core/render/software.ts'
import { buildObjectPlan } from '../../../src/core/render/object-plan.ts'
import { OBJECT_FRAME_MS } from '../../../src/core/data/animation.ts'
import { palettesAt } from '../../../src/core/render/palette.ts'
import { animationStateCount } from '../../../src/core/render/palette.ts'
import { className } from '../../../src/core/data/object-classes.ts'
import { coveredPixels, tileKey } from '../../../src/core/state/footprint.ts'
import type { Region } from '../../shared/cli-runner.ts'
import type { HeadlessRenderer } from '../../shared/render-page.ts'
import type { LoadedCapture, UiMask } from './captures.ts'
import { classifyPixels, countDiffs, decideOutcome, diffImage, viewportImage, evaluateClipSteps, PIXEL, samePixel, tileStats } from './compare.ts'
import type { CaptureSampler, Outcome, TileStat } from './compare.ts'
import type { MapContext, ObjectContext } from './masks.ts'

export interface FidelityResult {
  outcome: Outcome
  /** GPU frame at the chosen global step equals the reference rasterizer's (bit-exact). */
  gpuMatchesReference: boolean
  paletteStep: number
  /** Stills only: step chosen per animated sprite (may be ±1 from paletteStep, see research.md §5). */
  paletteStepsBySprite?: Record<string, number>
  /** Chosen frame per animated object (`def@x,y`), stills and the first clip frame. */
  objectFramesByObject?: Record<string, number>
  pixels: { inMap: number; compared: number; comparedAnimated: number; comparedObject: number; differing: number; excluded: Record<string, number> }
  tiles: TileStat[]
  randomCauses: { kind: 'randomObject' | 'generatedHero'; objectIndex?: number; classId?: number; className?: string; player?: number; x: number; y: number; excludedPixels: number }[]
  clip?: {
    steps: { frame: number; tStartMs: number; paletteStep: number | null; differing: number }[]
    stepMsMeasured: number
    stepMsExpected: number
    pass: boolean
    objectSteps?: { frame: number; tick: number; differing: number }[]
    objectStepMsMeasured?: number | null
    objectStepMsExpected?: number
  }
  diff: { width: number; height: number; rgba: Uint8Array }
  /** The reference viewport and the render compared with it (last frame for clips), same size as `diff`. */
  images: { reference: Uint8Array; rendered: Uint8Array }
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
  /** Mask object footprints instead of comparing object pixels (spec 002 behaviour, diagnosis). */
  excludeObjects?: boolean
  /** Object layer (spec 003); undefined draws terrain only (objects must then be excluded). */
  objects?: ObjectContext
}): Promise<FidelityResult> {
  const { capture, ctx, renderer } = opts
  const rec = capture.record
  const vp = rec.mapping.viewport
  const level = rec.level
  // Camera: world pixel at the viewport's top-left.
  const offsetX = rec.mapping.originTile.x * TILE_SIZE - (rec.mapping.originPixel.x - vp.x)
  const offsetY = rec.mapping.originTile.y * TILE_SIZE - (rec.mapping.originPixel.y - vp.y)
  const region = opts.region ?? regionForView(offsetX, offsetY, vp.w, vp.h)
  const cam = { level, offsetX, offsetY, width: vp.w, height: vp.h, scale: 1 }
  const plan = buildDrawPlan(ctx.state, ctx.atlas.layout, level, visibleRange(cam, 1))
  const pw = plan.range.x1 - plan.range.x0 + 1
  const animatedTile = (tx: number, ty: number): boolean => {
    const lx = tx - plan.range.x0
    const ly = ty - plan.range.y0
    return lx >= 0 && ly >= 0 && lx < pw && plan.animatedTileMask[ly * pw + lx] === 1
  }
  const objects = opts.excludeObjects === true ? undefined : opts.objects
  const n = vp.w * vp.h

  // Objects in view and which of them animate (their pixels ignore the still's volatile mask).
  const basePlan = objects === undefined ? undefined : buildObjectPlan(objects.index, objects.atlas.layout, level, plan.range, 0, { drawList: true })
  const animated = (basePlan?.entries ?? []).filter((e) => e.frameCount > 1)
  const animatedMask = new Uint8Array(n)
  for (const e of animated) {
    const x0 = e.screenX + plan.range.x0 * TILE_SIZE - offsetX
    const y0 = e.screenY + plan.range.y0 * TILE_SIZE - offsetY
    for (let y = Math.max(0, y0); y < Math.min(vp.h, y0 + e.height); y++) for (let x = Math.max(0, x0); x < Math.min(vp.w, x0 + e.width); x++) animatedMask[y * vp.w + x] = 1
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
  const ex = classifyPixels({ width: vp.w, height: vp.h, offsetX, offsetY, mapSize: ctx.state.size, region, ui, volatile, animatedObjects: animatedMask, objects: objects === undefined ? (ctx.objects[level] ?? new Map()) : new Map(), floating: floating?.footprint ?? new Map(), animatedTile })

  const states = animationStateCount()
  // The state search uses the reference rasterizer (bit-exact with the WebGL renderer, verified below
  // for the chosen state), so many states per view need no page round trips.
  const renderScene = (step: number, frames: ReadonlyMap<number, number> | undefined, owners?: Int32Array): Uint8Array => {
    const palettes = palettesAt(ctx.atlas.layout, ctx.atlas.palettes, step)
    const scene = objects === undefined ? undefined : { plan: buildObjectPlan(objects.index, objects.atlas.layout, level, plan.range, 0, frames !== undefined ? { frames } : {}), atlas: objects.atlas, flagColors: objects.flagColors }
    return rasterizeScene(plan, ctx.atlas, palettes, cam, scene, owners)
  }
  const renders: Uint8Array[] = []
  const renderState = (step: number): Uint8Array => {
    renders[step] ??= renderScene(step, undefined)
    return renders[step] as Uint8Array
  }
  const gpuMatches = async (step: number, frames: ReadonlyMap<number, number> | undefined, reference: Uint8Array): Promise<boolean> => {
    const frame = await renderer.render({
      archive: ctx.archivePath,
      map: ctx.mapPath,
      width: vp.w,
      height: vp.h,
      level,
      originTile: rec.mapping.originTile,
      originPixel: { x: rec.mapping.originPixel.x - vp.x, y: rec.mapping.originPixel.y - vp.y },
      step,
      tick: 0,
      objects: objects !== undefined,
      ...(objects === undefined ? { dataArchive: null } : { seed: objects.seed }),
      ...(frames !== undefined ? { objectFrames: [...frames.entries()] } : {}),
    })
    if (frame.rgba.length !== reference.length) return false
    for (let i = 0; i < reference.length; i += 4) if (frame.rgba[i] !== reference[i] || frame.rgba[i + 1] !== reference[i + 1] || frame.rgba[i + 2] !== reference[i + 2]) return false
    return true
  }

  /**
   * Per animated object, the frame (0 … frameCount − 1) that matches its own pixels best. Objects
   * are split into groups whose sprites do not overlap; each group's frames are searched with the
   * others fixed, in two passes (overlapping animated objects, e.g. reefs, influence each other).
   */
  const searchObjectFrames = (step: number, cap: CaptureSampler): Map<number, number> => {
    const rect = (e: (typeof animated)[number]) => ({ x0: e.screenX, y0: e.screenY, x1: e.screenX + e.width, y1: e.screenY + e.height })
    const groups: (typeof animated)[] = []
    for (const e of animated) {
      const r = rect(e)
      const g = groups.find((members) => members.every((m) => {
        const o = rect(m)
        return r.x1 <= o.x0 || o.x1 <= r.x0 || r.y1 <= o.y0 || o.y1 <= r.y0
      }))
      if (g === undefined) groups.push([e])
      else g.push(e)
    }
    const chosen = new Map<number, number>(animated.map((e) => [e.index, e.phase % e.frameCount]))
    const owners = new Int32Array(n)
    for (let pass = 0; pass < 2; pass++) {
      for (const group of groups) {
        const maxFrames = Math.max(...group.map((e) => e.frameCount))
        const scores = new Map<number, number[]>(group.map((e) => [e.index, new Array<number>(e.frameCount).fill(0)]))
        const frameCounts = new Map(group.map((e) => [e.index, e.frameCount]))
        for (let f = 0; f < maxFrames; f++) {
          const frames = new Map(chosen)
          for (const e of group) frames.set(e.index, f % e.frameCount)
          const img = renderScene(step, frames, owners)
          for (let i = 0; i < n; i++) {
            const o = owners[i] as number
            const s = o < 0 ? undefined : scores.get(o)
            if (s === undefined || ex.cls[i] !== PIXEL.compared || f >= (frameCounts.get(o) as number)) continue
            if (!samePixel(cap, img, vp.w, i)) s[f] = (s[f] as number) + 1
          }
        }
        for (const [o, s] of scores) chosen.set(o, s.indexOf(Math.min(...s)))
      }
    }
    return chosen
  }
  const key = (index: number): string => {
    const o = objects?.objects[index]
    return o === undefined ? String(index) : `${o.def}@${o.x},${o.y}`
  }
  const comparedObjectPixels = (step: number, frames: ReadonlyMap<number, number> | undefined): number => {
    if (objects === undefined) return 0
    const owners = new Int32Array(n)
    renderScene(step, frames, owners)
    let c = 0
    for (let i = 0; i < n; i++) if (owners[i] !== -1 && ex.cls[i] === PIXEL.compared) c++
    return c
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
    const frames = animated.length > 0 && best.diff > 0 ? searchObjectFrames(best.step, cap) : undefined
    let rendered = frames === undefined ? renderState(best.step) : renderScene(best.step, frames)
    best = { step: best.step, diff: countDiffs(ex, cap, rendered, vp.w) }
    const bySprite: Record<string, number> = {}
    if (best.diff > 0 && ex.counts.comparedAnimated > 0) {
      // A still can catch the game between palette updates of different sprites: let each animated
      // sprite use the global step or a neighbour (research.md §5) and compose from real renders.
      const rows = rasterizeRows(plan, ctx.atlas, ctx.atlas.palettes, cam)
      const composite = rendered.slice()
      const stepRenders = new Map<number, Uint8Array>([[best.step, rendered]])
      for (const sprite of Object.values(ctx.atlas.layout.sprites)) {
        if (!plan.animatedRows.includes(sprite.row)) continue
        let pick = { step: best.step, diff: Infinity }
        for (const delta of [0, -1, 1]) {
          const step = (best.step + delta + states) % states
          let img = stepRenders.get(step)
          if (img === undefined) {
            img = renderScene(step, frames)
            stepRenders.set(step, img)
          }
          let d = 0
          for (let i = 0; i < rows.length; i++) if (rows[i] === sprite.row && ex.cls[i] === PIXEL.compared && !samePixel(cap, img, vp.w, i)) d++
          if (d < pick.diff) pick = { step, diff: d }
        }
        bySprite[sprite.name] = pick.step
        if (pick.step !== best.step) {
          const img = stepRenders.get(pick.step) as Uint8Array
          for (let i = 0; i < rows.length; i++) if (rows[i] === sprite.row) composite.set(img.subarray(i * 4, i * 4 + 4), i * 4)
        }
      }
      rendered = composite
      best = { step: best.step, diff: countDiffs(ex, cap, rendered, vp.w) }
    }
    const reference = frames === undefined ? renderState(best.step) : renderScene(best.step, frames)
    const gpuOk = opts.verifyGpu === false ? true : await gpuMatches(best.step, frames, reference)
    return {
      outcome: gpuOk ? decideOutcome(best.diff, ex.counts.comparedInMap, ex.counts.inMap) : 'fail',
      gpuMatchesReference: gpuOk,
      paletteStep: best.step,
      ...(Object.keys(bySprite).length > 0 ? { paletteStepsBySprite: bySprite } : {}),
      ...(frames !== undefined ? { objectFramesByObject: Object.fromEntries([...frames].map(([i, f]) => [key(i), f])) } : {}),
      pixels: { inMap: ex.counts.inMap, compared: ex.counts.compared, comparedAnimated: ex.counts.comparedAnimated, comparedObject: comparedObjectPixels(best.step, frames), differing: best.diff, excluded },
      tiles: tileStats(ex, cap, rendered, vp.w),
      randomCauses: causes,
      diff: { width: vp.w, height: vp.h, rgba: diffImage(ex, cap, rendered, vp.w) },
      images: { reference: viewportImage(cap, vp.w, vp.h), rendered },
    }
  }

  // Clip: frames are cropped to the viewport. The first frame fixes every object's frame; later
  // frames may advance the palette step and all object frames by one tick each (research.md §7).
  const steps: NonNullable<FidelityResult['clip']>['steps'] = []
  const objectSteps: NonNullable<NonNullable<FidelityResult['clip']>['objectSteps']> = []
  let totalDiff = 0
  let lastRendered: Uint8Array | undefined
  let lastCap: CaptureSampler | undefined
  let baseFrames: Map<number, number> | undefined
  let firstReference: { step: number; frames: Map<number, number> | undefined; image: Uint8Array } | undefined
  let prevTick = 0
  const framesAt = (tick: number): Map<number, number> | undefined => (baseFrames === undefined ? undefined : new Map([...baseFrames].map(([i, f]) => [i, (f + tick) % (animated.find((e) => e.index === i)?.frameCount ?? 1)])))
  for (let f = 0; f < capture.timeline.frames.length; f++) {
    const img = capture.frame(f)
    const cap: CaptureSampler = { data: img.data, channels: img.channels, stride: img.width, x0: 0, y0: 0 }
    const prev = steps[steps.length - 1]?.paletteStep
    let best = { step: -1, tick: prevTick, diff: Infinity, image: undefined as Uint8Array | undefined }
    if (f === 0) {
      for (let step = 0; step < states; step++) {
        const d = countDiffs(ex, cap, renderState(step), vp.w)
        if (d < best.diff) best = { step, tick: 0, diff: d, image: renderState(step) }
        if (d === 0) break
      }
      if (animated.length > 0) {
        baseFrames = searchObjectFrames(best.step, cap)
        const image = renderScene(best.step, baseFrames)
        best = { ...best, diff: countDiffs(ex, cap, image, vp.w), image }
      }
      firstReference = { step: best.step, frames: baseFrames, image: best.image as Uint8Array }
    } else {
      const stepCandidates = prev === null || prev === undefined ? [...Array(states).keys()] : [prev, (prev + 1) % states]
      const tickCandidates = animated.length > 0 ? [prevTick, prevTick + 1] : [prevTick]
      for (const step of stepCandidates) {
        for (const tick of tickCandidates) {
          const image = animated.length > 0 ? renderScene(step, framesAt(tick)) : renderState(step)
          const d = countDiffs(ex, cap, image, vp.w)
          if (d < best.diff) best = { step, tick, diff: d, image }
        }
      }
      if (best.diff > 0 && animated.length === 0) {
        // Fall back to a full search of palette states (a missed step).
        for (let step = 0; step < states; step++) {
          const d = countDiffs(ex, cap, renderState(step), vp.w)
          if (d < best.diff) best = { step, tick: prevTick, diff: d, image: renderState(step) }
        }
      }
    }
    const rendered = best.image as Uint8Array
    totalDiff += best.diff
    const tStartMs = (capture.timeline.frames[f] as { tStartMs: number }).tStartMs
    steps.push({ frame: f, tStartMs, paletteStep: ex.counts.comparedAnimated === 0 ? null : best.step, differing: best.diff })
    if (animated.length > 0) objectSteps.push({ frame: f, tick: best.tick, differing: best.diff })
    prevTick = best.tick
    lastRendered = rendered
    lastCap = cap
  }
  const clipEval = evaluateClipSteps(steps, states, capture.timeline.grabFps, PALETTE_STEP_MS)
  const objectEval = objectSteps.length === 0 ? undefined : evaluateClipSteps(objectSteps.map((s) => ({ tStartMs: steps[s.frame]?.tStartMs ?? 0, paletteStep: s.tick })), Number.MAX_SAFE_INTEGER, capture.timeline.grabFps, OBJECT_FRAME_MS)
  const clipPass = (ex.counts.comparedAnimated === 0 || clipEval.pass) && (objectEval === undefined || objectEval.pass) && totalDiff === 0
  const gpuOk = opts.verifyGpu === false || firstReference === undefined ? true : await gpuMatches(firstReference.step, firstReference.frames, firstReference.image)
  const outcomeBase = decideOutcome(totalDiff, ex.counts.comparedInMap, ex.counts.inMap)
  return {
    outcome: !gpuOk || (outcomeBase === 'pass' && !clipPass) ? 'fail' : outcomeBase,
    gpuMatchesReference: gpuOk,
    paletteStep: steps[0]?.paletteStep ?? 0,
    ...(baseFrames !== undefined ? { objectFramesByObject: Object.fromEntries([...baseFrames].map(([i, fr]) => [key(i), fr])) } : {}),
    pixels: { inMap: ex.counts.inMap, compared: ex.counts.compared, comparedAnimated: ex.counts.comparedAnimated, comparedObject: comparedObjectPixels(firstReference?.step ?? 0, baseFrames), differing: totalDiff, excluded },
    tiles: lastCap !== undefined && lastRendered !== undefined ? tileStats(ex, lastCap, lastRendered, vp.w) : [],
    randomCauses: causes,
    clip: {
      steps,
      stepMsMeasured: clipEval.stepMsMeasured,
      stepMsExpected: PALETTE_STEP_MS,
      pass: clipPass,
      ...(objectEval !== undefined ? { objectSteps, objectStepMsMeasured: Number.isFinite(objectEval.stepMsMeasured) ? objectEval.stepMsMeasured : null, objectStepMsExpected: OBJECT_FRAME_MS } : {}),
    },
    diff: lastCap !== undefined && lastRendered !== undefined ? { width: vp.w, height: vp.h, rgba: diffImage(ex, lastCap, lastRendered, vp.w) } : { width: 0, height: 0, rgba: new Uint8Array(0) },
    images: lastCap !== undefined && lastRendered !== undefined ? { reference: viewportImage(lastCap, vp.w, vp.h), rendered: lastRendered } : { reference: new Uint8Array(0), rendered: new Uint8Array(0) },
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
