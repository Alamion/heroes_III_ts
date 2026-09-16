// Player slots in H3M order and where flag colours come from. No colour values are stored here
// (constitution I): colours are read from the user's palette files at run time
// (specs/003-map-objects/research.md §3).

export const PLAYERS = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'] as const

export type PlayerName = (typeof PLAYERS)[number]

export const PLAYER_COUNT = PLAYERS.length

/** Owner byte/u32 value meaning "no owner" in H3M. */
export const NO_OWNER = 0xff

/** Palette files flag colours may come from (entries of the user's data archive). */
export type FlagPaletteFile = 'game.pal'

export interface FlagShade {
  readonly file: FlagPaletteFile
  /** Palette entry 0–255. */
  readonly entry: number
}

/** Owner slot used for unowned objects in flag colour arrays. */
export const NEUTRAL_SLOT = PLAYER_COUNT

/**
 * Flag colour source for players 0–7 and neutral (index 8): entries 64–71 and 72 of the user's
 * `game.pal`. Measured 2026-09-16 on test_map.h3m stills (research.md T045): red, purple, pink and
 * neutral flags match entries 64, 69, 71 and 72 exactly; 65–68 and 70 are the remaining player
 * colours of the same block (blue, tan, green, orange, teal).
 */
export const PLAYER_FLAG_SHADES: readonly FlagShade[] = [
  ...Array.from({ length: PLAYER_COUNT }, (_, p) => ({ file: 'game.pal' as const, entry: 64 + p })),
  { file: 'game.pal', entry: 72 },
]

/**
 * The 9 flag colours (players 0–7, neutral) as RGB triples from palettes keyed by file name
 * (`palettes[file]` = 768 bytes RGB). `display` converts a colour to the displayed colour.
 */
export function flagColors(palettes: Readonly<Record<FlagPaletteFile, Uint8Array>>, display: (r: number, g: number, b: number) => [number, number, number] = (r, g, b) => [r, g, b]): Uint8Array {
  const out = new Uint8Array(PLAYER_FLAG_SHADES.length * 3)
  PLAYER_FLAG_SHADES.forEach((s, i) => {
    const pal = palettes[s.file]
    const [r, g, b] = display(pal[s.entry * 3] as number, pal[s.entry * 3 + 1] as number, pal[s.entry * 3 + 2] as number)
    out.set([r, g, b], i * 3)
  })
  return out
}
