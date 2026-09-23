// Hero types of the base game (RoE/AB/SoD) and how an unmoved hero is drawn on the adventure map
// (specs/003-map-objects/research.md §5).

/** Number of base-game hero classes; class c is drawn with `ah{c:02}_.def`. */
export const HERO_CLASS_COUNT = 18

/**
 * HotA extends the classes to 24: 18 Cove Captain, 19 Cove Navigator, 20 Factory Mercenary,
 * 21 Factory Artificer, plus 22 and 23, which belong to the unreleased Bulwark faction and are not
 * referenced by any shipped map (spec 005 research M7).
 */
export const HOTA_HERO_CLASS_COUNT = 24

/** Hero types 0–143: 18 classes × 8 heroes, in class order (Knight, Cleric, Ranger, … Elementalist). */
const REGULAR_HERO_TYPES = 144

/**
 * SoD special heroes 144–155 and their classes: Sir Mullich (Knight), Adrienne (Witch), Catherine
 * (Knight), Dracon (Wizard), Gelu (Ranger), Kilgor (Barbarian), Lord Haart (Death Knight), Mutare
 * (Overlord), Roland (Knight), Mutare Drake (Overlord), Boragus (Barbarian), Xeron (Demoniac).
 */
const SPECIAL_HERO_CLASSES: readonly number[] = [0, 15, 0, 5, 2, 12, 8, 10, 0, 10, 12, 6]

export const HERO_TYPE_COUNT = REGULAR_HERO_TYPES + SPECIAL_HERO_CLASSES.length

/**
 * HotA also ships a second, gendered body per class (`ah00b_.def`), and which of the two is male
 * differs per class. No measured source for a hero's gender was found, so the renderer keeps the
 * non-suffixed body; the names are listed here so the choice becomes data, not a code change
 * (spec 005 R9).
 */
export function heroBodyDef(heroClass: number, variant: 'default' | 'alternate' = 'default'): string {
  return `ah${String(heroClass).padStart(2, '0')}${variant === 'alternate' ? 'b' : ''}_.def`
}

/** Hero class of a hero type, or undefined for types outside the base game. */
export function heroClassOfType(type: number): number | undefined {
  if (!Number.isInteger(type) || type < 0) return undefined
  if (type < REGULAR_HERO_TYPES) return Math.floor(type / 8)
  return SPECIAL_HERO_CLASSES[type - REGULAR_HERO_TYPES]
}

/**
 * Group (direction) and mirroring of a hero that has not moved. Groups 0–4 of `ah??_.def` are the
 * idle directions up, up-right, right, down-right, down; left-facing directions mirror them.
 * Pending SPIKE T047.
 */
export const HERO_DEFAULT_IDLE = { group: 2, mirror: false } as const

/** Boat-hero sprites by boat type 0–2 (a hero placed on water starts in a boat). Pending SPIKE T047. */
export const BOAT_HERO_DEFS: readonly string[] = ['ab01_.def', 'ab02_.def', 'ab03_.def']
