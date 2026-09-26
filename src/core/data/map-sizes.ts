// Standard map sizes (spec 007 research R4): the editor's S–XL and HotA's H, XH and G. A map of a
// non-standard size belongs to the smallest class not smaller than it; anything above G is G.

export const MAP_SIZE_CLASSES = [
  { id: 's', tiles: 36 },
  { id: 'm', tiles: 72 },
  { id: 'l', tiles: 108 },
  { id: 'xl', tiles: 144 },
  { id: 'h', tiles: 180 },
  { id: 'xh', tiles: 216 },
  { id: 'g', tiles: 252 },
] as const

export type SizeClass = (typeof MAP_SIZE_CLASSES)[number]['id']

export const SIZE_CLASS_IDS: readonly SizeClass[] = MAP_SIZE_CLASSES.map((c) => c.id)

export function sizeClassOf(size: number): SizeClass {
  return MAP_SIZE_CLASSES.find((c) => size <= c.tiles)?.id ?? 'g'
}

/** Order of two classes: negative when `a` is smaller. */
export function compareSizeClass(a: SizeClass, b: SizeClass): number {
  return SIZE_CLASS_IDS.indexOf(a) - SIZE_CLASS_IDS.indexOf(b)
}

export function isSizeClass(value: string): value is SizeClass {
  return (SIZE_CLASS_IDS as readonly string[]).includes(value)
}
