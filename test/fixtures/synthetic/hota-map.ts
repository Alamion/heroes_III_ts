// Synthetic HotA map writer (no game content).
//
// It writes format 0x20 by hand rather than extending the base-game writer: the HotA layout is a
// different sequence, and a focused writer keeps the base-game round trip untouched. What it
// produces is what the reader must accept — the HotA header, counted lists, map options, the
// event-system block in both states, terrains 10 and 11, HotA object subtypes and the
// sub-version 10 tails (spec 005 contracts/map-format.md).

import { ByteWriter, gzip } from './writer.ts'

export interface SyntheticHotaMapOptions {
  /** 9 or 10; 10 adds the quest and seer-hut tails. */
  subVersion?: number
  size?: number
  underground?: boolean
  /** Writes an event-system block with one player event. */
  scriptActive?: boolean
  /** Tiles use Highlands (10) and Wasteland (11) as well as grass. */
  hotaTerrains?: boolean
}

/** Object templates the fixture places, with the class/subtype the reader dispatches on. */
const TEMPLATES = [
  { def: 'avccovx0.def', classId: 98, subclassId: 9 }, // Cove castle
  { def: 'avwmrnd0.def', classId: 71, subclassId: 0 }, // random monster
  { def: 'avamnbtw.def', classId: 145, subclassId: 3 }, // HotA custom class: Vial of Mana
  { def: 'avxseer0.def', classId: 83, subclassId: 0 }, // seer hut
] as const

function writeTemplate(w: ByteWriter, t: (typeof TEMPLATES)[number]): void {
  w.string(t.def)
  w.zeros(6) // passable
  w.zeros(6) // active
  w.u16(0x0fff) // allowed terrains (12 bits in HotA)
  w.u16(0x0fff)
  w.u32(t.classId)
  w.u32(t.subclassId)
  w.u8(0)
  w.u8(0)
  w.zeros(16)
}

/** A quest record: mission type 0 (none) plus the sub-10 tail when it applies. */
function writeEmptyQuest(w: ByteWriter, sub: number, standalone: boolean): void {
  w.u8(0)
  if (standalone && sub >= 10) w.zeros(4)
}

export function writeHotaMap(opts: SyntheticHotaMapOptions = {}): Uint8Array {
  const sub = opts.subVersion ?? 10
  const size = opts.size ?? 36
  const levels = opts.underground === true ? 2 : 1
  const w = new ByteWriter()

  // --- header ---------------------------------------------------------------------------------
  w.u32(0x20)
  w.u32(sub)
  if (sub >= 8) w.u32(1).u32(8).u32(sub >= 10 ? 1 : 0) // HotA version triple
  if (sub >= 1) w.u8(0).u8(0) // mirror, arena
  if (sub >= 2) w.u32(12) // terrain type count
  if (sub >= 5) w.u32(12).i8(31) // town type count, difficulty mask
  if (sub >= 7) w.u8(0)
  if (sub >= 8) w.u8(0)
  if (sub >= 9) w.i32(0)
  w.bool(true).u32(size).bool(levels === 2)
  w.string('Synthetic HotA')
  w.string('Синтетическая карта HotA')
  w.u8(1).u8(0) // difficulty, level cap

  // --- players --------------------------------------------------------------------------------
  for (let p = 0; p < 8; p++) {
    const playable = p === 0
    w.bool(playable).bool(false)
    if (!playable) {
      w.zeros(13)
      continue
    }
    w.u8(0) // behavior
    w.u8(0) // SoD alignments
    w.u16(0x0fff) // allowed factions
    w.bool(true) // random faction
    w.bool(false) // no main town
    w.bool(true) // random hero
    w.u8(0xff) // no main hero
    w.u8(0) // AB unknown
    w.u32(0) // hero list
  }

  // --- victory / loss / teams -----------------------------------------------------------------
  w.u8(11).bool(true).bool(false) // HotA victory: defeat all monsters
  w.u8(0xff) // no loss condition
  w.u8(0) // no teams

  // --- counted lists ---------------------------------------------------------------------------
  const heroCount = 215
  w.u32(heroCount).zeros(Math.ceil(heroCount / 8))
  w.u32(0) // reserved campaign heroes
  w.u8(0) // disposed heroes
  w.zeros(31)

  // --- map options -----------------------------------------------------------------------------
  w.bool(true).zeros(3) // special weeks
  if (sub >= 1) w.u32(16).zeros(2) // combined artifact ban
  if (sub >= 3) w.i32(-1) // round limit
  if (sub >= 5) w.zeros(8) // per-player recruitment

  // --- event system ----------------------------------------------------------------------------
  if (sub >= 9) {
    const active = opts.scriptActive === true
    w.bool(active)
    if (active) {
      // Hero, player, town and quest lists; only the player list carries an event.
      w.i32(0)
      w.i32(1)
      w.i32(7) // event id
      w.i32(1).i8(0).i32(1) // action block: marker, reserved, one action
      w.i32(29) // show message
      w.string('Synthetic event')
      w.i32(0) // no images
      w.string('synthetic_event')
      w.i32(0)
      w.i32(0)
      for (let i = 0; i < 5; i++) w.i32(1) // next ids
      w.i32(1) // one variable
      w.i32(1).string('counter').bool(false).bool(false).i32(0)
      w.i32(0) // hero id table
      w.i32(1).i32(7) // player id table
      w.i32(0) // town
      w.i32(0) // quest
      w.i32(1).i32(1) // variable id table
    }
  }

  // --- allowed artifacts / spells / skills, rumors, hero settings ------------------------------
  const artifactCount = 166
  w.u32(artifactCount).zeros(Math.ceil(artifactCount / 8))
  w.zeros(9) // spells
  w.zeros(4) // skills
  w.u32(0) // rumors
  w.u32(heroCount)
  for (let i = 0; i < heroCount; i++) w.bool(false)
  if (sub >= 5) for (let i = 0; i < heroCount; i++) w.u8(0).u8(0).i32(0)

  // --- tiles ------------------------------------------------------------------------------------
  const tiles = size * size * levels
  for (let i = 0; i < tiles; i++) {
    const highlands = opts.hotaTerrains !== false && i % 3 === 1
    const wasteland = opts.hotaTerrains !== false && i % 3 === 2
    const terrain = highlands ? 10 : wasteland ? 11 : 2
    const view = highlands || wasteland ? i % 124 : i % 79
    w.u8(terrain).u8(view).u8(0).u8(0).u8(0).u8(0).u8(0)
  }

  // --- templates and objects ---------------------------------------------------------------------
  w.u32(TEMPLATES.length)
  for (const t of TEMPLATES) writeTemplate(w, t)

  w.u32(TEMPLATES.length)
  TEMPLATES.forEach((t, index) => {
    w.u8(index + 1).u8(index + 1).u8(0)
    w.u32(index)
    w.zeros(5)
    switch (t.classId) {
      case 98: // town
        w.u32(100 + index) // identifier
        w.u8(0) // owner
        w.bool(false) // no name
        w.bool(false) // no garrison
        w.u8(0) // formation
        w.bool(false).bool(true) // no custom buildings, has fort
        w.zeros(9).zeros(9) // spell masks
        w.u8(0) // allow spell research
        if (sub >= 5) w.u32(0) // no special buildings
        w.u32(0) // no events
        w.u8(0xff) // alignment
        w.zeros(3)
        break
      case 71: // random monster
        w.u32(200 + index)
        w.u16(5) // count
        w.u8(0) // disposition
        w.bool(false) // no message
        w.bool(false).bool(false) // never flees, no growth
        w.zeros(2)
        if (sub >= 3) w.i32(-1).u8(0).i32(100).i32(-1).i32(-1)
        if (sub >= 5) w.u8(0).i32(0)
        break
      case 145: // HotA custom class, subtype 3: the small reward form
        if (sub >= 5) w.i32(0).zeros(4)
        break
      case 83: // seer hut: one empty one-time quest, no recurring ones
        w.u32(1)
        writeEmptyQuest(w, sub, false)
        w.u8(0) // empty reward
        w.u32(0)
        w.zeros(2)
        if (sub >= 10) w.zeros(1)
        break
      default:
        break
    }
  })

  // --- global events and trailer ------------------------------------------------------------------
  w.u32(0)
  w.zeros(124)
  return w.toBytes()
}

export function writeHotaMapGz(opts: SyntheticHotaMapOptions = {}): Uint8Array {
  return gzip(writeHotaMap(opts))
}
