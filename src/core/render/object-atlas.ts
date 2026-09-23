// Object atlas (specs/003-map-objects/research.md §1): every frame of the object sprites a map
// needs, cropped, shelf-packed into 2048² index pages, plus one RGBA palette row per sprite. GPU
// memory depends on the distinct sprites of the map, not on the number of objects.

import { FLAG_INDEX, SHADOW_KINDS, SHADOW_MARKER_ALPHA, isShadowMarker } from '../data/animation.ts'
import { HOTA_FLAG_AT_255 } from '../data/hota-def-conventions.ts'
import { decodeFrame } from '../formats/def/def.ts'
import type { DefSprite } from '../formats/def/def.ts'
import { toDisplayColor } from './atlas.ts'

/** Page size WebGL 1.0 guarantees everywhere. */
export const OBJECT_PAGE_SIZE = 2048

/**
 * Upper bound for the page size on GPUs that allow more. 4096 quadruples the sprite area a page
 * holds, which is what a HotA map needs (spec 005): its object sprites do not fit into six 2048²
 * pages. Larger pages are not used: the gain stops mattering and very large textures are slow to
 * upload on the minimum hardware profile.
 */
export const MAX_OBJECT_PAGE_SIZE = 4096

/** Page size for a context whose largest texture is `maxTextureSize`. */
export function objectPageSize(maxTextureSize: number): number {
  return Math.max(OBJECT_PAGE_SIZE, Math.min(MAX_OBJECT_PAGE_SIZE, 2 ** Math.floor(Math.log2(maxTextureSize))))
}
/**
 * Pages are bound to texture units 0–5 of one draw call (the palette uses unit 6); WebGL 1.0
 * guarantees 8 fragment texture units.
 */
export const MAX_OBJECT_PAGES = 6

export interface FrameCell {
  page: number
  /** Top-left of the cropped frame in the page (pixels). */
  u: number
  v: number
  width: number
  height: number
  /** Offset of the cropped frame inside the full frame. */
  x: number
  y: number
}

export interface ObjectSprite {
  def: string
  row: number
  fullWidth: number
  fullHeight: number
  /** Frame cells per group, in file order. */
  groups: FrameCell[][]
}

export interface ObjectAtlasLayout {
  pageSize: number
  pageCount: number
  rowCount: number
  sprites: Record<string, ObjectSprite>
}

export interface ObjectAtlas {
  layout: ObjectAtlasLayout
  /** pageCount pages of pageSize² palette indices. */
  pages: Uint8Array[]
  /** 256 × rowCount × 4 RGBA palettes: index 0 transparent, shadow indices black with a kind marker alpha. */
  palettes: Uint8Array
}

interface PendingFrame {
  sprite: number
  key: number
  width: number
  height: number
  pixels: Uint8Array
  x: number
  y: number
}

/** Builds the atlas; DEFs are processed by name so the result does not depend on input order. */
export function buildObjectAtlas(defs: readonly DefSprite[], pageSize = OBJECT_PAGE_SIZE, maxPages = MAX_OBJECT_PAGES): ObjectAtlas {
  const sorted = [...defs].sort((a, b) => (a.name.toLowerCase() < b.name.toLowerCase() ? -1 : a.name.toLowerCase() > b.name.toLowerCase() ? 1 : 0))
  const pending: PendingFrame[] = []
  const refsBySprite: { offsets: number[][]; def: DefSprite }[] = []
  sorted.forEach((def, sprite) => {
    const seen = new Map<number, number>()
    // A few HotA sprites carry the player-flag colour at palette index 255 instead of 5 (spec 005
    // R10). Moving those pixels to the flag slot here keeps one flag rule in the renderer; the
    // game merges them the same way, and the sprites concerned use both indices for the flag.
    const flagAt255 = HOTA_FLAG_AT_255.has(def.name.toLowerCase())
    const offsets = def.groups.map((g) =>
      g.frames.map((ref) => {
        const key = ref.header.offset
        if (!seen.has(key)) {
          const frame = decodeFrame(def, ref)
          const pixels = frame.pixels
          if (flagAt255) {
            for (let i = 0; i < pixels.length; i++) if (pixels[i] === 255) pixels[i] = FLAG_INDEX
          }
          seen.set(key, pending.length)
          pending.push({ sprite, key, width: frame.width, height: frame.height, pixels, x: frame.x, y: frame.y })
        }
        return seen.get(key) as number
      }),
    )
    refsBySprite.push({ offsets, def })
  })
  // Shelf packing, tallest frames first (stable: ties keep sprite/frame order).
  const order = pending.map((_, i) => i).sort((a, b) => (pending[b] as PendingFrame).height - (pending[a] as PendingFrame).height || a - b)
  const placed: { page: number; u: number; v: number }[] = new Array(pending.length)
  const pages: Uint8Array[] = []
  let page = -1
  let shelfY = 0
  let shelfH = 0
  let cursorX = 0
  const newPage = () => {
    page++
    if (page >= maxPages) {
      const bytes = pending.reduce((n, f) => n + f.width * f.height, 0)
      throw new RangeError(`object atlas needs more than ${maxPages} ${pageSize}² pages (${pending.length} frames, ${bytes} pixels)`)
    }
    pages.push(new Uint8Array(pageSize * pageSize))
    shelfY = 0
    shelfH = 0
    cursorX = 0
  }
  newPage()
  for (const i of order) {
    const f = pending[i] as PendingFrame
    if (f.width > pageSize || f.height > pageSize) throw new RangeError(`frame of ${f.width}x${f.height} does not fit a ${pageSize}² page`)
    if (cursorX + f.width > pageSize) {
      shelfY += shelfH
      shelfH = 0
      cursorX = 0
    }
    if (shelfY + f.height > pageSize) newPage()
    const target = pages[page] as Uint8Array
    for (let y = 0; y < f.height; y++) target.set(f.pixels.subarray(y * f.width, (y + 1) * f.width), (shelfY + y) * pageSize + cursorX)
    placed[i] = { page, u: cursorX, v: shelfY }
    cursorX += f.width
    shelfH = Math.max(shelfH, f.height)
  }
  const palettes = new Uint8Array(256 * sorted.length * 4)
  const sprites: Record<string, ObjectSprite> = {}
  refsBySprite.forEach(({ offsets, def }, row) => {
    const name = def.name.toLowerCase()
    sprites[name] = {
      def: name,
      row,
      fullWidth: def.fullWidth,
      fullHeight: def.fullHeight,
      groups: offsets.map((g) =>
        g.map((i) => {
          const f = pending[i] as PendingFrame
          const p = placed[i] as { page: number; u: number; v: number }
          return { page: p.page, u: p.u, v: p.v, width: f.width, height: f.height, x: f.x, y: f.y }
        }),
      ),
    }
    const base = row * 256 * 4
    for (let i = 0; i < 256; i++) {
      const o = base + i * 4
      if (i === 0) continue
      const shadow = SHADOW_KINDS.get(i)
      // A special index is a shadow only when the sprite marks it as one; otherwise it is a colour.
      if (shadow !== undefined && isShadowMarker(def.palette[i * 3] as number, def.palette[i * 3 + 1] as number, def.palette[i * 3 + 2] as number)) {
        palettes[o + 3] = SHADOW_MARKER_ALPHA[shadow]
        continue
      }
      if (i === FLAG_INDEX) {
        // Replaced by the owner's colour when drawn.
        palettes[o + 3] = 255
        continue
      }
      const [r, g, b] = toDisplayColor(def.palette[i * 3] as number, def.palette[i * 3 + 1] as number, def.palette[i * 3 + 2] as number)
      palettes.set([r, g, b, 255], o)
    }
  })
  return { layout: { pageSize, pageCount: pages.length, rowCount: sorted.length, sprites }, pages, palettes }
}

/** GPU bytes of the object atlas once uploaded. */
export function objectAtlasGpuBytes(layout: ObjectAtlasLayout): number {
  return layout.pageCount * layout.pageSize * layout.pageSize + 256 * layout.rowCount * 4
}
