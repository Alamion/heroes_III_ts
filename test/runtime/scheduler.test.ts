import { describe, expect, it } from 'vitest'
import { FrameScheduler } from '../../src/runtime/scheduler.ts'
import type { SchedulerHost } from '../../src/runtime/scheduler.ts'
import { ManualClock } from '../../src/core/util/clock.ts'
import { cacheKey, CACHE_SCHEMA, noCache } from '../../src/runtime/cache-key.ts'

/** Fake host: frames and timers run only when the test says so. */
class FakeHost implements SchedulerHost {
  frames = new Map<number, () => void>()
  timers = new Map<number, { cb: () => void; at: number }>()
  private next = 1
  private readonly clock: ManualClock
  constructor(clock: ManualClock) {
    this.clock = clock
  }
  requestFrame(cb: () => void): number {
    const h = this.next++
    this.frames.set(h, cb)
    return h
  }
  cancelFrame(h: number): void {
    this.frames.delete(h)
  }
  setTimer(cb: () => void, ms: number): number {
    const h = this.next++
    this.timers.set(h, { cb, at: this.clock.now() + ms })
    return h
  }
  clearTimer(h: number): void {
    this.timers.delete(h)
  }
  /** Runs pending frames. */
  flushFrames(): void {
    const f = [...this.frames.values()]
    this.frames.clear()
    f.forEach((cb) => cb())
  }
  /** Advances the clock to the earliest timer and runs it. */
  runNextTimer(): void {
    const [h, t] = [...this.timers.entries()].sort((a, b) => a[1].at - b[1].at)[0] ?? []
    if (h === undefined || t === undefined) throw new Error('no timer')
    this.timers.delete(h)
    this.clock.set(t.at)
    t.cb()
  }
}

describe('frame scheduler', () => {
  function setup(animated: boolean) {
    const clock = new ManualClock(0)
    const host = new FakeHost(clock)
    const draws: number[] = []
    const s = new FrameScheduler(host, clock, { draw: (t) => (draws.push(t), animated) })
    return { clock, host, draws, s }
  }

  it('draws once on change and stays idle without animation', () => {
    const { host, draws, s } = setup(false)
    s.invalidate()
    host.flushFrames()
    expect(draws).toEqual([0])
    expect(s.pending).toBe(0)
  })

  it('draws at each palette step while animated content is visible', () => {
    const { host, draws, s, clock } = setup(true)
    clock.set(50)
    s.invalidate()
    host.flushFrames()
    expect(host.timers.size).toBe(1)
    host.runNextTimer()
    expect(clock.now()).toBe(180)
    host.flushFrames()
    host.runNextTimer()
    host.flushFrames()
    expect(draws).toEqual([50, 180, 360])
    expect(s.frames).toBe(3)
  })

  it('has zero pending callbacks while hidden or paused and redraws on resume', () => {
    const { host, draws, s, clock } = setup(true)
    s.invalidate()
    host.flushFrames()
    s.setVisible(false)
    expect(s.pending).toBe(0)
    expect(host.frames.size + host.timers.size).toBe(0)
    s.invalidate()
    expect(s.pending).toBe(0)
    clock.set(10_000)
    s.setVisible(true)
    host.flushFrames()
    expect(draws).toEqual([0, 10_000])
    s.setPaused(true)
    expect(s.pending).toBe(0)
  })

  it('keys cache entries by kind, schema and identity and tolerates a missing cache', async () => {
    expect(cacheKey('atlas', 'abc')).toBe(`atlas:${CACHE_SCHEMA}:abc`)
    expect(await noCache.get('world', 'x')).toBeUndefined()
  })
})
