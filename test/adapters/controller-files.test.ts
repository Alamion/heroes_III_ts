// Spec 008: a HotA map without the HotA archive says so, per-slot picking and removing, the HotA
// archive remembered like the others.
import { describe, expect, it } from 'vitest'
import { filesCatalogue } from '../../src/runtime/catalogue.ts'
import { mapFolderEntries } from '../fixtures/synthetic/map-folder.ts'
import { setup } from './controller-fixtures.ts'

const file = (name: string): File => new File([name], name)
const codes = (c: ReturnType<typeof setup>['c']) => c.state().messages.map((m) => m.code)

describe('HotA map without the HotA archive (FR-001)', () => {
  it('shows the map and a sticky HOTA_ARCHIVE_NEEDED until the archive arrives', async () => {
    const { c, overlay } = setup()
    await c.start()
    await c.supplyFiles([file('H3sprite.lod'), file('H3bitmap.lod'), file('hotamap.h3m')])
    await c.idle()
    expect(c.state().phase).toBe('showing')
    expect(c.state().hotaNeeded).toBe(true)
    expect(c.state().messages).toEqual([{ code: 'HOTA_ARCHIVE_NEEDED', level: 'warn', file: 'hotamap.h3m' }])
    // Wallpaper hosts have no panel: the corner message stays while the map is wrong.
    expect(overlay.at(-1)?.messages).toEqual([expect.objectContaining({ sticky: true, message: expect.objectContaining({ code: 'HOTA_ARCHIVE_NEEDED' }) })])

    await c.supplyFiles([file('HotA.lod')])
    await c.idle()
    expect(c.state().hotaNeeded).toBe(false)
    expect(codes(c)).toEqual([])
  })

  it('says nothing for a base-game map, nor while the HotA archive is on its way', async () => {
    const { c, engine } = setup()
    engine.slotDelays = { hota: 20 }
    await c.start()
    await c.supplyFiles([file('H3sprite.lod'), file('a.h3m')])
    await c.idle()
    expect(c.state().hotaNeeded).toBe(false)
    const seen: boolean[] = []
    c.onChange((s) => seen.push(s.hotaNeeded))
    await c.supplyFiles([file('hotamap.h3m'), file('HotA.lod')])
    await c.idle()
    expect(seen).not.toContain(true)
    expect(codes(c)).toEqual([])
  })

  it('comes back when the HotA archive is removed and goes with the HotA map', async () => {
    const { c } = setup()
    await c.start()
    await c.supplyFiles([file('H3sprite.lod'), file('hotamap.h3m'), file('HotA.lod')])
    await c.idle()
    expect(c.state().hotaNeeded).toBe(false)
    await c.removeFile('hotaArchive')
    expect(c.state().hotaNeeded).toBe(true)
    expect(codes(c)).toContain('HOTA_ARCHIVE_NEEDED')
    await c.supplyFiles([file('a.h3m')])
    await c.idle()
    expect(c.state().hotaNeeded).toBe(false)
    expect(codes(c)).not.toContain('HOTA_ARCHIVE_NEEDED')
  })

  it('names the HotA maps a folder skips for want of the archive', async () => {
    const entries = filesCatalogue(
      mapFolderEntries([
        { path: 'base.h3m', size: 36 },
        { path: 'h1.h3m', version: 'HotA', size: 36 },
        { path: 'h2.h3m', version: 'HotA', size: 72 },
      ]).map((e) => ({ path: e.path, file: new Blob([e.data as Uint8Array<ArrayBuffer>]) })),
    )
    const { c } = setup()
    await c.start()
    c.applySettings({ spritearchive: 'H3sprite.lod' })
    await c.idle()
    await c.supplyFolder('maps', async () => entries)
    // Every pick reads summaries; after a few "next" all three are known.
    for (let i = 0; i < 6; i++) {
      c.nextMap()
      await c.idle()
    }
    expect(c.state().folder).toMatchObject({ hotaSkipped: 2, shown: expect.objectContaining({ path: 'base.h3m' }) })
    expect(c.state().hotaNeeded).toBe(false)
  })
})

describe('per-slot files (FR-004, FR-005)', () => {
  it('a file picked for the wrong slot is reported and still used where it belongs', async () => {
    const { c } = setup()
    await c.start()
    await c.supplyFiles([file('H3bitmap.lod')], 'spriteArchive')
    await c.idle()
    expect(c.state().slots.dataArchive.status).toBe('loaded')
    expect(c.state().slots.spriteArchive.status).toBe('missing')
    expect(c.state().messages).toEqual([expect.objectContaining({ code: 'WRONG_KIND', level: 'warn', expected: 'spriteArchive', found: 'dataArchive' })])
    await c.supplyFiles([file('H3sprite.lod')], 'spriteArchive')
    await c.idle()
    expect(codes(c)).toEqual([])
  })

  it('removing a slot empties it, unloads it from the engine and forgets the remembered copy', async () => {
    const { c, engine, remembered } = setup()
    await c.start()
    await c.supplyFiles([file('H3sprite.lod'), file('H3bitmap.lod'), file('HotA.lod'), file('a.h3m')])
    await c.idle()
    expect(remembered.map((f) => f.slot).sort()).toEqual(['dataArchive', 'hotaArchive', 'map', 'spriteArchive'])

    await c.removeFile('hotaArchive')
    await c.removeFile('dataArchive')
    expect(engine.calls).toContain('unload:hota')
    expect(engine.calls).toContain('unload:data')
    expect(c.state().slots.hotaArchive).toEqual({ status: 'missing', name: null, identity: null })
    expect(c.state().phase).toBe('showing')

    await c.removeFile('map')
    expect(c.state().phase).toBe('waiting')
    expect(engine.paused).toBe(true)
    expect(remembered.map((f) => f.slot)).toEqual(['spriteArchive'])
  })

  it('a stale load of a removed slot does not bring it back', async () => {
    const { c, engine } = setup()
    engine.slotDelays = { map: 20 }
    await c.start()
    const loading = c.supplyFiles([file('a.h3m')])
    await new Promise((r) => setTimeout(r, 5))
    await c.removeFile('map')
    await loading
    await c.idle()
    expect(c.state().slots.map.status).toBe('missing')
  })

  it('removing the folder leaves the folder source waiting for another one', async () => {
    const entries = filesCatalogue(mapFolderEntries([{ path: 'one.h3m', size: 36 }]).map((e) => ({ path: e.path, file: new Blob([e.data as Uint8Array<ArrayBuffer>]) })))
    const { c } = setup()
    await c.start()
    await c.supplyFiles([file('H3sprite.lod')])
    await c.supplyFolder('maps', async () => entries)
    await c.idle()
    expect(c.state().phase).toBe('showing')
    c.removeFolder()
    expect(c.state().folder).toBeNull()
    expect(c.state().source).toBe('folder')
    expect(c.state().phase).toBe('waiting')
  })
})
