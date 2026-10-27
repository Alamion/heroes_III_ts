// HotA sprite conventions (specs/005-hota-support/contracts/render-data.md). Only a name alias needs
// a table; the render conventions surveyed need none, the sprite says them itself:
//
// - Shadows in palette indices 2 and 3: a special index is a shadow only when its palette entry is a
//   marker colour (`isShadowMarker` in `animation.ts`).
// - The player flag: index 5 is a flag only when its palette entry is a flag marker
//   (`isFlagMarker`). A list ported from MMArchiveCLI named nine sprites whose flag would sit at
//   index 255; none of them is an ownable object and all nine keep ordinary colours at 5 (dark) and
//   255 (near white), so the list turned their portals and plants grey. It was removed
//   (2026-09-28, owner's report on `test_map_hota.h3m`; spec 005 research "Flag markers").

/**
 * Sprite names HotA's own object tables get wrong. Measured (spec 005 T057): three shipped maps
 * place an object whose template names `avwcoat.def`, while the archive holds `avwccoat.def` —
 * note that the matching mask file *is* called `avwcoat.msk`, so the sprite name is the typo. The
 * game resolves it; without this alias those objects would be reported unresolved and not drawn.
 */
export const HOTA_SPRITE_ALIASES: ReadonlyMap<string, string> = new Map([['avwcoat.def', 'avwccoat.def']])

/** A sprite HotA redrew in place, keeping its name, so maps saved before carry an outdated template. */
export interface MovedSprite {
  /** Lower-case DEF name. */
  def: string
  /** Full frame size of the redrawn sprite; another size is the old drawing, which needs no move. */
  fullWidth: number
  fullHeight: number
  /** The template the redrawn sprite belongs to (6-byte masks, as `Objects.txt` and maps store them). */
  passable: Uint8Array
  active: Uint8Array
}

/**
 * HotA 1.8 redrew the water garrison one tile up and to the left of the old drawing (128×64 in
 * 1.7.x, 160×128 in 1.8.0 and 1.8.1) without renaming it, and no table of the archive lists it, so
 * its template is kept here: the one the 1.8.1 editor writes (`[HotA] Beltway.h3m` re-saved, sub 10).
 * A map saved by an older editor keeps the old template, and HotA 1.8.1 still shows its garrison with
 * the entrance where the author put it (capture of the sub-7 Beltway, 2026-10-27; VCMI does the same).
 */
export const HOTA_MOVED_SPRITES: readonly MovedSprite[] = [
  {
    def: 'avcgarw1.def',
    fullWidth: 160,
    fullHeight: 128,
    passable: Uint8Array.of(255, 255, 255, 255, 143, 255),
    active: Uint8Array.of(0, 0, 0, 0, 32, 0),
  },
]

/** The name an archive actually stores this sprite under. */
export function resolveSpriteName(defName: string): string {
  return HOTA_SPRITE_ALIASES.get(defName.toLowerCase()) ?? defName
}
