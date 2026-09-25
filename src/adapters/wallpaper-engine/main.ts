// Wallpaper Engine bridge (spec 004 US1): host events → wallpaper controller.

import { createBrowserController } from '../shared/browser-controller.ts'
import { weFileUrl } from '../shared/file-url.ts'
import { hostEvents } from '../shared/host-events.ts'
import { SETTINGS } from '../shared/settings.ts'
import { classicWorkerFactory } from '../shared/worker-factory-classic.ts'
import type { WeEvent } from './listener.ts'

const { controller } = createBrowserController({
  host: 'wallpaper-engine',
  canvas: document.getElementById('map') as HTMLCanvasElement,
  overlayRoot: document.body,
  fileUrl: weFileUrl,
  workerFactory: classicWorkerFactory(),
})

/** The first user event carries every property, including the action checkbox: not a click. */
let firstUserEvent = true

hostEvents<WeEvent>().attach((event) => {
  if (event.kind === 'user') {
    const acted = !firstUserEvent && event.properties.viewreroll !== undefined
    const nextMap = !firstUserEvent && event.properties.mapnext !== undefined
    firstUserEvent = false
    const raw: Record<string, unknown> = {}
    for (const def of SETTINGS) {
      const p = event.properties[def.key]
      if (p !== undefined && p !== null && 'value' in p) raw[def.key] = p.value
    }
    controller.applySettings(raw)
    if (acted) void controller.flushSettings().then(() => controller.newRandomPlace())
    if (nextMap) void controller.flushSettings().then(() => controller.nextMap())
  } else if (event.kind === 'general') {
    const fps = event.properties.fps
    controller.setFrameLimit(typeof fps === 'number' ? fps : 0)
    const lang = event.properties.language
    if (typeof lang === 'string' && lang !== '') controller.setLanguage(lang)
  } else {
    controller.setHostPaused(event.paused)
  }
})
