// UI geometry of the original h3maped.exe on a 1280×1024 virtual display without a window manager
// (window at 4,30 size 952×734; measured, see research.md "Spike results"). Numbers only.
import type { Point, Rect } from '../model/types.ts'

export const EDITOR_SCREEN = { width: 1280, height: 1024, depth: 24 } as const

export const EDITOR_LAYOUT = {
  window: { x: 4, y: 30, w: 952, h: 734 } as Rect,
  /** Map drawing area (between the rulers and the scrollbars). */
  viewport: { x: 19, y: 124, w: 698, h: 603 } as Rect,
  /** Pixel of the top-left corner of the view's first tile. */
  originTilePixel: { x: 19, y: 124 } as Point,
  /** Whole tiles the view scrolls by; a minimap click puts the clicked tile at origin + centre. */
  viewTiles: { w: 21, h: 18 },
  clickCentre: { x: 10, y: 9 },
  minimap: { x: 739, y: 111, w: 144, h: 144 } as Rect,
  /** Toolbar toggles. */
  undergroundToggle: { x: 336, y: 64 } as Point,
  undergroundToggleProbe: { x: 324, y: 52, w: 24, h: 24 } as Rect,
  gridToggle: { x: 360, y: 64 } as Point,
  /** Outside the editor window: no tile hover highlight, no ruler highlight. */
  cursorPark: { x: 1200, y: 1000 } as Point,
} as const

export const EDITOR_OVERLAYS = { grid: EDITOR_LAYOUT.gridToggle } as const
export type EditorOverlay = keyof typeof EDITOR_OVERLAYS
