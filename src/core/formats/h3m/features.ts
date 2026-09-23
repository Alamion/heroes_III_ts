// What a map format version can contain (specs/005-hota-support/contracts/map-format.md).
//
// The base game has three versions and two feature flags (`ab`, `sod`). HotA keeps the SoD layout
// and adds fields per sub-version, so the differences are a table rather than scattered version
// comparisons. The table's shape follows FreeHeroes (MIT, see THIRD_PARTY_NOTICES.md), which
// covers HotA sub-versions 0-3 and 5; sub-versions 9 and 10 are not described anywhere and were
// measured against the owner's maps (spec 005 research M4, M6).
//
// Provenance of each flag is recorded in its comment:
//   documented - stated by the h3m2json Corpus
//   ported     - implemented by FreeHeroes
//   measured   - derived here from real maps, and only from the sub-versions we have

import type { H3mVersion } from './types.ts'

/** Sub-versions the owner's maps use; these must parse to the exact end of file. */
export const HOTA_REQUIRED_SUBVERSIONS: readonly number[] = [9, 10]

/** Highest HotA sub-version this reader knows anything about. */
export const HOTA_MAX_SUBVERSION = 10

export interface H3mFeatures {
  /** Armageddon's Blade or later. */
  ab: boolean
  /** Shadow of Death or later (HotA is built on SoD). */
  sod: boolean
  /** Horn of the Abyss. */
  hota: boolean
  /** HotA sub-version, null for base-game formats. */
  subVersion: number | null

  // --- HotA header -------------------------------------------------------------------------
  /** measured: three u32 HotA version numbers (1.8.0 for sub 9, 1.8.1 for sub 10). */
  hotaVersionTriple: boolean
  /** ported: u8 isMirrorMap, u8 isArenaMap. */
  hotaMirrorArena: boolean
  /** ported: u32 terrain type count (12 in every measured map). */
  hotaTerrainCount: boolean
  /** ported: u32 town type count + i8 allowed difficulty mask. */
  hotaTownCountAndDifficulty: boolean
  /** measured: u8 "heroes defeated in combat can be hired again". */
  hotaHireDefeated: boolean
  /** measured: u8 "players must run the same HotA version". */
  hotaForceVersion: boolean
  /** measured: i32, zero in all 72 maps; meaning unknown. */
  hotaHeaderReserved: boolean

  // --- counted lists that are fixed-size in the base game -----------------------------------
  /** measured: allowed heroes as u32 count + ceil(count/8) bytes (count 215). */
  hotaCountedHeroes: boolean
  /** measured: allowed artifacts as u32 count + ceil(count/8) bytes (count 166). */
  hotaCountedArtifacts: boolean
  /** measured: hero settings as u32 count + records (count 215), not a fixed 156. */
  hotaCountedHeroSettings: boolean

  // --- map options ---------------------------------------------------------------------------
  /** ported: u8 allowSpecialWeeks + 3 zero bytes. */
  hotaSpecialWeeks: boolean
  /** ported: u32 combined-artifact count + ceil(count/8) ban mask. */
  hotaCombinedArtifactBan: boolean
  /** ported: i32 round limit (-1 = none). */
  hotaRoundLimit: boolean
  /** ported: 8 per-player "cannot recruit heroes" bytes. */
  hotaRecruitmentBlock: boolean

  // --- hero settings and events ---------------------------------------------------------------
  /** ported: u16 scroll spell after every artifact slot id. */
  hotaScrollSpellSlots: boolean
  /** ported: per hero u8 alwaysAddSkills, u8 cannotGainXp, i32 startLevel after the records. */
  hotaHeroLevelBlock: boolean
  /** ported: event occurrence is u16 + 16 zero bytes instead of u8 + 17. */
  hotaEventOccurrenceU16: boolean
  /** measured: i32 affected difficulties on timed events. */
  hotaEventDifficulties: boolean
  /**
   * measured on sub 6: before the difficulty mask existed, a global event ended with the same
   * 14-byte block a town event carries (i32, i32, i32, i16). Sub 7 replaced it with the mask.
   * Assumed to start with the town-event block at sub 5, which no local map exercises.
   */
  hotaEventLegacyTail: boolean
  /** measured: u8 "spell research allowed" after the town spell masks. */
  hotaTownSpellResearch: boolean
  /** measured: u32 count + that many bytes of special-building state in a town. */
  hotaTownSpecialBuildings: boolean
  /** measured: town events carry i32 growth8, i32 amount, i32 specialA, i16 specialB. */
  hotaTownEventExtras: boolean
  /** measured: town events carry u8 "neutral players affected". */
  hotaTownEventNeutral: boolean
  /** measured: events carry u8 hook flag, and when set i32 event id + u8. */
  hotaEventSystemHook: boolean
  /** ported: monsters carry i32 aggression, u8 joinOnlyForMoney, i32 join %, i32 upgraded, i32 split. */
  hotaMonsterAggression: boolean
  /** ported: monsters carry u8 "size by value" + i32 target value. */
  hotaMonsterValue: boolean
  /** ported: creature banks carry a preset block (i32, i8, u32 count, count × u32). */
  hotaCreatureBank: boolean
  /** ported: abandoned mines carry u8 "custom guards" + 12 bytes. */
  hotaMineGuards: boolean
  /** ported: artifact pickups carry u32 mode + u8 flags. */
  hotaArtifactPickup: boolean
  /** ported: seer huts carry counted one-time and recurring quest lists. */
  hotaSeerCounted: boolean
  /** ported: quest mission type 10 (a HotA-only condition with its own sub-types). */
  hotaQuestMission10: boolean
  /** ported: hero placeholders carry a starting army and artifact list. */
  hotaHeroPlaceholderArmy: boolean
  /** ported: pandora boxes and map events carry i32 movement mode + i32 amount. */
  hotaBoxMovement: boolean
  /** ported: pandora boxes and map events carry i32 allowed difficulties. */
  hotaBoxDifficulties: boolean
  /** ported: pandora boxes carry one zero byte before their HotA tail. */
  hotaPandoraPad: boolean
  /** ported: map events carry u8 "human can activate". */
  hotaEventHumanActivate: boolean
  /** ported: classes that have no body in SoD carry a reward block in HotA. */
  hotaRewardBodies: boolean
  /** measured: class 144 subtype 12 carries i32 content + i32 gold + i32 amount + u32 creature. */
  hotaCustomClass144: boolean

  // --- the event system ("script") block ------------------------------------------------------
  /** measured: u8 flag, and when set a walked block with no length prefix (research M5). */
  hotaScriptSection: boolean

  // --- sub-version 10 deltas (research M6) ------------------------------------------------------
  /** measured: +4 bytes at the end of a quest record. */
  hotaQuestTail: boolean
  /** measured: +4 bytes between a seer hut quest and its reward type. */
  hotaSeerQuestTail: boolean
  /** measured: +1 byte after a seer hut object. */
  hotaSeerObjectTail: boolean
}

/**
 * Feature flags of a version. `subVersion` is required for HotA and ignored otherwise.
 *
 * Sub-versions 9 and 10 are required and verified; 0-8 are best-effort from the ported sources,
 * because no map of those sub-versions exists locally (spec 005 FR-006a). A map whose layout does
 * not match still fails honestly: the parse must end exactly at end of file.
 */
export function featuresFor(version: H3mVersion, subVersion: number | null): H3mFeatures {
  const hota = version === 'HotA'
  const sub = hota ? (subVersion ?? 0) : -1
  const from = (min: number): boolean => hota && sub >= min
  return {
    ab: version !== 'RoE',
    sod: version === 'SoD' || hota,
    hota,
    subVersion: hota ? sub : null,

    hotaVersionTriple: from(8),
    hotaMirrorArena: from(1),
    hotaTerrainCount: from(2),
    hotaTownCountAndDifficulty: from(5),
    hotaHireDefeated: from(7),
    hotaForceVersion: from(8),
    hotaHeaderReserved: from(9),

    hotaCountedHeroes: hota,
    hotaCountedArtifacts: hota,
    hotaCountedHeroSettings: hota,

    hotaSpecialWeeks: hota,
    hotaCombinedArtifactBan: from(1),
    hotaRoundLimit: from(3),
    hotaRecruitmentBlock: from(5),

    hotaScrollSpellSlots: from(5),
    hotaHeroLevelBlock: from(5),
    hotaEventOccurrenceU16: from(5),
    hotaEventDifficulties: from(7),
    hotaEventLegacyTail: from(5) && sub < 7,
    hotaTownSpellResearch: hota,
    hotaTownSpecialBuildings: from(5),
    hotaTownEventExtras: from(5),
    hotaTownEventNeutral: from(7),
    hotaEventSystemHook: from(9),
    hotaMonsterAggression: from(3),
    hotaMonsterValue: from(5),
    hotaCreatureBank: from(3),
    hotaMineGuards: from(5),
    hotaArtifactPickup: from(5),
    hotaSeerCounted: from(3),
    hotaQuestMission10: from(3),
    hotaHeroPlaceholderArmy: from(5),
    hotaBoxMovement: from(5),
    hotaBoxDifficulties: from(6),
    hotaPandoraPad: from(5),
    hotaEventHumanActivate: from(3),
    hotaRewardBodies: from(5),
    hotaCustomClass144: from(9),

    hotaScriptSection: from(9),

    hotaQuestTail: from(10),
    hotaSeerQuestTail: from(10),
    hotaSeerObjectTail: from(10),
  }
}
