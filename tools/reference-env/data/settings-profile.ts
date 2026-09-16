// Fixed game settings and scripted-input conventions for captures.
//
// The dedicated Wine prefix starts clean, and the original executable only writes its options to
// the registry on a normal exit, which captures never perform. Every capture therefore runs with
// the game's built-in defaults (walk/scroll speed, animation options). The profile records that
// explicitly so any future override is visible in records.

export const SETTINGS_PROFILE = {
  profileId: 'defaults-clean-prefix-v1',
  registryKey: 'HKCU\\Software\\New World Computing\\Heroes of Might and Magic® III\\1.0',
  /** Registry overrides applied before launch (none: game defaults). */
  overrides: [] as readonly { name: string; type: 'REG_SZ' | 'REG_DWORD'; value: string; purpose: string }[],
} as const

export const CHEAT_INPUT = {
  /**
   * Codes in the order they are typed. Only `nwcwhatisthematrix` works in the original build
   * (`nwctheone` is HD Mod-specific). It is repeated because a scenario intro message the probe
   * does not recognise (another size, e.g. Merchant Princes.h3m) swallows the first attempt, whose
   * Return closes the message (spec 003 research §11).
   */
  codes: ['nwcwhatisthematrix', 'nwcwhatisthematrix', 'nwcwhatisthematrix', 'nwctheone'] as readonly string[],
  messageLineKey: 'Tab',
  /** The Russian build types Cyrillic by key position unless Ctrl is held. */
  holdKey: 'Control_L',
  keyDelayMs: 120,
} as const

/** Fixed start choices (FR-009a): one "next" click from Random on each selector. */
export const FIXED_START = {
  /** Town: first town in the list; hero: first hero of that town (human player only). */
  townClicks: 1,
  heroClicks: 1,
  /** Bonus: Random → Artifact → Gold; gold is deterministic. */
  bonusClicks: 2,
  description: { town: 'first town (Castle)', hero: 'first hero of that town (human player)', bonus: 'gold' },
} as const
