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

/** The name an archive actually stores this sprite under. */
export function resolveSpriteName(defName: string): string {
  return HOTA_SPRITE_ALIASES.get(defName.toLowerCase()) ?? defName
}
