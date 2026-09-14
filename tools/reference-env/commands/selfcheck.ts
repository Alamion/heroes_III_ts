// Reproducibility (SC-002) and position agreement with the editor (SC-003), run against the real game.
import { join } from 'node:path'
import type { Command } from '../cli.ts'
import { parseArgs } from '../cli.ts'
import { registerCaptures, type Capture } from '../analysis/register.ts'
import { cropMask, differingCells } from '../analysis/volatile-mask.ts'
import { cropFrame, readPng } from '../env/grab.ts'
import { ERROR_CODES, RefError } from '../errors.ts'
import { log } from '../log.ts'
import type { CaptureMatch } from '../model/types.ts'
import { config, intOpt, required, targetContext } from './common.ts'
import { editorCommand } from './editor.ts'
import { stillCommand } from './still.ts'

/** Parses repeated `--floating-tiles "x,y;x,y"` values into "x,y" keys. */
export function parseTiles(values: string[]): Set<string> {
  const out = new Set<string>()
  for (const part of values.flatMap((v) => v.split(';')).map((p) => p.trim()).filter(Boolean)) {
    const nums = part.split(',').map(Number)
    if (nums.length !== 2 || nums.some((n) => !Number.isInteger(n) || n < 0)) {
      throw new RefError(ERROR_CODES.USAGE, `--floating-tiles expects "x,y;x,y" (got "${part}")`)
    }
    out.add(`${nums[0]},${nums[1]}`)
  }
  return out
}

/** Deterministic PRNG so sample positions are reproducible (mulberry32). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

async function loadCapture(m: CaptureMatch): Promise<Capture> {
  const still = await readPng(join(m.dir, 'still.png'))
  const maskImg = await readPng(join(m.dir, 'volatile-mask.png'))
  const mask = Buffer.alloc(maskImg.width * maskImg.height)
  for (let i = 0; i < mask.length; i++) mask[i] = maskImg.rgb[i * 3] as number
  return { width: still.width, rgb: still.rgb, mask, mapping: m.record.mapping, visible: m.record.visible }
}

async function capture(kind: 'still' | 'editor', map: string, level: number, x: number, y: number, extra: string[] = []): Promise<CaptureMatch> {
  const args = parseArgs([kind, '--map', map, '--level', String(level), '--x', String(x), '--y', String(y), ...extra])
  const result = kind === 'still' ? await stillCommand(args) : await editorCommand(args)
  return result.capture as CaptureMatch
}

export const selfcheckCommand: Command = async (args) => {
  const cfg = config()
  const map = required(args, 'map')
  const runs = intOpt(args, 'runs', 5)
  const floating = parseTiles(args.flags.get('floating-tiles') ?? [])
  const samples = intOpt(args, 'samples', 10)
  const seed = intOpt(args, 'seed', 1)
  const ctx = await targetContext(cfg, parseArgs(['selfcheck', '--map', map, '--x', '0', '--y', '0']))
  const size = ctx.map.sizeTiles
  const cx = Math.floor(size / 2)

  // SC-002: repeated stills of one target (fixed start) must match outside the volatile masks.
  const reproducibility: { run: number; differing: number; tiles: Record<string, number>; floatingTiles: Record<string, number> }[] = []
  let first: Capture | undefined
  for (let i = 0; i < runs; i++) {
    log.info(`reproducibility run ${i + 1}/${runs}`)
    const c = await loadCapture(await capture('still', map, 0, cx, cx))
    const vp = c.mapping.viewport
    if (first === undefined) {
      first = c
      continue
    }
    // Differing pixels grouped by map tile: random map objects (e.g. random monsters) are re-rolled
    // at every game start and show up as whole tiles here.
    const m = c.mapping
    const cells = differingCells(
      cropFrame({ width: c.width, height: 0, rgb: first.rgb }, vp).rgb,
      cropFrame({ width: c.width, height: 0, rgb: c.rgb }, vp).rgb,
      vp.w,
      vp.h,
      cropMask(first.mask, first.width, vp),
      cropMask(c.mask, c.width, vp),
      { x: m.originPixel.x - vp.x, y: m.originPixel.y - vp.y },
    )
    const tiles: Record<string, number> = {}
    for (const [k, n] of Object.entries(cells)) {
      const [cx0, cy0] = k.split(',').map(Number) as [number, number]
      tiles[`${m.originTile.x + cx0},${m.originTile.y + cy0}`] = n
    }
    // Floating tiles (random map objects, re-rolled every launch) are reported but not counted.
    const floatingHits: Record<string, number> = {}
    for (const k of Object.keys(tiles)) {
      if (floating.has(k)) {
        floatingHits[k] = tiles[k] as number
        delete tiles[k]
      }
    }
    const r = { differing: Object.values(tiles).reduce((a, n) => a + n, 0), tiles, floatingTiles: floatingHits }
    reproducibility.push({ run: i + 1, ...r })
  }

  // SC-003: random tiles on each level; the game view must register with the editor view at offset (0, 0).
  const rand = mulberry32(seed)
  const levels = ctx.map.hasUnderground ? [0, 1] : [0]
  const positionAgreement: { level: number; x: number; y: number; dx: number; dy: number; fraction: number; agrees: boolean }[] = []
  for (const level of levels) {
    for (let i = 0; i < samples; i++) {
      const x = Math.floor(rand() * size)
      const y = Math.floor(rand() * size)
      log.info(`position sample level ${level} (${x}, ${y})`)
      const game = await loadCapture(await capture('still', map, level, x, y))
      const editor = await loadCapture(await capture('editor', map, level, x, y, ['--launches', '1']))
      const { best } = registerCaptures(game, editor)
      positionAgreement.push({ level, x, y, dx: best.dx, dy: best.dy, fraction: Number(best.fraction.toFixed(4)), agrees: best.dx === 0 && best.dy === 0 })
    }
  }
  const reproducible = reproducibility.every((r) => r.differing === 0)
  const agreeing = positionAgreement.filter((p) => p.agrees).length
  return {
    ok: reproducible && agreeing === positionAgreement.length,
    reproducibility: { runs, allIdentical: reproducible, comparisons: reproducibility },
    positionAgreement: { agreeing, total: positionAgreement.length, samples: positionAgreement },
  }
}
