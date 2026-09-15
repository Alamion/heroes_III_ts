// Simulation events: the only way world state changes (constitution VI). This feature implements
// the passage of animation time; the other kinds are reserved for later features.

import type { ObjectId, WorldState } from '../state/world.ts'

export type SimEvent =
  | { kind: 'advanceTime'; deltaMs: number }
  | { kind: 'setTime'; timeMs: number }
  | { kind: 'objectRemoved'; objectId: ObjectId }
  | { kind: 'objectVisited'; objectId: ObjectId }
  | { kind: 'heroMoved'; objectId: ObjectId; x: number; y: number; z: number }
  | { kind: 'ownershipChanged'; objectId: ObjectId; owner: number | null }
  | { kind: 'dayAdvanced' }

export class UnsupportedEventError extends Error {
  constructor(kind: string) {
    super(`simulation event "${kind}" is not implemented yet`)
    this.name = 'UnsupportedEventError'
  }
}

/** Returns a new state; unchanged parts (terrain, objects) are shared with the input. */
export function applyEvent(state: WorldState, event: SimEvent): WorldState {
  switch (event.kind) {
    case 'advanceTime':
      if (!Number.isFinite(event.deltaMs) || event.deltaMs < 0) throw new RangeError(`advanceTime needs a finite delta >= 0 (got ${event.deltaMs})`)
      return event.deltaMs === 0 ? state : { ...state, animationTimeMs: state.animationTimeMs + event.deltaMs }
    case 'setTime':
      if (!Number.isFinite(event.timeMs) || event.timeMs < 0) throw new RangeError(`setTime needs a finite time >= 0 (got ${event.timeMs})`)
      return event.timeMs === state.animationTimeMs ? state : { ...state, animationTimeMs: event.timeMs }
    case 'objectRemoved':
    case 'objectVisited':
    case 'heroMoved':
    case 'ownershipChanged':
    case 'dayAdvanced':
      throw new UnsupportedEventError(event.kind)
  }
}
