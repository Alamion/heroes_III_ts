import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { evaluateMap, evaluateSc007, LIMITS } from '../../tools/checks/budget/evaluate.ts'
import type { MapMeasurement } from '../../tools/checks/budget/evaluate.ts'
import { measureRuntimeSize } from '../../tools/checks/budget/size.ts'

const dirs: string[] = []
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })))

const good: MapMeasurement = {
  map: 'm.h3m',
  coldStartMs: 900,
  warmStartMs: 400,
  memoryBytes: 8_000_000,
  surface: { width: 1920, height: 1080 },
  display: { width: 1920, height: 1080, dpr: 1 },
  hiddenFrames: 0,
  hiddenPending: 0,
  idleFrames: 28,
  idleWindowMs: 5000,
  animatedInView: true,
}

describe('budget evaluation', () => {
  it('passes measurements within the constitution budgets', () => {
    expect(evaluateMap(good).every((b) => b.status === 'pass')).toBe(true)
  })

  it('fails each budget that is exceeded', () => {
    const bad = evaluateMap({ ...good, warmStartMs: 2500, surface: { width: 3000, height: 1080 }, hiddenFrames: 2, hiddenPending: 1, idleFrames: 60, memoryBytes: LIMITS.memoryBytes + 1 })
    expect(bad.filter((b) => b.status === 'fail').map((b) => b.id).sort()).toEqual(['hidden-frames', 'hidden-timers', 'idle-cadence', 'memory', 'surface', 'warm-start'])
    // A static view may present one frame and then stay idle.
    expect(evaluateMap({ ...good, animatedInView: false, idleFrames: 2 }).find((b) => b.id === 'idle-cadence')?.status).toBe('fail')
  })

  it('allows one late frame beyond the animation changes of an idle window', () => {
    const cadence = (idleFrames: number) => evaluateMap({ ...good, idleWindowMs: 5023, idleFrames }).find((b) => b.id === 'idle-cadence')
    expect(cadence(29)?.limit).toBe(29)
    expect(cadence(29)?.status).toBe('pass')
    expect(cadence(30)?.status).toBe('fail')
  })

  it('limits the object atlas and counts object ticks in the idle cadence', () => {
    expect(evaluateMap({ ...good, objectAtlasBytes: 4 * 2048 * 2048 }).find((b) => b.id === 'object-atlas-bytes')?.status).toBe('pass')
    expect(evaluateMap({ ...good, objectAtlasBytes: 20 * 2048 * 2048 }).find((b) => b.id === 'object-atlas-bytes')?.status).toBe('fail')
  })

  it('requires equal work across map sizes for SC-007 with the CPU tolerance', () => {
    const small = { drawCalls: 4, vertices: 47520, gpuBytes: 2_000_000, objectQuads: 300, medianFrameCpuMs: 1 }
    expect(evaluateSc007(small, { ...small, medianFrameCpuMs: 1.2 }).every((b) => b.status === 'pass')).toBe(true)
    const worse = evaluateSc007(small, { drawCalls: 5, vertices: 90000, gpuBytes: 30_000_000, objectQuads: 900, medianFrameCpuMs: 2 })
    expect(worse.map((b) => b.status)).toEqual(['fail', 'fail', 'fail', 'fail', 'fail'])
    // Tiny frame times use the absolute floor.
    expect(evaluateSc007({ ...small, medianFrameCpuMs: 0.1 }, { ...small, medianFrameCpuMs: 0.5 }).find((b) => b.id === 'sc007-frame-cpu')?.status).toBe('pass')
  })

  it('counts runtime chunks and excludes harness entries', () => {
    const dist = mkdtempSync(join(tmpdir(), 'dist-'))
    dirs.push(dist)
    mkdirSync(join(dist, 'assets'))
    writeFileSync(join(dist, 'assets', 'engine-AbCd1234.js'), 'x'.repeat(5000))
    writeFileSync(join(dist, 'assets', 'worker-EfGh5678.js'), 'y'.repeat(5000))
    writeFileSync(join(dist, 'assets', 'index-IjKl9012.js'), 'z'.repeat(5000))
    const r = measureRuntimeSize(dist)
    expect(r.files.find((f) => f.file.startsWith('index'))?.role).toBe('harness')
    expect(r.runtimeGzipBytes).toBe(r.files.filter((f) => f.role === 'runtime').reduce((n, f) => n + f.gzipBytes, 0))
    expect(r.files.filter((f) => f.role === 'runtime')).toHaveLength(2)
  })
})
