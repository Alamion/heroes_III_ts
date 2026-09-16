// Hero types of the base game (RoE/AB/SoD) and how an unmoved hero is drawn on the adventure map
// (specs/003-map-objects/research.md §5).

/** Number of hero classes; class c is drawn with `ah{c:02}_.def`. */
export const HERO_CLASS_COUNT = 18

/** Hero types 0–143: 18 classes × 8 heroes, in class order (Knight, Cleric, Ranger, … Elementalist). */
const REGULAR_HERO_TYPES = 144

/**
 * SoD special heroes 144–155 and their classes: Sir Mullich (Knight), Adrienne (Witch), Catherine
 * (Knight), Dracon (Wizard), Gelu (Ranger), Kilgor (Barbarian), Lord Haart (Death Knight), Mutare
 * (Overlord), Roland (Knight), Mutare Drake (Overlord), Boragus (Barbarian), Xeron (Demoniac).
 */
const SPECIAL_HERO_CLASSES: readonly number[] = [0, 15, 0, 5, 2, 12, 8, 10, 0, 10, 12, 6]

export const HERO_TYPE_COUNT = REGULAR_HERO_TYPES + SPECIAL_HERO_CLASSES.length

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
