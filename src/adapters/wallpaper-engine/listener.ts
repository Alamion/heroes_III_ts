// Wallpaper Engine listener (spec 004 contracts/host-bridge.md): a separate classic script loaded
// first, so the first applyUserProperties call (all properties) is never missed.

import { createHostEventQueue } from '../shared/host-events.ts'

export type WeEvent =
  | { kind: 'user'; properties: Record<string, { value?: unknown } | undefined> }
  | { kind: 'general'; properties: Record<string, unknown> }
  | { kind: 'paused'; paused: boolean }

declare global {
  interface Window {
    wallpaperPropertyListener?: {
      applyUserProperties(properties: Record<string, { value?: unknown } | undefined>): void
      applyGeneralProperties(properties: Record<string, unknown>): void
      setPaused(paused: boolean): void
    }
  }
}

const queue = createHostEventQueue<WeEvent>()
window.__h3hostEvents = queue as never
window.wallpaperPropertyListener = {
  applyUserProperties: (properties) => queue.push({ kind: 'user', properties }),
  applyGeneralProperties: (properties) => queue.push({ kind: 'general', properties }),
  setPaused: (paused) => queue.push({ kind: 'paused', paused: paused === true }),
}
