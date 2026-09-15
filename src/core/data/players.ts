// Player slots in H3M order. Flag colours are applied by the objects feature (TODO item 3.1),
// which takes them from the game palette; only names and order are fixed here.

export const PLAYERS = ['red', 'blue', 'tan', 'green', 'orange', 'purple', 'teal', 'pink'] as const

export type PlayerName = (typeof PLAYERS)[number]

export const PLAYER_COUNT = PLAYERS.length

/** Owner byte/u32 value meaning "no owner" in H3M. */
export const NO_OWNER = 0xff
