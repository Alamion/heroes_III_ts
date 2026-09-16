// Hand-written validation mirroring contracts/capture-record.schema.json (no schema library).
import { ERROR_CODES, RefError } from '../errors.ts'
import type { CaptureRecord } from './types.ts'

type Obj = Record<string, unknown>

const HEX64 = /^[0-9a-f]{64}$/
const LABELS = ['Heroes3.exe (original)', 'Heroes3_HD.exe (HD Mod vanilla profile)', 'h3maped.exe (original)']
const EDGES = ['left', 'top', 'right', 'bottom']

function fail(path: string, message: string): never {
  throw new RefError(ERROR_CODES.CONFIG_INVALID, `invalid capture record at ${path}: ${message}`, {
    details: { path },
  })
}

function obj(v: unknown, path: string): Obj {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) fail(path, 'expected object')
  return v as Obj
}

function int(v: unknown, path: string, min = -Infinity): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min) fail(path, `expected integer >= ${min}`)
  return v
}

function num(v: unknown, path: string): number {
  if (typeof v !== 'number' || !Number.isFinite(v)) fail(path, 'expected number')
  return v
}

function str(v: unknown, path: string): string {
  if (typeof v !== 'string') fail(path, 'expected string')
  return v
}

function bool(v: unknown, path: string): boolean {
  if (typeof v !== 'boolean') fail(path, 'expected boolean')
  return v
}

function oneOf<T>(v: unknown, allowed: readonly T[], path: string): T {
  if (!allowed.includes(v as T)) fail(path, `expected one of ${JSON.stringify(allowed)}`)
  return v as T
}

function hash(v: unknown, path: string): string {
  const s = str(v, path)
  if (!HEX64.test(s)) fail(path, 'expected 64 lowercase hex chars')
  return s
}

function point(v: unknown, path: string, min = 0): void {
  const o = obj(v, path)
  int(o.x, `${path}.x`, min)
  int(o.y, `${path}.y`, min)
}

function rect(v: unknown, path: string): void {
  const o = obj(v, path)
  int(o.x, `${path}.x`, 0)
  int(o.y, `${path}.y`, 0)
  int(o.w, `${path}.w`, 1)
  int(o.h, `${path}.h`, 1)
}

export function validateRecord(value: unknown): CaptureRecord {
  const r = obj(value, '$')
  if (r.schemaVersion !== 1) fail('$.schemaVersion', 'expected 1')
  str(r.id, '$.id')
  if (Number.isNaN(Date.parse(str(r.createdAt, '$.createdAt')))) fail('$.createdAt', 'expected ISO date-time')
  const source = oneOf(r.source, ['game', 'editor'] as const, '$.source')
  const kind = oneOf(r.kind, ['still', 'clip'] as const, '$.kind')

  const map = obj(r.map, '$.map')
  str(map.name, '$.map.name')
  str(map.key, '$.map.key')
  hash(map.sha256, '$.map.sha256')
  const size = int(map.sizeTiles, '$.map.sizeTiles', 1)
  const underground = bool(map.hasUnderground, '$.map.hasUnderground')
  oneOf(map.formatVersion, ['RoE', 'AB', 'SoD'] as const, '$.map.formatVersion')

  const level = oneOf(r.level, [0, 1] as const, '$.level')
  if (level === 1 && !underground) fail('$.level', 'level 1 on a map without underground')
  point(r.requested, '$.requested')
  const requested = r.requested as { x: number; y: number }
  if (requested.x >= size || requested.y >= size) fail('$.requested', 'outside map bounds')
  if (r.clamped !== undefined) bool(r.clamped, '$.clamped')

  const visible = obj(r.visible, '$.visible')
  const x0 = int(visible.x0, '$.visible.x0')
  const y0 = int(visible.y0, '$.visible.y0')
  const x1 = int(visible.x1, '$.visible.x1')
  const y1 = int(visible.y1, '$.visible.y1')
  if (x1 < x0 || y1 < y0) fail('$.visible', 'empty range')
  if (!Array.isArray(visible.partialEdges)) fail('$.visible.partialEdges', 'expected array')
  visible.partialEdges.forEach((e, i) => oneOf(e, EDGES, `$.visible.partialEdges[${i}]`))
  const contains = requested.x >= x0 && requested.x <= x1 && requested.y >= y0 && requested.y <= y1
  if (!contains && r.clamped !== true) fail('$.visible', 'does not contain requested tile and clamped is not set')

  const mapping = obj(r.mapping, '$.mapping')
  if (mapping.tileSize !== 32) fail('$.mapping.tileSize', 'expected 32')
  point(mapping.originTile, '$.mapping.originTile', -Infinity)
  point(mapping.originPixel, '$.mapping.originPixel', -Infinity)
  rect(mapping.viewport, '$.mapping.viewport')

  const positionSource = oneOf(r.positionSource, ['minimap-rect', 'editor-view'] as const, '$.positionSource')
  if ((source === 'editor') !== (positionSource === 'editor-view')) fail('$.positionSource', 'does not match source')

  if (r.startSetup !== undefined) {
    const s = obj(r.startSetup, '$.startSetup')
    const mode = oneOf(s.mode, ['fixed', 'random'] as const, '$.startSetup.mode')
    if (mode === 'fixed') {
      const c = obj(s.choices, '$.startSetup.choices')
      str(c.town, '$.startSetup.choices.town')
      str(c.hero, '$.startSetup.choices.hero')
      str(c.bonus, '$.startSetup.choices.bonus')
    }
  } else if (source === 'game') {
    fail('$.startSetup', 'required for game captures')
  }

  const vis = obj(r.visibility, '$.visibility')
  const method = oneOf(vis.method, ['cheat', 'editor'] as const, '$.visibility.method')
  if (method === 'cheat') {
    str(vis.code, '$.visibility.code')
    if (vis.verified !== true) fail('$.visibility.verified', 'expected true')
  }

  const cursor = obj(r.cursor, '$.cursor')
  if (cursor.drawnByX !== false) fail('$.cursor.drawnByX', 'expected false')
  if (cursor.parkedAt !== null) point(cursor.parkedAt, '$.cursor.parkedAt')

  const exe = obj(r.executable, '$.executable')
  str(exe.file, '$.executable.file')
  hash(exe.sha256, '$.executable.sha256')
  oneOf(exe.label, LABELS, '$.executable.label')

  if (!Array.isArray(r.archives)) fail('$.archives', 'expected array')
  r.archives.forEach((a, i) => {
    const o = obj(a, `$.archives[${i}]`)
    str(o.file, `$.archives[${i}].file`)
    hash(o.sha256, `$.archives[${i}].sha256`)
  })

  const settings = obj(r.settings, '$.settings')
  str(settings.profileId, '$.settings.profileId')
  obj(settings.values, '$.settings.values')

  const display = obj(r.display, '$.display')
  int(display.width, '$.display.width', 1)
  int(display.height, '$.display.height', 1)
  int(display.depth, '$.display.depth', 1)

  const files = obj(r.files, '$.files')
  for (const k of Object.keys(files)) {
    oneOf(k, ['still', 'volatileMask', 'frames', 'timeline'], `$.files.${k}`)
    str(files[k], `$.files.${k}`)
  }
  if (kind === 'still' && files.still === undefined) fail('$.files.still', 'required for stills')
  if (kind === 'clip') {
    if (files.frames === undefined || files.timeline === undefined) fail('$.files', 'clips need frames and timeline')
    const clip = obj(r.clip, '$.clip')
    int(clip.grabFps, '$.clip.grabFps', 1)
    int(clip.durationMs, '$.clip.durationMs', 1)
    int(clip.distinctFrames, '$.clip.distinctFrames', 1)
    num(clip.shortestStepMs, '$.clip.shortestStepMs')
    bool(clip.resolvesAllSteps, '$.clip.resolvesAllSteps')
  }

  if (r.verification !== undefined) {
    const v = obj(r.verification, '$.verification')
    const mm = obj(v.minimapRect, '$.verification.minimapRect')
    rect(mm, '$.verification.minimapRect')
    const edges = obj(mm.drawnEdges, '$.verification.minimapRect.drawnEdges')
    for (const e of EDGES) bool(edges[e], `$.verification.minimapRect.drawnEdges.${e}`)
    const lvl = obj(v.level, '$.verification.level')
    oneOf(lvl.method, ['minimap-terrain'] as const, '$.verification.level.method')
    if (!Array.isArray(lvl.agreement)) fail('$.verification.level.agreement', 'expected array')
    lvl.agreement.forEach((a, i) => num(a, `$.verification.level.agreement[${i}]`))
    num(lvl.margin, '$.verification.level.margin')
    if (v.mapping !== undefined) {
      const m = obj(v.mapping, '$.verification.mapping')
      oneOf(m.method, ['terrain-render'] as const, '$.verification.mapping.method')
      int(m.compared, '$.verification.mapping.compared', 0)
      int(m.differingRecorded, '$.verification.mapping.differingRecorded', 0)
      int(m.bestDiffering, '$.verification.mapping.bestDiffering', 0)
      const shift = obj(m.bestShift, '$.verification.mapping.bestShift')
      if (Math.abs(int(shift.dx, '$.verification.mapping.bestShift.dx', -1)) > 1) fail('$.verification.mapping.bestShift.dx', 'expected -1, 0 or 1')
      if (Math.abs(int(shift.dy, '$.verification.mapping.bestShift.dy', -1)) > 1) fail('$.verification.mapping.bestShift.dy', 'expected -1, 0 or 1')
    }
  }

  const tooling = obj(r.tooling, '$.tooling')
  for (const k of ['version', 'gitCommit', 'wine', 'ffmpeg', 'xvfb', 'xdotool']) str(tooling[k], `$.tooling.${k}`)

  return value as CaptureRecord
}
