import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { decodeFrame, fullFramePixels, parseDef } from '../../src/core/formats/def/def.ts'
import type { DefFrameRef, DefSprite } from '../../src/core/formats/def/def.ts'
import { rotationsFor } from '../../src/core/data/palette-rotation.ts'
import { rotatePalette } from '../../src/core/render/palette-math.ts'
import type { CommandResult, ParsedArgs } from '../shared/cli-runner.ts'
import { flag, intOpt, opt, positional, required } from '../shared/cli-runner.ts'
import { usage } from '../shared/errors.ts'
import { encodePng } from '../shared/png.ts'
import { readEntryArg } from './files.ts'

/** Alpha for special palette indices of adventure-map sprites (research.md §4). */
export const SPECIAL_INDEX_ALPHA: Readonly<Record<number, number>> = { 0: 0, 1: 64, 2: 64, 3: 128, 4: 128, 5: 0, 6: 128, 7: 64 }

async function loadDef(args: ParsedArgs): Promise<DefSprite> {
  const { name, bytes } = await readEntryArg(positional(args, 0, 'FILE:ENTRY'))
  return parseDef(bytes, name)
}

export async function defDump(args: ParsedArgs): Promise<CommandResult> {
  const def = await loadDef(args)
  return {
    ok: true,
    name: def.name,
    type: def.type,
    fullWidth: def.fullWidth,
    fullHeight: def.fullHeight,
    frameCount: def.frameOrder.length,
    specialIndices: { transparent: 0, shadow: [1, 2, 3, 4], selection: 5, flag: 5, shadowVariants: [6, 7] },
    rotations: rotationsFor(def.name),
    groups: def.groups.map((g, gi) => ({
      index: gi,
      type: g.type,
      frames: g.frames.map((f) => ({
        name: f.name,
        viewIndex: f.viewIndex,
        offset: f.header.offset,
        compression: f.header.compression,
        width: f.header.width,
        height: f.header.height,
        x: f.header.x,
        y: f.header.y,
        sharedWith: def.frameOrder.filter((o) => o.header.offset === f.header.offset && o.viewIndex !== f.viewIndex).map((o) => o.viewIndex),
      })),
    })),
  }
}

function pickFrame(def: DefSprite, args: ParsedArgs): DefFrameRef {
  const group = opt(args, 'group')
  if (group !== undefined) {
    const g = def.groups[Number(group)]
    const f = g?.frames[intOpt(args, 'index', 0)]
    if (f === undefined) throw usage(`no frame --group ${group} --index ${opt(args, 'index') ?? 0}`)
    return f
  }
  const ref = def.frameOrder[intOpt(args, 'frame', 0)]
  if (ref === undefined) throw usage(`--frame must be 0..${def.frameOrder.length - 1}`)
  return ref
}

/**
 * RGBA image of palette indices. With `sprite`, indices 0–4 and 6–7 become transparency/shadow
 * alpha (shadow colour black) and index 5 (selection/flag colour) keeps its palette colour.
 */
export function indicesToRgba(pixels: Uint8Array, palette: Uint8Array, sprite: boolean): Uint8Array {
  const out = new Uint8Array(pixels.length * 4)
  for (let i = 0; i < pixels.length; i++) {
    const idx = pixels[i] as number
    const alpha = sprite && idx !== 5 ? SPECIAL_INDEX_ALPHA[idx] : undefined
    if (alpha !== undefined) {
      out[i * 4 + 3] = alpha
      continue
    }
    out[i * 4] = palette[idx * 3] as number
    out[i * 4 + 1] = palette[idx * 3 + 1] as number
    out[i * 4 + 2] = palette[idx * 3 + 2] as number
    out[i * 4 + 3] = 255
  }
  return out
}

export async function defPng(args: ParsedArgs): Promise<CommandResult> {
  const def = await loadDef(args)
  const ref = pickFrame(def, args)
  const frame = decodeFrame(def, ref)
  const full = flag(args, 'full')
  const pixels = full ? fullFramePixels(frame) : frame.pixels
  const width = full ? frame.fullWidth : frame.width
  const height = full ? frame.fullHeight : frame.height
  // Terrain tiles are opaque; other sprites use special indices for transparency and shadow.
  const sprite = !flag(args, 'opaque')
  let palette = def.palette
  const step = opt(args, 'step')
  if (step !== undefined) palette = rotatePalette(def.palette, rotationsFor(def.name), Number(step))
  const out = resolve(required(args, 'out'))
  await mkdir(dirname(out), { recursive: true })
  await writeFile(out, encodePng({ width, height, channels: 4, data: indicesToRgba(pixels, palette, sprite) }))
  return { ok: true, out, frame: ref.name, viewIndex: ref.viewIndex, width, height }
}

export async function defPalette(args: ParsedArgs): Promise<CommandResult> {
  const def = await loadDef(args)
  const step = intOpt(args, 'step', 0)
  const rotations = rotationsFor(def.name)
  const palette = rotatePalette(def.palette, rotations, step)
  const colors: number[][] = []
  for (let i = 0; i < 256; i++) colors.push([palette[i * 3] as number, palette[i * 3 + 1] as number, palette[i * 3 + 2] as number])
  return { ok: true, name: def.name, step, rotations, palette: colors }
}
