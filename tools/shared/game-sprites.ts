// Loads object templates (Objects.txt) and sprite masks from the user's archives for footprint and
// floating-tile computations in Node. Masks are computed once per DEF and kept in memory only.

import { LodArchive } from '../../src/core/formats/lod/lod.ts'
import { parseDef } from '../../src/core/formats/def/def.ts'
import { parseObjectsTxt } from '../../src/core/formats/text/objects-txt.ts'
import type { ObjectsTxtRow } from '../../src/core/formats/text/objects-txt.ts'
import { spriteMaskFromDef } from '../../src/core/state/footprint.ts'
import type { SpriteMask } from '../../src/core/state/footprint.ts'
import { CandidateMasks, HERO_SPRITES, outcomeClass } from '../../src/core/state/floating.ts'
import { OBJECT_CLASS } from '../../src/core/data/object-classes.ts'
import { resolveSpriteName } from '../../src/core/data/hota-def-conventions.ts'
import type { WorldState } from '../../src/core/state/world.ts'
import { NodeFileSource } from './node-source.ts'
import { resolveGameFile } from './game-files.ts'

export interface GameSprites {
  templates: ObjectsTxtRow[]
  lookup: (defName: string) => SpriteMask | undefined
  candidates: CandidateMasks
  /** Loads masks for these DEF names (lower-case) so `lookup` can return them synchronously. */
  preload(names: Iterable<string>): Promise<void>
  /** Loads everything floating-tile and footprint computation need for a map. */
  preloadForState(state: WorldState): Promise<void>
}

export async function openGameSprites(opts: { sprites?: string[]; bitmaps?: string } = {}): Promise<GameSprites> {
  const spriteFiles = opts.sprites ?? ['h3sprite.lod', 'H3ab_spr.lod']
  const archives: LodArchive[] = []
  for (const f of spriteFiles) {
    try {
      archives.push(await LodArchive.open(await NodeFileSource.open(resolveGameFile(f))))
    } catch (err) {
      // H3ab_spr.lod is optional (RoE-only installs); h3sprite.lod is not.
      if (f === spriteFiles[0]) throw err
    }
  }
  const bitmaps = await LodArchive.open(await NodeFileSource.open(resolveGameFile(opts.bitmaps ?? 'h3bitmap.lod')))
  const templates = parseObjectsTxt(await bitmaps.read('Objects.txt'))
  const masks = new Map<string, SpriteMask | null>()
  const lookup = (name: string): SpriteMask | undefined => masks.get(name.toLowerCase()) ?? undefined
  const preload = async (names: Iterable<string>): Promise<void> => {
    for (const raw of names) {
      const name = raw.toLowerCase()
      if (masks.has(name)) continue
      const stored = resolveSpriteName(name)
      const archive = archives.find((a) => a.has(stored))
      if (archive === undefined) {
        masks.set(name, null)
        continue
      }
      masks.set(name, spriteMaskFromDef(parseDef(await archive.read(stored), name)))
    }
  }
  const candidates = new CandidateMasks(templates, lookup)
  const preloadForState = async (state: WorldState): Promise<void> => {
    const names = new Set<string>(HERO_SPRITES)
    const classes = new Set<number>([OBJECT_CLASS.HERO])
    for (const o of state.objects.values()) {
      names.add(o.template.defName.toLowerCase())
      if (o.random !== null) classes.add(outcomeClass(o.random))
    }
    for (const t of templates) if (classes.has(t.classId)) names.add(t.defName.toLowerCase())
    await preload(names)
  }
  return { templates, lookup, candidates, preload, preloadForState }
}
