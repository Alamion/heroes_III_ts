// Lively listeners (spec 004 contracts/host-bridge.md "Lively"): a separate classic script loaded
// first; Lively calls these globals after the page has loaded and on every change.

import { createHostEventQueue } from '../shared/host-events.ts'

export type LivelyEvent = { kind: 'property'; name: string; value: unknown } | { kind: 'playback'; data: unknown }

declare global {
  interface Window {
    livelyPropertyListener?: (name: string, value: unknown) => void
    livelyWallpaperPlaybackChanged?: (data: unknown) => void
  }
}

const queue = createHostEventQueue<LivelyEvent>()
window.__h3hostEvents = queue as never
window.livelyPropertyListener = (name, value) => queue.push({ kind: 'property', name, value })
window.livelyWallpaperPlaybackChanged = (data) => queue.push({ kind: 'playback', data })
