// Event queue between a host listener script and the wallpaper bundle (spec 004 R3): hosts may call
// their listeners before the bundle has started, so the listener (a separate classic script that
// runs first) queues events and replays them in order once the bundle attaches.

export interface HostEventQueue<E> {
  push(event: E): void
  attach(handler: (event: E) => void): void
}

declare global {
  interface Window {
    __h3hostEvents?: HostEventQueue<unknown>
  }
}

export function createHostEventQueue<E>(): HostEventQueue<E> {
  const queued: E[] = []
  let handler: ((event: E) => void) | undefined
  return {
    push(event) {
      if (handler === undefined) queued.push(event)
      else handler(event)
    },
    attach(h) {
      handler = h
      for (const e of queued.splice(0)) h(e)
    },
  }
}

/** The queue the listener script installed, or a fresh one (pages opened without the listener). */
export function hostEvents<E>(): HostEventQueue<E> {
  window.__h3hostEvents ??= createHostEventQueue<unknown>()
  return window.__h3hostEvents as HostEventQueue<E>
}
