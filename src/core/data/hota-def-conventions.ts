// HotA sprite conventions that cannot be derived from the sprite itself
// (specs/005-hota-support/contracts/render-data.md).
//
// Two conventions were surveyed. Only one of them needs a table:
//
// - Shadows in palette indices 2 and 3. Not listed here: sweeping both archives (spec 005 T041)
//   found those indices in 699 of 1072 HotA adventure sprites and in 2 of 1369 base-game ones,
//   where they cover 1 and 25 pixels in total. The index is the signal, so `SHADOW_KINDS` in
//   `animation.ts` covers it for every sprite.
// - The player-flag colour at index 255 instead of index 5. This one *is* a per-file rule: index
//   255 is an ordinary colour elsewhere (1052 of 1369 base-game adventure sprites use it), and the
//   sprites that follow the rule use index 5 as well, so nothing in the pixels distinguishes them.
//
// The list below is therefore ported from MMArchiveCLI (MIT, see THIRD_PARTY_NOTICES.md) and is
// **not independently verified**: a wrong entry would tint a sprite's index-255 pixels with the
// owner's colour. It is deliberately short and covers only names that source lists.

/** Sprites whose player-flag colour sits at palette index 255 instead of `FLAG_INDEX` (5). */
export const HOTA_FLAG_AT_255: ReadonlySet<string> = new Set([
  'avswplnt.def',
  'avxmn6o0.def',
  'avxmn7o0.def',
  'avxmn9b0.def',
  'avxmn10b.def',
  'avxmn12b.def',
  'avwjugg.def',
  'avwtobtw.def',
  'avxseec0.def',
])

/** Sprites whose index-5 pixels are an ordinary colour and must not be made transparent. */
export const HOTA_KEEP_SELECTION: ReadonlySet<string> = new Set(['ava0037.def'])

/** Palette index carrying the flag colour in this sprite. */
export function flagIndexFor(defName: string, baseIndex: number): number {
  return HOTA_FLAG_AT_255.has(defName.toLowerCase()) ? 255 : baseIndex
}
