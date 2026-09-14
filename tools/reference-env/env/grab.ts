// ffmpeg-based screen grabs from a virtual display. Frames are raw RGB24 buffers.
import { spawn } from 'node:child_process'
import { ERROR_CODES, RefError } from '../errors.ts'
import type { Rect } from '../model/types.ts'
import { runProcess } from './process.ts'

export interface RawFrame {
  width: number
  height: number
  rgb: Buffer
}

function x11Input(display: string, rect: Rect): string[] {
  return [
    '-loglevel', 'error',
    '-f', 'x11grab',
    '-draw_mouse', '0',
    '-video_size', `${rect.w}x${rect.h}`,
    '-i', `${display}+${rect.x},${rect.y}`,
  ]
}

export async function grabRaw(display: string, rect: Rect): Promise<RawFrame> {
  const r = await runProcess(
    'ffmpeg',
    [...x11Input(display, rect), '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'],
    { timeoutMs: 15_000, check: false },
  )
  const expected = rect.w * rect.h * 3
  if (r.code !== 0 || r.stdout.length !== expected) {
    throw new RefError(ERROR_CODES.GRAB_FAILED, `screen grab of ${display} failed`, {
      details: { code: r.code, bytes: r.stdout.length, expected, stderr: r.stderr.slice(-500) },
    })
  }
  return { width: rect.w, height: rect.h, rgb: r.stdout }
}

export async function writePng(frame: RawFrame, outPath: string): Promise<void> {
  await runProcess(
    'ffmpeg',
    [
      '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-video_size', `${frame.width}x${frame.height}`, '-i', '-',
      '-frames:v', '1', outPath,
    ],
    { input: frame.rgb, timeoutMs: 15_000 },
  )
}

/** Gray 8-bit PNG from a 1-byte-per-pixel buffer (0 or 255). */
export async function writeGrayPng(pixels: Buffer, width: number, height: number, outPath: string): Promise<void> {
  await runProcess(
    'ffmpeg',
    [
      '-loglevel', 'error', '-y',
      '-f', 'rawvideo', '-pix_fmt', 'gray', '-video_size', `${width}x${height}`, '-i', '-',
      '-frames:v', '1', outPath,
    ],
    { input: pixels, timeoutMs: 15_000 },
  )
}

export async function readPng(path: string): Promise<RawFrame> {
  const probe = await runProcess(
    'ffprobe',
    ['-v', 'error', '-select_streams', 'v:0', '-show_entries', 'stream=width,height', '-of', 'csv=p=0', path],
    { timeoutMs: 10_000 },
  )
  const [w, h] = probe.stdout.toString().trim().split(',').map(Number)
  if (w === undefined || h === undefined || !w || !h) throw new RefError(ERROR_CODES.GRAB_FAILED, `cannot read size of ${path}`)
  const r = await runProcess('ffmpeg', ['-loglevel', 'error', '-i', path, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], {
    timeoutMs: 15_000,
  })
  return { width: w, height: h, rgb: r.stdout }
}

export function cropFrame(frame: RawFrame, rect: Rect): RawFrame {
  const out = Buffer.alloc(rect.w * rect.h * 3)
  for (let y = 0; y < rect.h; y++) {
    const src = ((rect.y + y) * frame.width + rect.x) * 3
    frame.rgb.copy(out, y * rect.w * 3, src, src + rect.w * 3)
  }
  return { width: rect.w, height: rect.h, rgb: out }
}

/**
 * Grabs `rect` at a fixed rate for `durationMs`, calling `onFrame` for each raw frame in order.
 * x11grab paces frames by wall clock, so frame i corresponds to i / fps seconds.
 */
export async function grabStream(display: string, rect: Rect, fps: number, durationMs: number, onFrame: (rgb: Buffer) => void): Promise<number> {
  const frameBytes = rect.w * rect.h * 3
  let pending: Buffer = Buffer.alloc(0)
  let frames = 0
  const child = spawn(
    'ffmpeg',
    [
      '-loglevel', 'error',
      '-f', 'x11grab', '-draw_mouse', '0', '-framerate', String(fps),
      '-video_size', `${rect.w}x${rect.h}`, '-i', `${display}+${rect.x},${rect.y}`,
      '-t', (durationMs / 1000).toFixed(3),
      '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  )
  let stderr = ''
  child.stderr.on('data', (d: Buffer) => {
    stderr += d.toString()
  })
  child.stdout.on('data', (chunk: Buffer) => {
    pending = pending.length === 0 ? chunk : Buffer.concat([pending, chunk])
    while (pending.length >= frameBytes) {
      onFrame(Buffer.from(pending.subarray(0, frameBytes)))
      pending = pending.subarray(frameBytes)
      frames++
    }
  })
  const code = await new Promise<number>((res) => child.on('close', (c) => res(c ?? -1)))
  if (code !== 0 || frames === 0) {
    throw new RefError(ERROR_CODES.GRAB_FAILED, `clip grab failed (exit ${code}, ${frames} frames)`, { details: { stderr: stderr.slice(-500) } })
  }
  return frames
}
