// Object inspection (specs/003-map-objects/contracts/inspect-cli.md): draw list of a region and
// random-object outcomes, computed in Node from the user's archives like the renderer does.

import { basename } from 'node:path'
import { className, HIDDEN_CLASSES } from '../../src/core/data/object-classes.ts'
import { objectTick } from '../../src/core/render/animation.ts'
import { buildObjectPlan } from '../../src/core/render/object-plan.ts'
import { animationStep } from '../../src/core/render/palette.ts'
import { buildMapContext, buildObjectContext } from '../checks/fidelity/masks.ts'
import type { MapContext, ObjectContext } from '../checks/fidelity/masks.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { intOpt, opt, parseRegion, positional, required } from '../shared/cli-runner.ts'
import { usage } from '../shared/errors.ts'
import { resolveGameFile } from '../shared/game-files.ts'

async function contexts(args: ParsedArgs): Promise<{ ctx: MapContext; objects: ObjectContext }> {
  const map = resolveGameFile(positional(args, 0, 'MAP'))
  const archive = resolveGameFile(opt(args, 'archive') ?? 'h3sprite.lod')
  const dataArchive = resolveGameFile(opt(args, 'data-archive') ?? 'h3bitmap.lod')
  const seedArg = opt(args, 'seed')
  const seed = seedArg === undefined ? undefined : Number(seedArg)
  if (seed !== undefined && !Number.isInteger(seed)) throw usage('--seed must be an integer')
  const ctx = await buildMapContext(map, archive, dataArchive)
  const objects = await buildObjectContext(ctx, { dataArchive, ...(seed !== undefined ? { seed } : {}) })
  return { ctx, objects }
}

function levelArg(args: ParsedArgs, ctx: MapContext): number {
  const z = intOpt(args, 'level', 0)
  if (z < 0 || z >= ctx.state.levels) throw usage(`--level must be 0${ctx.state.levels > 1 ? ' or 1' : ''}`)
  return z
}

/** `yarn h3 map draw-list MAP --level Z --region x0,y0,x1,y1 (--time MS | --tick N) [--seed S]` */
export async function mapDrawList(args: ParsedArgs): Promise<CommandResult> {
  const { ctx, objects } = await contexts(args)
  const level = levelArg(args, ctx)
  const region = parseRegion(required(args, 'region'))
  const tickArg = opt(args, 'tick')
  const timeArg = opt(args, 'time')
  if (tickArg !== undefined && timeArg !== undefined) throw usage('use either --tick or --time')
  const tick = tickArg !== undefined ? Number(tickArg) : objectTick(Number(timeArg ?? 0))
  const paletteStep = tickArg !== undefined ? tick : animationStep(Number(timeArg ?? 0))
  const plan = buildObjectPlan(objects.index, objects.atlas.layout, level, region, tick, { drawList: true })
  const hidden = [...ctx.state.objects.values()]
    .filter((o) => o.z === level && HIDDEN_CLASSES.has(o.classId) && o.x >= region.x0 && o.x <= region.x1 && o.y >= region.y0 && o.y <= region.y1)
    .map((o) => ({ id: o.id, className: className(o.classId), x: o.x, y: o.y }))
  return {
    ok: true,
    map: basename(ctx.mapPath),
    level,
    region,
    seed: objects.seed,
    tick,
    paletteStep,
    entries: (plan.entries ?? []).map(({ index: _index, ...e }) => e),
    hidden,
    diagnostics: [...plan.missing.map((def) => ({ code: 'MISSING_SPRITE', def })), ...objects.missing.map((def) => ({ code: 'MISSING_SPRITE', def }))],
  }
}

/** `yarn h3 map random MAP [--seed S] [--level Z]` */
export async function mapRandom(args: ParsedArgs): Promise<CommandResult> {
  const { ctx, objects } = await contexts(args)
  const levelOptArg = opt(args, 'level')
  const level = levelOptArg === undefined ? undefined : levelArg(args, ctx)
  const outcomes = objects.objects
    .filter((o) => o.random !== null && o.kind !== 'heroFlag' && (level === undefined || o.z === level))
    .map((o) => {
      const source = ctx.state.objects.get(o.id)
      const r = o.random as NonNullable<typeof o.random>
      return {
        id: o.id,
        x: o.x,
        y: o.y,
        z: o.z,
        className: className(source?.classId ?? o.classId),
        rule: r.rule,
        resolved: { classId: r.classId, subclassId: r.subclassId, def: o.def, ...(r.heroType !== undefined ? { heroType: r.heroType } : {}) },
      }
    })
  return { ok: true, map: basename(ctx.mapPath), seed: objects.seed, outcomes }
}
