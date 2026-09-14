// UI geometry of the original Heroes3.exe at 800×600, measured on the Russian Complete build
// (see specs/001-reference-environment/research.md "Spike results"). Numbers only, no game data.
import type { Point, Rect } from '../model/types.ts'

export type Rgb = readonly [number, number, number]

export const GAME_SCREEN = { width: 800, height: 600, depth: 24 } as const

export const GAME_LAYOUT = {
  /** Click that skips the logo/intro videos once they are playing. */
  introSkip: { x: 400, y: 300 } as Point,
  /** Delay before clicking to skip the intro (earlier clicks during the logos are ignored). */
  introSkipAfterMs: 8_000,
  mainNewGame: { x: 645, y: 75 } as Point,
  newGameScenario: { x: 645, y: 65 } as Point,
  scenarioAdvancedOptions: { x: 515, y: 518 } as Point,
  scenarioBegin: { x: 495, y: 553 } as Point,
  scenarioIntroOk: { x: 400, y: 381 } as Point,
  /** Advanced options: one row per player slot, right-arrow x for town, hero and bonus. */
  advancedRowsY: [150, 200, 250, 300] as readonly number[],
  advancedTownNextX: 229,
  advancedHeroNextX: 305,
  advancedBonusNextX: 382,

  /** Inner minimap area (frame excluded). */
  minimap: { x: 630, y: 26, w: 144, h: 144 } as Rect,
  /** Dashed outline of the visible area drawn on the minimap. */
  viewRectColor: [255, 73, 123] as Rgb,
  /** Unexplored (shrouded) minimap pixels. */
  shroudColor: [0, 0, 0] as Rgb,
  /**
   * Mouse park point for grabs: over the hero/army panel, away from every screen edge
   * (the bottom edge scrolls the map), no hover effect inside the viewport.
   */
  cursorPark: { x: 690, y: 470 } as Point,
  /** Cheat reply ("Обманщик!!!") is drawn over the viewport and clears after ~22 s. */
  messageClearMs: 25_000,
} as const

/** Adventure-map view geometry (measured: minimap click centres the view on the clicked tile). */
export const GAME_VIEW = {
  /** Screen rectangle of the adventure-map view (inside the red frame). */
  viewport: { x: 8, y: 8, w: 592, h: 544 } as Rect,
  /** View size in tiles, as drawn by the minimap rectangle (19×17; outer columns are cut by 8 px). */
  viewTiles: { w: 19, h: 17 },
  /** Screen pixel of the top-left corner of the view's origin tile (minimap rectangle top-left). */
  originTilePixel: { x: 0, y: 8 } as Point,
  /** Surface/underground toggle button, and the region whose look tells which level is shown. */
  levelToggle: { x: 727, y: 212 } as Point,
  levelToggleProbe: { x: 712, y: 197, w: 30, h: 30 } as Rect,
} as const
