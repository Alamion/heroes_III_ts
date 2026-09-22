// Synthetic H3M writer: the exact inverse of src/core/formats/h3m (so parse → write reproduces a
// real map byte for byte), plus a builder for maps containing every object body family.
// Synthetic maps contain no game content.

import { bodyFamily, OBJECT_CLASS } from '../../../src/core/data/object-classes.ts'
import type { H3String } from '../../../src/core/util/byte-reader.ts'
import type {
  CreatureStack,
  Guard,
  H3mMap,
  H3mVersion,
  HeroArtifacts,
  HeroSettings,
  MapObject,
  ObjectBody,
  ObjectTemplate,
  PlayerInfo,
  PrimarySkills,
  Quest,
  Reward,
  SeerReward,
  TimedEvent,
} from '../../../src/core/formats/h3m/types.ts'
import { H3M_VERSION_CODES, TILE_RECORD_SIZE } from '../../../src/core/formats/h3m/types.ts'
import { ByteWriter, gzip } from './writer.ts'

interface Ctx {
  w: ByteWriter
  ab: boolean
  sod: boolean
}

const str = (c: Ctx, s: H3String) => c.w.u32(s.bytes.length).bytes(s.bytes)
const artifactId = (c: Ctx, v: number) => (c.ab ? c.w.u16(v) : c.w.u8(v))
const creatureId = artifactId
const stack = (c: Ctx, s: CreatureStack) => {
  creatureId(c, s.creature)
  c.w.u16(s.count)
}
const army = (c: Ctx, a: CreatureStack[]) => a.forEach((s) => stack(c, s))
const pos = (c: Ctx, p: { x: number; y: number; z: number }) => c.w.u8(p.x).u8(p.y).u8(p.z)
const primary = (c: Ctx, p: PrimarySkills) => c.w.u8(p.attack).u8(p.defense).u8(p.spellPower).u8(p.knowledge)
const opt = <T>(c: Ctx, v: T | null, write: (v: T) => void) => {
  c.w.bool(v !== null)
  if (v !== null) write(v)
}

function heroArtifacts(c: Ctx, a: HeroArtifacts) {
  a.worn.forEach((v) => artifactId(c, v))
  c.w.u16(a.backpack.length)
  a.backpack.forEach((v) => artifactId(c, v))
}

function secondaryU32(c: Ctx, skills: { skill: number; level: number }[]) {
  c.w.u32(skills.length)
  skills.forEach((s) => c.w.u8(s.skill).u8(s.level))
}

function player(c: Ctx, p: PlayerInfo) {
  c.w.bool(p.canHuman).bool(p.canComputer)
  if (!p.playable) {
    c.w.bytes(p.unusedBlock ?? new Uint8Array(c.sod ? 13 : c.ab ? 12 : 6))
    return
  }
  c.w.u8(p.behavior)
  if (c.sod) c.w.u8(p.sodAlignments ?? 0)
  if (c.ab) c.w.u16(p.allowedFactions)
  else c.w.u8(p.allowedFactions)
  c.w.bool(p.randomFaction)
  opt(c, p.mainTown, (t) => {
    if (c.ab) c.w.bool(t.generateHero).u8(t.townType ?? 0)
    pos(c, t.pos)
  })
  c.w.bool(p.randomHero).u8(p.mainHeroType)
  if (p.mainHeroType !== 0xff) {
    c.w.u8(p.mainHeroPortrait ?? 0)
    str(c, p.mainHeroName ?? h3s(''))
  }
  if (c.ab) {
    c.w.u8(p.abUnknown ?? 0).u32(p.heroes.length)
    p.heroes.forEach((h) => {
      c.w.u8(h.type)
      str(c, h.name)
    })
  }
}

function victory(c: Ctx, v: H3mMap['victory']) {
  const codes = { acquireArtifact: 0, accumulateCreatures: 1, accumulateResources: 2, upgradeTown: 3, buildGrail: 4, defeatHero: 5, captureTown: 6, defeatMonster: 7, flagDwellings: 8, flagMines: 9, transportArtifact: 10, defeatAllMonsters: 11, surviveDays: 12 } as const
  if (v.kind === 'none') {
    c.w.u8(0xff)
    return
  }
  c.w.u8(codes[v.kind]).bool(v.allowNormal).bool(v.appliesToAi)
  switch (v.kind) {
    case 'acquireArtifact':
      artifactId(c, v.artifact)
      break
    case 'accumulateCreatures':
      creatureId(c, v.creature)
      c.w.u32(v.amount)
      break
    case 'accumulateResources':
      c.w.u8(v.resource).u32(v.amount)
      break
    case 'upgradeTown':
      pos(c, v.pos)
      c.w.u8(v.hallLevel).u8(v.castleLevel)
      break
    case 'buildGrail':
    case 'defeatHero':
    case 'captureTown':
    case 'defeatMonster':
      pos(c, v.pos)
      break
    case 'flagDwellings':
    case 'flagMines':
      break
    case 'transportArtifact':
      c.w.u8(v.artifact)
      pos(c, v.pos)
      break
  }
}

function loss(c: Ctx, l: H3mMap['loss']) {
  switch (l.kind) {
    case 'none':
      c.w.u8(0xff)
      break
    case 'loseTown':
      c.w.u8(0)
      pos(c, l.pos)
      break
    case 'loseHero':
      c.w.u8(1)
      pos(c, l.pos)
      break
    case 'timeExpires':
      c.w.u8(2).u16(l.days)
      break
  }
}

function heroSettings(c: Ctx, s: HeroSettings) {
  opt(c, s.experience, (v) => c.w.u32(v))
  opt(c, s.secondarySkills, (v) => secondaryU32(c, v))
  opt(c, s.artifacts, (v) => heroArtifacts(c, v))
  opt(c, s.biography, (v) => str(c, v))
  c.w.u8(s.gender)
  opt(c, s.spells, (v) => c.w.bytes(v))
  opt(c, s.primarySkills, (v) => primary(c, v))
}

function guard(c: Ctx, g: Guard | null) {
  opt(c, g, (v) => {
    str(c, v.message)
    opt(c, v.creatures, (a) => army(c, a))
    c.w.zeros(4)
  })
}

function reward(c: Ctx, r: Reward) {
  c.w.u32(r.experience).i32(r.spellPoints).i8(r.morale).i8(r.luck)
  r.resources.forEach((v) => c.w.i32(v))
  primary(c, r.primarySkills)
  c.w.u8(r.secondarySkills.length)
  r.secondarySkills.forEach((s) => c.w.u8(s.skill).u8(s.level))
  c.w.u8(r.artifacts.length)
  r.artifacts.forEach((v) => artifactId(c, v))
  c.w.u8(r.spells.length)
  r.spells.forEach((v) => c.w.u8(v))
  c.w.u8(r.creatures.length)
  r.creatures.forEach((s) => stack(c, s))
  c.w.zeros(8)
}

function quest(c: Ctx, q: Quest) {
  const codes = { experienceLevel: 1, primarySkills: 2, defeatHero: 3, defeatMonster: 4, artifacts: 5, creatures: 6, resources: 7, beHero: 8, bePlayer: 9 } as const
  if (q.kind === 'none') {
    c.w.u8(0)
    return
  }
  if (q.kind === 'hotaCondition') throw new Error('the base-game writer cannot write a HotA quest condition')
  c.w.u8(codes[q.kind])
  switch (q.kind) {
    case 'experienceLevel':
      c.w.u32(q.value)
      break
    case 'primarySkills':
      primary(c, q.skills)
      break
    case 'defeatHero':
    case 'defeatMonster':
      c.w.u32(q.targetId)
      break
    case 'artifacts':
      c.w.u8(q.artifacts.length)
      q.artifacts.forEach((v) => artifactId(c, v))
      break
    case 'creatures':
      c.w.u8(q.creatures.length)
      q.creatures.forEach((s) => stack(c, s))
      break
    case 'resources':
      q.resources.forEach((v) => c.w.u32(v))
      break
    case 'beHero':
      c.w.u8(q.hero)
      break
    case 'bePlayer':
      c.w.u8(q.player)
      break
  }
  c.w.i32(q.deadline)
  str(c, q.proposal)
  str(c, q.progress)
  str(c, q.completion)
}

function seerReward(c: Ctx, r: SeerReward) {
  const codes = { none: 0, experience: 1, spellPoints: 2, morale: 3, luck: 4, resource: 5, primarySkill: 6, secondarySkill: 7, artifact: 8, spell: 9, creature: 10 } as const
  c.w.u8(codes[r.kind])
  switch (r.kind) {
    case 'none':
      break
    case 'experience':
    case 'spellPoints':
      c.w.u32(r.value)
      break
    case 'morale':
    case 'luck':
      c.w.i8(r.value)
      break
    case 'resource':
      c.w.u8(r.resource).u32(r.amount)
      break
    case 'primarySkill':
      c.w.u8(r.skill).u8(r.value)
      break
    case 'secondarySkill':
      c.w.u8(r.skill).u8(r.level)
      break
    case 'artifact':
      artifactId(c, r.artifact)
      break
    case 'spell':
      c.w.u8(r.spell)
      break
    case 'creature':
      creatureId(c, r.creature)
      c.w.u16(r.count)
      break
  }
}

function timedEvent(c: Ctx, e: TimedEvent) {
  str(c, e.name)
  str(c, e.message)
  e.resources.forEach((v) => c.w.i32(v))
  c.w.u8(e.players)
  if (c.sod) c.w.bool(e.humanAffected)
  c.w.bool(e.computerAffected).u16(e.firstDay).u8(e.repeatEvery).zeros(17)
}

function body(c: Ctx, b: ObjectBody, classId: number) {
  const w = c.w
  switch (b.kind) {
    case 'none':
      return
    case 'hero':
      if (c.ab) w.u32(b.identifier ?? 0)
      w.u8(b.owner).u8(b.type)
      opt(c, b.name, (v) => str(c, v))
      if (c.sod) opt(c, b.experience, (v) => w.u32(v))
      else w.u32(b.experience ?? 0)
      opt(c, b.portrait, (v) => w.u8(v))
      opt(c, b.secondarySkills, (v) => secondaryU32(c, v))
      opt(c, b.garrison, (v) => army(c, v))
      w.u8(b.formation)
      opt(c, b.artifacts, (v) => heroArtifacts(c, v))
      w.u8(b.patrolRadius)
      if (c.ab) {
        opt(c, b.biography, (v) => str(c, v))
        w.u8(b.gender ?? 0xff)
      }
      if (c.sod) opt(c, b.spells, (v) => w.bytes(v))
      else if (c.ab) w.u8(b.abSpell ?? 0xfe)
      if (c.sod) opt(c, b.primarySkills, (v) => primary(c, v))
      w.zeros(16)
      return
    case 'monster':
      if (c.ab) w.u32(b.identifier ?? 0)
      w.u16(b.count).u8(b.disposition)
      w.bool(b.message !== null)
      if (b.message !== null) {
        str(c, b.message)
        ;(b.resources ?? [0, 0, 0, 0, 0, 0, 0]).forEach((v) => w.i32(v))
        artifactId(c, b.artifact ?? (c.ab ? 0xffff : 0xff))
      }
      w.bool(b.neverFlees).bool(b.noGrowth).zeros(2)
      return
    case 'message':
      str(c, b.text)
      w.zeros(4)
      return
    case 'seerHut':
      if (c.ab) quest(c, b.quest)
      else w.u8(b.quest.kind === 'artifacts' ? (b.quest.artifacts[0] as number) : 0xff)
      if (b.quest.kind === 'none') {
        w.zeros(3)
        return
      }
      seerReward(c, b.reward)
      w.zeros(2)
      return
    case 'witchHut':
      if (c.ab) w.u32(b.allowedSkills ?? 0)
      return
    case 'scholar':
      w.u8(b.bonusType).u8(b.bonusId).zeros(6)
      return
    case 'garrison':
      w.u32(b.owner)
      army(c, b.creatures)
      if (c.ab) w.bool(b.removableUnits ?? false)
      w.zeros(8)
      return
    case 'artifact':
      guard(c, b.guard)
      return
    case 'spellScroll':
      guard(c, b.guard)
      w.u32(b.spell)
      return
    case 'resource':
      guard(c, b.guard)
      w.u32(b.amount).zeros(4)
      return
    case 'town':
      if (c.ab) w.u32(b.identifier ?? 0)
      w.u8(b.owner)
      opt(c, b.name, (v) => str(c, v))
      opt(c, b.garrison, (v) => army(c, v))
      w.u8(b.formation)
      w.bool(b.buildings.custom)
      if (b.buildings.custom) w.bytes(b.buildings.built).bytes(b.buildings.forbidden)
      else w.bool(b.buildings.hasFort)
      if (c.ab) w.bytes(b.spellsMustHave ?? new Uint8Array(9))
      w.bytes(b.spellsMayHave)
      w.u32(b.events.length)
      b.events.forEach((e) => {
        timedEvent(c, e)
        w.bytes(e.buildings)
        e.creatures.forEach((v) => w.u16(v))
        w.zeros(4)
      })
      if (c.sod) w.u8(b.alignment ?? 0xff)
      w.zeros(3)
      return
    case 'owned':
      w.u32(b.owner)
      return
    case 'shrine':
      w.u32(b.spell)
      return
    case 'pandora':
      guard(c, b.guard)
      reward(c, b.reward)
      return
    case 'event':
      guard(c, b.guard)
      reward(c, b.reward)
      w.u8(b.players).bool(b.computerActivate).bool(b.removeAfterVisit).zeros(4)
      return
    case 'grail':
      w.u32(b.radius ?? 0)
      return
    case 'randomDwelling': {
      const family = bodyFamily(classId)
      w.u32(b.owner)
      if (family === 'randomDwelling' || family === 'randomDwellingLevel') {
        w.u32(b.linkedTown ?? 0)
        if ((b.linkedTown ?? 0) === 0) w.u16(b.factions ?? 0)
      }
      if (family === 'randomDwelling' || family === 'randomDwellingFaction') w.u8(b.minLevel ?? 0).u8(b.maxLevel ?? 0)
      return
    }
    case 'questGuard':
      quest(c, b.quest)
      return
    case 'heroPlaceholder':
      w.u8(b.owner).u8(b.heroType)
      if (b.heroType === 0xff) w.u8(b.powerRank ?? 0)
      return
  }
}

/** Serializes a map to uncompressed H3M bytes. */
export function writeH3m(map: H3mMap): Uint8Array {
  const c: Ctx = { w: new ByteWriter(), ab: map.version !== 'RoE', sod: map.version === 'SoD' }
  const w = c.w
  w.u32(H3M_VERSION_CODES[map.version])
  const i = map.info
  w.bool(i.hasHero).u32(i.size).bool(i.hasUnderground)
  str(c, i.name)
  str(c, i.description)
  w.u8(i.difficulty)
  if (c.ab) w.u8(i.levelCap ?? 0)
  map.players.forEach((p) => player(c, p))
  victory(c, map.victory)
  loss(c, map.loss)
  if (map.teams === null) w.u8(0)
  else w.u8(Math.max(...map.teams) + 1).bytes(map.teams)
  w.bytes(map.allowedHeroes)
  if (c.ab) {
    w.u32(map.placeholderHeroIds.length)
    map.placeholderHeroIds.forEach((v) => w.u8(v))
  }
  if (c.sod) {
    w.u8(map.customHeroes.length)
    map.customHeroes.forEach((h) => {
      w.u8(h.type).u8(h.portrait)
      str(c, h.name)
      w.u8(h.players)
    })
  }
  w.zeros(31)
  if (c.ab) w.bytes(map.allowedArtifacts ?? new Uint8Array(c.sod ? 18 : 17))
  if (c.sod) w.bytes(map.allowedSpells ?? new Uint8Array(9)).bytes(map.allowedSkills ?? new Uint8Array(4))
  w.u32(map.rumors.length)
  map.rumors.forEach((r) => {
    str(c, r.name)
    str(c, r.text)
  })
  if (c.sod) {
    const settings = map.heroSettings ?? Array.from({ length: 156 }, () => null)
    settings.forEach((s) => opt(c, s, (v) => heroSettings(c, v)))
  }
  w.bytes(map.tiles)
  w.u32(map.templates.length)
  map.templates.forEach((t) => {
    w.string(t.defName).bytes(t.passable).bytes(t.active).u16(t.allowedTerrains).u16(t.editorGroups).u32(t.classId).u32(t.subclassId).u8(t.group).bool(t.isOverlay).zeros(16)
  })
  w.u32(map.objects.length)
  map.objects.forEach((o) => {
    w.u8(o.x).u8(o.y).u8(o.z).u32(o.templateIndex).zeros(5)
    body(c, o.body, o.classId)
  })
  w.u32(map.events.length)
  map.events.forEach((e) => timedEvent(c, e))
  w.zeros(map.trailerLength)
  return w.toBytes()
}

export function writeH3mGz(map: H3mMap): Uint8Array {
  return gzip(writeH3m(map))
}

// ---------------------------------------------------------------------------------------------
// Builders

export function h3s(text: string): H3String {
  const bytes = new ByteWriter().string(text).toBytes().subarray(4)
  return { bytes: bytes.slice(), text }
}

const ZERO_SKILLS: PrimarySkills = { attack: 1, defense: 2, spellPower: 3, knowledge: 4 }

function makeArmy(ab: boolean): CreatureStack[] {
  return Array.from({ length: 7 }, (_, i) => (i < 2 ? { creature: 10 + i, count: 5 * (i + 1) } : { creature: ab ? 0xffff : 0xff, count: 0 }))
}

function makeReward(ab: boolean): Reward {
  return {
    experience: 1000,
    spellPoints: -5,
    morale: 1,
    luck: -1,
    resources: [1, 2, 3, 4, 5, 6, 700],
    primarySkills: ZERO_SKILLS,
    secondarySkills: [{ skill: 3, level: 2 }],
    artifacts: [7, ab ? 130 : 12],
    spells: [15],
    creatures: [{ creature: 20, count: 3 }],
  }
}

function makeArtifacts(version: H3mVersion): HeroArtifacts {
  const empty = version === 'RoE' ? 0xff : 0xffff
  return { worn: Array.from({ length: version === 'SoD' ? 19 : 18 }, (_, i) => (i === 0 ? 7 : empty)), backpack: [9, 10] }
}

export function blankTemplate(defName: string, classId: number, subclassId = 0): ObjectTemplate {
  const passable = Uint8Array.of(0xff, 0xff, 0xff, 0xff, 0xff, 0x7f)
  const active = Uint8Array.of(0, 0, 0, 0, 0, 0x80)
  return { defName, passable, active, allowedTerrains: 0x1ff, editorGroups: 1, classId, subclassId, group: 2, isOverlay: false }
}

export function emptyPlayers(version: H3mVersion): PlayerInfo[] {
  return Array.from({ length: 8 }, () => ({
    canHuman: false,
    canComputer: false,
    playable: false,
    behavior: 0,
    sodAlignments: null,
    allowedFactions: 0,
    randomFaction: false,
    mainTown: null,
    randomHero: false,
    mainHeroType: 0xff,
    mainHeroPortrait: null,
    mainHeroName: null,
    abUnknown: null,
    heroes: [],
    unusedBlock: new Uint8Array(version === 'SoD' ? 13 : version === 'AB' ? 12 : 6),
  }))
}

export interface MapOptions {
  version: H3mVersion
  size: number
  underground: boolean
  /** Fills tile records; default: grass with a few variants. */
  tile?: (x: number, y: number, z: number) => [number, number, number, number, number, number, number]
  templates?: ObjectTemplate[]
  objects?: Omit<MapObject, 'index' | 'offset' | 'classId' | 'subclassId'>[]
}

/** A map with the given tiles and objects; header sections hold simple valid values. */
export function buildMap(opts: MapOptions): H3mMap {
  const { version, size, underground } = opts
  const ab = version !== 'RoE'
  const sod = version === 'SoD'
  const levels = underground ? 2 : 1
  const tiles = new Uint8Array(size * size * levels * TILE_RECORD_SIZE)
  for (let z = 0; z < levels; z++)
    for (let y = 0; y < size; y++)
      for (let x = 0; x < size; x++) {
        const rec = opts.tile?.(x, y, z) ?? [2, (x + y) % 20, 0, 0, 0, 0, 0]
        tiles.set(rec, (z * size * size + y * size + x) * TILE_RECORD_SIZE)
      }
  const players = emptyPlayers(version)
  players[0] = {
    ...players[0],
    canHuman: true,
    canComputer: true,
    playable: true,
    behavior: 1,
    sodAlignments: sod ? 0 : null,
    allowedFactions: ab ? 0x1ff : 0xff,
    randomFaction: false,
    mainTown: { generateHero: true, townType: ab ? 0 : null, pos: { x: 1, y: 1, z: 0 } },
    randomHero: true,
    mainHeroType: 5,
    mainHeroPortrait: 5,
    mainHeroName: h3s('Hero'),
    abUnknown: ab ? 0 : null,
    heroes: ab ? [{ type: 5, name: h3s('Hero') }] : [],
    unusedBlock: null,
  } as PlayerInfo
  const templates = opts.templates ?? []
  const objects = (opts.objects ?? []).map((o, index) => {
    const t = templates[o.templateIndex] as ObjectTemplate
    return { ...o, index, offset: 0, classId: t.classId, subclassId: t.subclassId }
  })
  return {
    fileName: 'synthetic.h3m',
    version,
    versionCode: H3M_VERSION_CODES[version],
    subVersion: null,
    hota: null,
    info: { hasHero: true, size, hasUnderground: underground, name: h3s('Synthetic'), description: h3s('Синтетическая карта'), difficulty: 1, levelCap: ab ? 0 : null },
    players,
    victory: { kind: 'none' },
    loss: { kind: 'none' },
    teams: null,
    allowedHeroes: new Uint8Array(ab ? 20 : 16).fill(0xff),
    placeholderHeroIds: ab ? [] : [],
    customHeroes: [],
    allowedArtifacts: ab ? new Uint8Array(sod ? 18 : 17) : null,
    allowedSpells: sod ? new Uint8Array(9) : null,
    allowedSkills: sod ? new Uint8Array(4) : null,
    rumors: [],
    heroSettings: sod ? Array.from({ length: 156 }, () => null) : null,
    tiles,
    templates,
    objects,
    events: [],
    trailerLength: 124,
    byteLength: 0,
  }
}

/** One object per body family (and per random dwelling variant) with non-trivial contents. */
export function allBodiesMap(version: H3mVersion): H3mMap {
  const ab = version !== 'RoE'
  const sod = version === 'SoD'
  const C = OBJECT_CLASS
  const questBody: Quest = ab
    ? { kind: 'creatures', creatures: [{ creature: 3, count: 10 }], deadline: -1, proposal: h3s('p'), progress: h3s('q'), completion: h3s('c') }
    : { kind: 'artifacts', artifacts: [12], deadline: -1, proposal: h3s(''), progress: h3s(''), completion: h3s('') }
  const entries: [number, ObjectBody][] = [
    [C.TREASURE_CHEST, { kind: 'none' }],
    [C.EVENT, { kind: 'event', guard: { message: h3s('Stop'), creatures: makeArmy(ab) }, reward: makeReward(ab), players: 0x81, computerActivate: true, removeAfterVisit: false }],
    [C.HERO, { kind: 'hero', identifier: ab ? 77 : null, owner: 0, type: 3, name: h3s('Named'), experience: 500, portrait: 3, secondarySkills: [{ skill: 1, level: 3 }], garrison: makeArmy(ab), formation: 1, artifacts: makeArtifacts(version), patrolRadius: 0xff, biography: ab ? h3s('Bio') : null, gender: ab ? 1 : null, abSpell: ab && !sod ? 0xfe : null, spells: sod ? new Uint8Array(9).fill(3) : null, primarySkills: sod ? ZERO_SKILLS : null }],
    [C.PRISON, { kind: 'hero', identifier: ab ? 78 : null, owner: 0xff, type: 9, name: null, experience: sod ? null : 0, portrait: null, secondarySkills: null, garrison: null, formation: 0, artifacts: null, patrolRadius: 0xff, biography: null, gender: ab ? 0xff : null, abSpell: ab && !sod ? 0xff : null, spells: null, primarySkills: null }],
    [C.MONSTER, { kind: 'monster', identifier: ab ? 12 : null, count: 25, disposition: 2, message: h3s('Grr'), resources: [0, 0, 0, 0, 0, 0, 100], artifact: 5, neverFlees: true, noGrowth: false }],
    [C.RANDOM_MONSTER_L7, { kind: 'monster', identifier: ab ? 13 : null, count: 0, disposition: 0, message: null, resources: null, artifact: null, neverFlees: false, noGrowth: true }],
    [C.SIGN, { kind: 'message', text: h3s('Welcome') }],
    [C.SEER_HUT, { kind: 'seerHut', quest: questBody, reward: { kind: 'creature', creature: 40, count: 2 } }],
    [C.SEER_HUT, { kind: 'seerHut', quest: { kind: 'none' }, reward: { kind: 'none' } }],
    [C.WITCH_HUT, { kind: 'witchHut', allowedSkills: ab ? 0x0fffffff : null }],
    [C.SCHOLAR, { kind: 'scholar', bonusType: 0xff, bonusId: 0 }],
    [C.GARRISON, { kind: 'garrison', owner: 1, creatures: makeArmy(ab), removableUnits: ab ? true : null }],
    [C.RANDOM_RELIC_ART, { kind: 'artifact', guard: null }],
    [C.SPELL_SCROLL, { kind: 'spellScroll', guard: { message: h3s(''), creatures: null }, spell: 17 }],
    [C.RANDOM_RESOURCE, { kind: 'resource', guard: null, amount: 0 }],
    [C.RANDOM_TOWN, { kind: 'town', identifier: ab ? 99 : null, owner: 0, name: h3s('Town'), garrison: makeArmy(ab), formation: 0, buildings: { custom: true, built: Uint8Array.of(1, 2, 3, 4, 5, 6), forbidden: Uint8Array.of(0, 0, 0, 0, 0, 1) }, spellsMustHave: ab ? new Uint8Array(9) : null, spellsMayHave: new Uint8Array(9).fill(0xff), hotaExtra: null, events: [{ name: h3s('E'), message: h3s('M'), resources: [0, 0, 0, 0, 0, 0, 1], players: 0xff, humanAffected: true, computerAffected: false, firstDay: 3, repeatEvery: 7, buildings: new Uint8Array(6), creatures: [1, 0, 0, 0, 0, 0, 2] }], alignment: sod ? 0xff : null }],
    [C.TOWN, { kind: 'town', identifier: ab ? 100 : null, owner: 0xff, name: null, garrison: null, formation: 0, buildings: { custom: false, hasFort: true }, spellsMustHave: ab ? new Uint8Array(9) : null, spellsMayHave: new Uint8Array(9), hotaExtra: null, events: [], alignment: sod ? 1 : null }],
    [C.MINE, { kind: 'owned', owner: 0xff }],
    [C.SHRINE_OF_MAGIC_GESTURE, { kind: 'shrine', spell: 0xff }],
    [C.PANDORAS_BOX, { kind: 'pandora', guard: null, reward: makeReward(ab) }],
    [C.GRAIL, { kind: 'grail', radius: 3 }],
    [C.RANDOM_DWELLING, { kind: 'randomDwelling', owner: 0xff, linkedTown: 0, factions: 0x1ff, minLevel: 0, maxLevel: 6 }],
    [C.RANDOM_DWELLING, { kind: 'randomDwelling', owner: 0, linkedTown: 99, factions: null, minLevel: 2, maxLevel: 3 }],
    [C.RANDOM_DWELLING_LVL, { kind: 'randomDwelling', owner: 0xff, linkedTown: 0, factions: 0x3, minLevel: null, maxLevel: null }],
    [C.RANDOM_DWELLING_FACTION, { kind: 'randomDwelling', owner: 0xff, linkedTown: null, factions: null, minLevel: 1, maxLevel: 4 }],
    [C.QUEST_GUARD, { kind: 'questGuard', quest: ab ? { kind: 'bePlayer', player: 2, deadline: 30, proposal: h3s('a'), progress: h3s('b'), completion: h3s('c') } : { kind: 'none' } }],
    [C.HERO_PLACEHOLDER, { kind: 'heroPlaceholder', owner: 0, heroType: 0xff, powerRank: 2 }],
  ]
  const usable = entries.filter(([cls]) => ab || (cls !== C.RANDOM_DWELLING && cls !== C.RANDOM_DWELLING_LVL && cls !== C.RANDOM_DWELLING_FACTION && cls !== C.QUEST_GUARD && cls !== C.HERO_PLACEHOLDER))
  const templates = usable.map(([cls], i) => blankTemplate(`syn${i}.def`, cls, i % 3))
  const objects = usable.map(([, b], i) => ({ x: (i % 10) + 2, y: Math.floor(i / 10) + 2, z: 0, templateIndex: i, body: b }))
  const map = buildMap({ version, size: 36, underground: true, templates, objects })
  map.events = [{ name: h3s('Global'), message: h3s('Msg'), resources: [0, 0, 0, 0, 0, 0, 500], players: 0xff, humanAffected: true, computerAffected: sod ? false : false, firstDay: 1, repeatEvery: 0 }]
  map.rumors = [{ name: h3s('R'), text: h3s('Text') }]
  map.victory = { kind: 'defeatMonster', allowNormal: true, appliesToAi: false, pos: { x: 3, y: 4, z: 0 } }
  map.loss = { kind: 'timeExpires', days: 90 }
  map.teams = [0, 1, 0, 1, 0, 1, 0, 1]
  if (ab) map.placeholderHeroIds = [4, 8]
  if (sod) {
    map.customHeroes = [{ type: 2, portrait: 2, name: h3s('Custom'), players: 0xff }]
    const settings: (HeroSettings | null)[] = Array.from({ length: 156 }, () => null)
    settings[3] = { experience: 100, secondarySkills: [{ skill: 2, level: 1 }], artifacts: makeArtifacts('SoD'), biography: h3s('b'), gender: 0, spells: new Uint8Array(9), primarySkills: ZERO_SKILLS }
    map.heroSettings = settings
  }
  return map
}
