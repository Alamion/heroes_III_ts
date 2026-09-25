// Lively bridge (spec 004 US4): property and playback events → wallpaper controller. Dropdowns send
// the option index; folderDropdown sends `userfiles\name` (or null).

import { createBrowserController } from '../shared/browser-controller.ts'
import { livelyFileUrl } from '../shared/file-url.ts'
import { hostEvents } from '../shared/host-events.ts'
import { SETTINGS } from '../shared/settings.ts'
import { classicWorkerFactory } from '../shared/worker-factory-classic.ts'
import type { LivelyEvent } from './listener.ts'

const { controller } = createBrowserController({
  host: 'lively',
  canvas: document.getElementById('map') as HTMLCanvasElement,
  overlayRoot: document.body,
  fileUrl: livelyFileUrl,
  workerFactory: classicWorkerFactory(),
})

hostEvents<LivelyEvent>().attach((event) => {
  if (event.kind === 'playback') {
    try {
      const parsed = (typeof event.data === 'string' ? JSON.parse(event.data) : event.data) as { IsPaused?: unknown }
      controller.setHostPaused(parsed.IsPaused === true)
    } catch {
      // Not a playback message.
    }
    return
  }
  if (event.name === 'viewreroll') {
    void controller.flushSettings().then(() => controller.newRandomPlace())
    return
  }
  if (event.name === 'mapnext') {
    void controller.flushSettings().then(() => controller.nextMap())
    return
  }
  const def = SETTINGS.find((d) => d.key === event.name)
  if (def === undefined) return
  let value: unknown = event.value
  if (def.type === 'enum' && typeof value === 'number') value = def.options[value]?.value ?? def.default
  if (def.type === 'file') value = typeof value === 'string' ? value : ''
  controller.applySettings({ [def.key]: value })
})
