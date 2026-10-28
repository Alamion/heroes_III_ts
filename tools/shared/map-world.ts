// A map file as a world state for the placement tools (spec 009): gzip-aware read, parse, fromH3m.

import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { basename } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { parseH3m } from '../../src/core/formats/h3m/h3m.ts'
import { fromH3m } from '../../src/core/state/world.ts'
import type { WorldState } from '../../src/core/state/world.ts'
import { usage } from './errors.ts'

export interface MapWorld {
  world: WorldState
  /** sha256 of the file as stored. */
  sha256: string
}

export function readMapWorld(path: string, seed = 1): MapWorld {
  const raw = new Uint8Array(readFileSync(path))
  const sha256 = createHash('sha256').update(raw).digest('hex')
  const data = raw[0] === 0x1f && raw[1] === 0x8b ? new Uint8Array(gunzipSync(raw)) : raw
  const map = parseH3m(data, basename(path))
  return { world: fromH3m(map, { sha256, name: basename(path), version: map.version }, seed), sha256 }
}

/** `WIDTHxHEIGHT` in device pixels. */
export function parseViewport(value: string): { width: number; height: number } {
  const m = /^(\d+)x(\d+)$/.exec(value)
  const width = Number(m?.[1])
  const height = Number(m?.[2])
  if (m === null || width <= 0 || height <= 0) throw usage(`--viewport must be WIDTHxHEIGHT, got "${value}"`)
  return { width, height }
}
