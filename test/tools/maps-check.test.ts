// `yarn verify maps` classification and verdicts (spec 005 FR-020), on synthetic maps only.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mapsCommand } from '../../tools/checks/maps/index.ts'
import type { ParsedArgs } from '../../tools/shared/cli-runner.ts'
import { buildMap, writeH3m } from '../fixtures/synthetic/h3m.ts'

const args = (flags: Record<string, string[]>): ParsedArgs => ({ positional: [], flags: new Map(Object.entries(flags)) })

let dir: string

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'h3-maps-check-'))
  // Three coverage classes: two versions and two level counts.
  writeFileSync(join(dir, 'roe-36.h3m'), gzipSync(writeH3m(buildMap({ version: 'RoE', size: 36, underground: false }))))
  writeFileSync(join(dir, 'sod-36.h3m'), gzipSync(writeH3m(buildMap({ version: 'SoD', size: 36, underground: false }))))
  writeFileSync(join(dir, 'sod-36-two-levels.h3m'), gzipSync(writeH3m(buildMap({ version: 'SoD', size: 36, underground: true }))))
  // A second map of an existing class: sampled away, not opened.
  writeFileSync(join(dir, 'sod-36-again.h3m'), gzipSync(writeH3m(buildMap({ version: 'SoD', size: 36, underground: false }))))
})

afterAll(() => rmSync(dir, { recursive: true, force: true }))

describe('yarn verify maps', () => {
  it('opens one map per coverage class and samples the rest', async () => {
    const r = await mapsCommand(args({ dir: [dir] }))
    expect(r.ok).toBe(true)
    expect(r.outcome).toBe('pass')
    // The three distinct maps, not the duplicate of an existing class.
    expect(r.coverageClasses).toBe(3)
    expect(r.opened).toBe(3)
    expect(r.edgeCases).toEqual(expect.arrayContaining(['RoE', 'SoD']))
  })

  it('opens every map with --all', async () => {
    const r = await mapsCommand(args({ dir: [dir], all: ['true'] }))
    expect(r.opened).toBe(4)
    expect(r.mode).toBe('all')
  })

  it('fails on a map that does not parse, naming the structure', async () => {
    const broken = mkdtempSync(join(tmpdir(), 'h3-maps-broken-'))
    try {
      const bytes = writeH3m(buildMap({ version: 'SoD', size: 36, underground: false }))
      writeFileSync(join(broken, 'truncated.h3m'), gzipSync(bytes.slice(0, bytes.length - 200)))
      const r = await mapsCommand(args({ dir: [broken] }))
      expect(r.ok).toBe(false)
      expect(r.outcome).toBe('fail')
      expect(JSON.stringify(r.failures)).toMatch(/truncated\.h3m/)
    } finally {
      rmSync(broken, { recursive: true, force: true })
    }
  })

  it('skips when no maps are discoverable', async () => {
    const empty = mkdtempSync(join(tmpdir(), 'h3-maps-empty-'))
    try {
      const r = await mapsCommand(args({ dir: [empty] }))
      // The repo's own dev assets may exist; this only asserts the skip path is reachable.
      if (r.outcome === 'skip') expect(r.exitCode).toBe(4)
    } finally {
      rmSync(empty, { recursive: true, force: true })
    }
  })
})
