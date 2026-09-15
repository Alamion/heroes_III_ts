// Injectable time source (constitution III): rendering and simulation read time only from a Clock.

export interface Clock {
  /** Milliseconds, monotonic within one clock. */
  now(): number
}

/** A clock that only moves when told to; used by tests and headless checks. */
export class ManualClock implements Clock {
  private t: number

  constructor(startMs = 0) {
    this.t = startMs
  }

  now(): number {
    return this.t
  }

  set(ms: number): void {
    this.t = ms
  }

  advance(ms: number): void {
    this.t += ms
  }
}

export function fixedClock(ms: number): Clock {
  return { now: () => ms }
}
