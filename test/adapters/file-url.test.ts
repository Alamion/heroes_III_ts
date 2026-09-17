import { describe, expect, it } from 'vitest'
import { displayName, kdeFileUrl, livelyFileUrl, readUserFile, UserFileError, weFileUrl } from '../../src/adapters/shared/file-url.ts'
import type { ReadDeps, XhrLike } from '../../src/adapters/shared/file-url.ts'

describe('host file values to URLs (spec 004 R4)', () => {
  it('maps Wallpaper Engine Windows paths with spaces, Cyrillic, # and %', () => {
    expect(weFileUrl('C:\\Games\\Heroes 3\\Карты\\x.h3m')).toBe('file:///C:/Games/Heroes%203/%D0%9A%D0%B0%D1%80%D1%82%D1%8B/x.h3m')
    expect(weFileUrl('D:\\a#b\\50%.lod')).toBe('file:///D:/a%23b/50%25.lod')
    expect(weFileUrl('\\\\nas\\share\\H3sprite.lod')).toBe('file://nas/share/H3sprite.lod')
    expect(weFileUrl('file:///C:/x.lod')).toBe('file:///C:/x.lod')
    expect(weFileUrl('')).toBeNull()
    expect(weFileUrl(null)).toBeNull()
    expect(weFileUrl('/home/u/Maps/a b.h3m')).toBe('file:///home/u/Maps/a%20b.h3m')
  })

  it('maps Lively folderDropdown values to relative URLs', () => {
    expect(livelyFileUrl('userfiles\\H3sprite.lod')).toBe('userfiles/H3sprite.lod')
    expect(livelyFileUrl('userfiles\\По праву силы.h3m')).toBe('userfiles/%D0%9F%D0%BE%20%D0%BF%D1%80%D0%B0%D0%B2%D1%83%20%D1%81%D0%B8%D0%BB%D1%8B.h3m')
    expect(livelyFileUrl(null)).toBeNull()
  })

  it('keeps KDE file URLs', () => {
    expect(kdeFileUrl('file:///home/u/a%20b.lod')).toBe('file:///home/u/a%20b.lod')
    expect(kdeFileUrl('/home/u/a b.lod')).toBe('file:///home/u/a%20b.lod')
    expect(kdeFileUrl('')).toBeNull()
  })

  it('shows decoded names', () => {
    expect(displayName('file:///C:/Games/%D0%9A%D0%B0%D1%80%D1%82%D1%8B/x%20y.h3m')).toBe('x y.h3m')
    expect(displayName('userfiles\\H3sprite.lod')).toBe('H3sprite.lod')
  })
})

class FakeXhr implements XhrLike {
  responseType = ''
  status = 0
  response: unknown = null
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  url = ''
  private readonly outcome: (x: FakeXhr) => void
  constructor(outcome: (x: FakeXhr) => void) {
    this.outcome = outcome
  }
  open(_method: string, url: string): void {
    this.url = url
  }
  send(): void {
    queueMicrotask(() => this.outcome(this))
  }
}

const deps = (outcome: (x: FakeXhr) => void, fetchImpl?: ReadDeps['fetch']): ReadDeps => ({
  createXhr: () => new FakeXhr(outcome),
  fetch: fetchImpl ?? (() => Promise.reject(new Error('no fetch'))),
})

describe('readUserFile', () => {
  it('reads file: URLs with XHR (status 0 counts as success)', async () => {
    const blob = await readUserFile('file:///C:/a.lod', deps((x) => ((x.status = 0), (x.response = new Uint8Array([1, 2, 3]).buffer), x.onload?.())))
    expect(blob.size).toBe(3)
  })

  it('reports missing and unreadable local files', async () => {
    await expect(readUserFile('file:///C:/a.lod', deps((x) => x.onerror?.()))).rejects.toMatchObject({ reason: 'missing' })
    await expect(readUserFile('file:///C:/a.lod', deps((x) => ((x.response = new ArrayBuffer(0)), x.onload?.())))).rejects.toMatchObject({ reason: 'missing' })
    await expect(readUserFile('file:///C:/a.lod', deps((x) => ((x.status = 500), (x.response = new ArrayBuffer(4)), x.onload?.())))).rejects.toBeInstanceOf(UserFileError)
  })

  it('uses fetch for other URLs', async () => {
    const ok = await readUserFile('userfiles/a.lod', deps(() => {}, async () => ({ ok: true, status: 200, blob: async () => new Blob([new Uint8Array(5)]) })))
    expect(ok.size).toBe(5)
    await expect(readUserFile('userfiles/a.lod', deps(() => {}, async () => ({ ok: false, status: 404, blob: async () => new Blob([]) })))).rejects.toMatchObject({ reason: 'missing' })
  })
})
