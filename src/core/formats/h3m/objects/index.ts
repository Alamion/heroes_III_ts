// Exhaustive object body dispatch (constitution VII): every base-game class maps to a reader or
// to an explicit "no body"; anything else is UNSUPPORTED_OBJECT, never a silent skip.

import { bodyFamily, className } from '../../../data/object-classes.ts'
import type { BodyFamily } from '../../../data/object-classes.ts'
import { FORMAT_ERROR_CODES } from '../../../util/errors.ts'
import type { H3mContext } from '../context.ts'
import type { MapObject, ObjectBody, ObjectTemplate } from '../types.ts'
import { readHero, readHeroPlaceholder } from './hero.ts'
import { readEvent, readGarrison, readGrail, readMessage, readOwned, readPandora, readRandomDwelling, readScholar, readShrine, readWitchHut } from './misc.ts'
import { readArtifact, readMonster, readResource, readSpellScroll } from './pickups.ts'
import { readQuestGuard, readSeerHut } from './quest.ts'
import { readTown } from './town.ts'

function readBody(c: H3mContext, family: BodyFamily): ObjectBody {
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
      return readGrail(c)
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
          const family = bodyFamily(template.classId)
          if (family === undefined) {
            return r.fail(FORMAT_ERROR_CODES.UNSUPPORTED_OBJECT, `object class ${template.classId} (${className(template.classId)}, template "${template.defName}") is not a base-game class`, offset)
          }
          const body = r.scope(`body(${className(template.classId)})`, () => readBody(c, family))
          return { index, x, y, z, templateIndex, classId: template.classId, subclassId: template.subclassId, offset, body }
        }),
      )
    }
    return objects
  })
}
