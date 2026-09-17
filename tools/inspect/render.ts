import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { TILE_SIZE } from '../../src/core/data/terrain.ts'
import { animationStep } from '../../src/core/render/palette.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { flag, intOpt, opt, parseRegion, positional, required } from '../shared/cli-runner.ts'
import { resolveGameFile } from '../shared/game-files.ts'
import { encodePng } from '../shared/png.ts'
import { HeadlessRenderer } from '../shared/render-page.ts'
import { usage } from '../shared/errors.ts'

/** `yarn h3 render MAP --level Z --region x0,y0,x1,y1 (--time MS | --palette-step N) [--scale F] --out PATH` */
export async function renderCommand(args: ParsedArgs): Promise<CommandResult> {
  const map = resolveGameFile(positional(args, 0, 'MAP'))
  const archive = resolveGameFile(opt(args, 'archive') ?? 'h3sprite.lod')
  const level = intOpt(args, 'level', 0)
  const region = parseRegion(required(args, 'region'))
  const out = resolve(required(args, 'out'))
  const stepArg = opt(args, 'palette-step')
  const timeArg = opt(args, 'time')
  if (stepArg !== undefined && timeArg !== undefined) throw usage('use either --palette-step or --time')
  const step = stepArg !== undefined ? Number(stepArg) : animationStep(Number(timeArg ?? 0))
  const scale = Number(opt(args, 'scale') ?? 1)
  if (!Number.isFinite(scale) || scale <= 0) throw usage('--scale must be a positive number')
  const width = Math.round((region.x1 - region.x0 + 1) * TILE_SIZE * scale)
  const height = Math.round((region.y1 - region.y0 + 1) * TILE_SIZE * scale)
  const renderer = await HeadlessRenderer.open({ rebuild: flag(args, 'rebuild'), width: Math.max(width, 64), height: Math.max(height, 64) })
  try {
    const tickArg = opt(args, 'tick')
    const seedArg = opt(args, 'seed')
    const tick = tickArg !== undefined ? Number(tickArg) : step
    const seed = seedArg === undefined ? 1 : Number(seedArg)
    if (!Number.isInteger(tick) || !Number.isInteger(seed)) throw usage('--tick and --seed must be integers')
    const objects = !flag(args, 'no-objects')
    const frame = await renderer.render({ archive, map, width, height, level, originTile: { x: region.x0, y: region.y0 }, originPixel: { x: 0, y: 0 }, step, tick, seed, objects, ...(objects ? {} : { dataArchive: null }), drawList: flag(args, 'draw-list'), scale })
    await mkdir(dirname(out), { recursive: true })
    await writeFile(out, encodePng({ width, height, channels: 4, data: frame.rgba }))
    return {
      ok: true,
      out,
      width,
      height,
      level,
      region,
      scale,
      paletteStep: step,
      tick,
      seed,
      visible: region,
      stats: { objectQuads: frame.stats.objectQuads ?? 0 },
      ...(frame.drawList !== undefined ? { drawList: frame.drawList } : {}),
      ...(frame.diagnostics !== undefined ? { diagnostics: frame.diagnostics } : {}),
    }
  } finally {
    await renderer.close()
  }
}
