// KDE Plasma bridge, page side (spec 004 US3, contracts/host-bridge.md "KDE"): the QML shell calls
// window.h3wallpaper.apply(json) with the full configuration and setPaused when the wallpaper is
// covered or the screen is locked.

import { createBrowserController } from '../shared/browser-controller.ts'
import { kdeFileUrl } from '../shared/file-url.ts'
import { classicWorkerFactory } from '../shared/worker-factory-classic.ts'

declare global {
  interface Window {
    h3wallpaper?: { apply(json: string): void; setPaused(paused: boolean): void }
  }
}

const { controller } = createBrowserController({
  host: 'kde',
  canvas: document.getElementById('map') as HTMLCanvasElement,
  overlayRoot: document.body,
  fileUrl: kdeFileUrl,
  workerFactory: classicWorkerFactory(),
})

/** Last "new random place" counter from the configuration; a change after the first apply acts. */
let rerollCounter: unknown

window.h3wallpaper = {
  apply(json) {
    let parsed: { settings?: Record<string, unknown>; language?: unknown }
    try {
      parsed = JSON.parse(json) as typeof parsed
    } catch {
      return
    }
    if (typeof parsed.language === 'string' && parsed.language !== '') controller.setLanguage(parsed.language)
    if (parsed.settings === undefined || parsed.settings === null) return
    const { viewreroll, ...settings } = parsed.settings
    controller.applySettings(settings)
    if (rerollCounter !== undefined && viewreroll !== rerollCounter) void controller.flushSettings().then(() => controller.newRandomPlace())
    rerollCounter = viewreroll ?? null
  },
  setPaused: (paused) => controller.setHostPaused(paused === true),
}
