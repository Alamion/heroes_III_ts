// Frame scheduler (constitution IV, spec 003 research §9): a frame is requested only when something
// visible changed or the time the renderer reports as its next visible change (palette step or
// object tick) is due. While hidden or paused nothing is pending — no animation frame, no timer.

import type { Clock } from '../core/util/clock.ts'

export interface SchedulerHost {
  requestFrame(cb: () => void): number
  cancelFrame(handle: number): void
  setTimer(cb: () => void, ms: number): number
  clearTimer(handle: number): void
}

export interface FrameCallbacks {
  /** Draws a frame at `timeMs`; returns the time of the next visible change, or null. */
  draw(timeMs: number): number | null
}

export class FrameScheduler {
  private readonly host: SchedulerHost
  private readonly clock: Clock
  private readonly callbacks: FrameCallbacks
  private frameHandle: number | undefined
  private timerHandle: number | undefined
  private visible = true
  private paused = false
  private dirty = true
  private nextChange: number | null = null
  /** Frames drawn (for tests and budget checks). */
  frames = 0

  constructor(host: SchedulerHost, clock: Clock, callbacks: FrameCallbacks) {
    this.host = host
    this.clock = clock
    this.callbacks = callbacks
  }

  get active(): boolean {
    return this.visible && !this.paused
  }

  /** Number of pending callbacks (0 while hidden or paused). */
  get pending(): number {
    return (this.frameHandle === undefined ? 0 : 1) + (this.timerHandle === undefined ? 0 : 1)
  }

  invalidate(): void {
    this.dirty = true
    this.schedule()
  }

  setVisible(visible: boolean): void {
    this.visible = visible
    this.update()
  }

  setPaused(paused: boolean): void {
    this.paused = paused
    this.update()
  }

  dispose(): void {
    this.cancelAll()
  }

  private update(): void {
    if (!this.active) {
      this.cancelAll()
      return
    }
    // Time moved while hidden: redraw once, the step is recomputed from the clock.
    this.dirty = true
    this.schedule()
  }

  private cancelAll(): void {
    if (this.frameHandle !== undefined) this.host.cancelFrame(this.frameHandle)
    if (this.timerHandle !== undefined) this.host.clearTimer(this.timerHandle)
    this.frameHandle = undefined
    this.timerHandle = undefined
  }

  private schedule(): void {
    if (!this.active || this.frameHandle !== undefined) return
    if (this.timerHandle !== undefined) {
      this.host.clearTimer(this.timerHandle)
      this.timerHandle = undefined
    }
    this.frameHandle = this.host.requestFrame(() => this.onFrame())
  }

  private onFrame(): void {
    this.frameHandle = undefined
    if (!this.active) return
    const now = this.clock.now()
    if (this.dirty || (this.nextChange !== null && now >= this.nextChange)) {
      this.nextChange = this.callbacks.draw(now)
      this.frames++
      this.dirty = false
    }
    if (this.nextChange !== null) {
      const wait = Math.max(1, this.nextChange - this.clock.now())
      this.timerHandle = this.host.setTimer(() => {
        this.timerHandle = undefined
        this.schedule()
      }, wait)
    }
  }
}
