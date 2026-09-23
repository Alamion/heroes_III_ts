// Exhaustive object body dispatch (constitution VII): every base-game class maps to a reader or
// to an explicit "no body"; anything else is UNSUPPORTED_OBJECT, never a silent skip.

import { bodyFamily, className, OBJECT_CLASS } from '../../../data/object-classes.ts'
import type { BodyFamily } from '../../../data/object-classes.ts'
import { FORMAT_ERROR_CODES } from '../../../util/errors.ts'
import { getLogLevel, log } from '../../../util/log.ts'
import type { H3mContext } from '../context.ts'
import type { MapObject, ObjectBody, ObjectTemplate } from '../types.ts'
import { readHero, readHeroPlaceholder } from './hero.ts'
import { readAbandonedMine, readEvent, readGarrison, readGrail, readMessage, readOwned, readPandora, readRandomDwelling, readScholar, readShrine, readWitchHut } from './misc.ts'
import {
  readBlackMarket,
  readCreatureBank,
  readCustomClass144,
  readCustomClass145,
  readCustomClass146,
  readRewardContent4,
  readRewardCustom18,
  readRewardCustom8,
} from './hota.ts'
import { readArtifact, readMonster, readResource, readSpellScroll } from './pickups.ts'
import { readQuestGuard, readSeerHut } from './quest.ts'
import { readTown } from './town.ts'

const C = OBJECT_CLASS

/** Abandoned mine subtype of class 53 (the other subtypes are ordinary owned mines). */
const MINE_ABANDONED_SUBTYPE = 7
/** HotA reuses these border-gate subtypes: a quest gate and a grave. */
const BORDER_GATE_QUEST = 1000
const BORDER_GATE_GRAVE = 1001

/**
 * Bodies HotA adds or changes for a (class, subtype) pair. Returns undefined when the base-game
 * dispatch applies (specs/005-hota-support/contracts/map-format.md).
 */
function readHotaBody(c: H3mContext, classId: number, subclassId: number): ObjectBody | undefined {
  if (!c.f.hota) return undefined
  switch (classId) {
    case C.CREATURE_BANK:
    case C.DERELICT_SHIP:
    case C.DRAGON_UTOPIA:
    case C.CRYPT:
    case C.SHIPWRECK:
      return readCreatureBank(c)
    case C.MINE:
      return subclassId === MINE_ABANDONED_SUBTYPE ? readAbandonedMine(c) : undefined
    case C.ABANDONED_MINE:
      return readAbandonedMine(c)
    case C.BORDER_GATE:
      if (subclassId === BORDER_GATE_QUEST) return readQuestGuard(c)
      if (subclassId === BORDER_GATE_GRAVE) return c.f.hotaRewardBodies ? readRewardCustom18(c) : { kind: 'none' }
      return { kind: 'none' }
    case 144:
      return readCustomClass144(c, subclassId)
    case 145:
      return readCustomClass145(c, subclassId)
    case 146:
      return readCustomClass146(c, subclassId)
    default:
      break
  }
  if (!c.f.hotaRewardBodies) return undefined
  switch (classId) {
    case C.CAMPFIRE:
    case C.LEAN_TO:
    case C.WAGON:
      return readRewardCustom18(c)
    case C.CORPSE:
    case C.SEA_CHEST:
    case C.SHIPWRECK_SURVIVOR:
    case C.TREASURE_CHEST:
    case C.WARRIORS_TOMB:
      return readRewardCustom8(c)
    case C.FLOTSAM:
    case C.TREE_OF_KNOWLEDGE:
    case C.PYRAMID:
    case C.UNIVERSITY:
      return readRewardContent4(c)
    case C.BLACK_MARKET:
      return readBlackMarket(c)
    default:
      return undefined
  }
}

function readBody(c: H3mContext, family: BodyFamily, subclassId: number): ObjectBody {
  switch (family) {
    case 'none':
      return { kind: 'none' }
    case 'event':
      return readEvent(c)
    case 'hero':
      return readHero(c)
    case 'monster':
      return readMonster(c)
    case 'message':
      return readMessage(c)
    case 'seerHut':
      return readSeerHut(c)
    case 'witchHut':
      return readWitchHut(c)
    case 'scholar':
      return readScholar(c)
    case 'garrison':
      return readGarrison(c)
    case 'artifact':
      return readArtifact(c)
    case 'spellScroll':
      return readSpellScroll(c)
    case 'resource':
      return readResource(c)
    case 'town':
      return readTown(c)
    case 'owned':
      return readOwned(c)
    case 'shrine':
      return readShrine(c)
    case 'pandora':
      return readPandora(c)
    case 'grail':
      return readGrail(c, subclassId)
    case 'randomDwelling':
      return readRandomDwelling(c, true, true)
    case 'randomDwellingLevel':
      return readRandomDwelling(c, true, false)
    case 'randomDwellingFaction':
      return readRandomDwelling(c, false, true)
    case 'questGuard':
      return readQuestGuard(c)
    case 'heroPlaceholder':
      return readHeroPlaceholder(c)
  }
}

export function readObjects(c: H3mContext, templates: readonly ObjectTemplate[], size: number, levels: number): MapObject[] {
  const r = c.r
  return r.scope('objects', () => {
    const at = r.offset
    const count = r.u32()
    if (count > 100_000) r.invalid(`object count ${count} exceeds 100000`, at)
    const objects: MapObject[] = []
    for (let index = 0; index < count; index++) {
      objects.push(
        r.scope(`[${index}]`, () => {
          const offset = r.offset
          const x = r.u8()
          const y = r.u8()
          const z = r.u8()
          const templateIndex = r.u32()
          const template = templates[templateIndex]
          if (template === undefined) return r.invalid(`template index ${templateIndex} outside 0..${templates.length - 1}`, offset + 3)
          // Objects may stand on the map edge with their sprite outside, but the anchor tile must
          // be within the map area plus the 8×6 template extent.
          if (x >= size + 8 || y >= size + 6 || z >= levels) r.invalid(`position (${x},${y},${z}) outside the map`, offset)
          r.zeros(5, 'object header padding')
          // Per-object tracing is the only practical way to align a reader against a map file;
          // the level check keeps it from building a string per object when it is off.
          if (getLogLevel() === 'debug') {
            log.debug(`h3m object ${index} at ${offset}: class ${template.classId} (${className(template.classId)}) sub ${template.subclassId} "${template.defName}" at (${x},${y},${z})`)
          }
          const family = bodyFamily(template.classId)
          if (family === undefined) {
            return r.fail(FORMAT_ERROR_CODES.UNSUPPORTED_OBJECT, `object class ${template.classId} (${className(template.classId)}, template "${template.defName}") is not a base-game class`, offset)
          }
          const body = r.scope(`body(${className(template.classId)})`, () => {
            const hotaBody = readHotaBody(c, template.classId, template.subclassId)
            return hotaBody ?? readBody(c, family, template.subclassId)
          })
          return { index, x, y, z, templateIndex, classId: template.classId, subclassId: template.subclassId, offset, body }
        }),
      )
    }
    return objects
  })
}
