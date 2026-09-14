import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'
import { afterEach, describe, expect, it } from 'vitest'
import { readH3mHeader } from '../../tools/reference-env/analysis/h3m-header.ts'
import { forbiddenDlls, parseLoadedDlls } from '../../tools/reference-env/analysis/loaddll.ts'
import { regionHash, waitUntilStable } from '../../tools/reference-env/analysis/stability.ts'
import { exitCodeFor, parseArgs } from '../../tools/reference-env/cli.ts'
import { loadConfig } from '../../tools/reference-env/config.ts'
import { acquireLock } from '../../tools/reference-env/env/lock.ts'
import { ERROR_CODES, RefError } from '../../tools/reference-env/errors.ts'
import { validateRecord } from '../../tools/reference-env/model/validate-record.ts'
import { mapKey } from '../../tools/reference-env/store/identity.ts'
import { makeRecord } from './fixtures.ts'

const temps: string[] = []
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'h3ref-test-'))
  temps.push(d)
  return d
}
afterEach(() => {
  for (const d of temps.splice(0)) rmSync(d, { recursive: true, force: true })
})

function expectCode(fn: () => unknown, code: string): void {
  try {
    fn()
  } catch (err) {
    expect(err).toBeInstanceOf(RefError)
    expect((err as RefError).code).toBe(code)
    return
  }
  throw new Error('expected an error')
}

describe('validateRecord', () => {
  it('accepts a valid record', () => {
    expect(validateRecord(makeRecord()).id).toBeTruthy()
  })
  it('rejects bad enums and hashes', () => {
    expectCode(() => validateRecord({ ...makeRecord(), source: 'camera' }), ERROR_CODES.CONFIG_INVALID)
    expectCode(() => validateRecord(makeRecord({ map: { ...makeRecord().map, sha256: 'xyz' } })), ERROR_CODES.CONFIG_INVALID)
    expectCode(
      () => validateRecord({ ...makeRecord(), executable: { file: 'h3hota.exe', sha256: 'b'.repeat(64), label: 'HotA' } }),
      ERROR_CODES.CONFIG_INVALID,
    )
  })
  it('requires visible to contain requested unless clamped', () => {
    const r = makeRecord({ requested: { x: 30, y: 30 } })
    expectCode(() => validateRecord(r), ERROR_CODES.CONFIG_INVALID)
    expect(() => validateRecord({ ...r, clamped: true })).not.toThrow()
  })
  it('requires startSetup for game captures', () => {
    const { startSetup: _omit, ...rest } = makeRecord()
    expectCode(() => validateRecord(rest), ERROR_CODES.CONFIG_INVALID)
  })
  it('rejects level 1 without underground', () => {
    const r = makeRecord({ level: 1, map: { ...makeRecord().map, hasUnderground: false } })
    expectCode(() => validateRecord(r), ERROR_CODES.CONFIG_INVALID)
  })
})

describe('loadConfig', () => {
  it('uses env over file over defaults', () => {
    const repo = temp()
    writeFileSync(join(repo, 'reference-env.config.json'), JSON.stringify({ bundleDir: '/from/file', wineBinary: 'wine-file' }))
    const cfg = loadConfig({ HOME: '/home/u', H3REF_BUNDLE_DIR: '/from/env' }, repo)
    expect(cfg.bundleDir).toBe('/from/env')
    expect(cfg.wineBinary).toBe('wine-file')
    expect(cfg.stateDir).toBe('/home/u/.local/state/h3-reference')
    expect(cfg.capturesDir).toBe(join(repo, 'reference-captures'))
    expect(cfg.mapSearchDirs).toEqual([join(repo, 'public', 'dev-assets'), '/from/env/Maps'])
    expect(cfg.timeouts.still).toBe(120_000)
  })
  it('fails without bundleDir', () => {
    expectCode(() => loadConfig({ HOME: '/home/u' }, temp()), ERROR_CODES.CONFIG_INVALID)
  })
  it('rejects a stateDir inside the repo', () => {
    const repo = temp()
    expectCode(() => loadConfig({ H3REF_BUNDLE_DIR: '/b', H3REF_STATE_DIR: join(repo, 'state') }, repo), ERROR_CODES.CONFIG_INVALID)
  })
})

function header(version: number, size: number, twoLevel: number): Uint8Array {
  const b = new Uint8Array(10)
  const v = new DataView(b.buffer)
  v.setUint32(0, version, true)
  v.setUint8(4, 1)
  v.setUint32(5, size, true)
  v.setUint8(9, twoLevel)
  return b
}

describe('readH3mHeader', () => {
  it('reads gzipped SoD two-level map', () => {
    expect(readH3mHeader(gzipSync(header(0x1c, 36, 1)), 't.h3m')).toEqual({ formatVersion: 'SoD', sizeTiles: 36, hasUnderground: true })
  })
  it('reads raw RoE single level', () => {
    expect(readH3mHeader(header(0x0e, 72, 0), 't.h3m')).toEqual({ formatVersion: 'RoE', sizeTiles: 72, hasUnderground: false })
  })
  it('rejects HotA versions', () => {
    expectCode(() => readH3mHeader(header(0x20, 36, 0), 'hota.h3m'), ERROR_CODES.MAP_UNSUPPORTED)
  })
  it('reports truncation with offset', () => {
    try {
      readH3mHeader(header(0x1c, 36, 1).slice(0, 7), 'short.h3m')
      throw new Error('expected error')
    } catch (err) {
      expect((err as RefError).details).toMatchObject({ offset: 5, structure: 'size' })
    }
  })
})

describe('mapKey', () => {
  it('keeps unicode, normalises, replaces slashes', () => {
    const h = '0123456789abcdef'.repeat(4)
    expect(mapKey('Arrogance.h3m', h)).toBe('Arrogance-01234567')
    expect(mapKey('По праву силы.h3m', h)).toBe('По праву силы-01234567')
    expect(mapKey('Й.h3m'.normalize('NFD'), h)).toBe('Й-01234567')
    expect(mapKey('a\\b.h3m', h)).toBe('a_b-01234567')
  })
})

describe('lock', () => {
  it('acquires, blocks a second holder, releases', async () => {
    const dir = temp()
    const lock = await acquireLock(dir, 0, 'test')
    // Same PID is alive, so a second acquire must time out.
    await expect(acquireLock(dir, 50, 'second', 10)).rejects.toMatchObject({ code: ERROR_CODES.LOCKED })
    lock.release()
    const again = await acquireLock(dir, 0, 'third')
    again.release()
  })
  it('takes over a stale lock', async () => {
    const dir = temp()
    writeFileSync(join(dir, 'capture.lock'), JSON.stringify({ pid: 2 ** 22 + 12345, startedAt: '', command: 'dead' }))
    const lock = await acquireLock(dir, 0, 'test')
    lock.release()
  })
})

describe('loaddll', () => {
  const logText = [
    '0120:trace:loaddll:build_module Loaded L"Z:\\\\game\\\\ZDRAW.dll" at 10000000: native',
    '0120:trace:loaddll:build_module Loaded L"C:\\\\windows\\\\system32\\\\ddraw.dll" at 20000000: builtin',
    '0120:trace:loaddll:build_module Loaded L"Z:\\\\game\\\\_HD3_.dll" at 30000000: native',
    '0120:trace:loaddll:build_module Loaded L"Z:\\\\game\\\\HotA.dll" at 40000000: native',
  ].join('\n')
  it('parses base names and flags forbidden modules', () => {
    const names = parseLoadedDlls(logText)
    expect(names).toEqual(['_hd3_.dll', 'ddraw.dll', 'hota.dll', 'zdraw.dll'])
    expect(forbiddenDlls(names, { allowHdMod: false })).toEqual(['_hd3_.dll', 'hota.dll'])
    expect(forbiddenDlls(names, { allowHdMod: true })).toEqual(['hota.dll'])
  })
})

describe('stability', () => {
  it('returns once frames repeat', async () => {
    const seq = [1, 2, 3, 3, 3]
    let i = 0
    const grab = async () => ({ width: 1, rgb: Buffer.from([seq[Math.min(i++, seq.length - 1)] as number, 0, 0]) })
    const frame = await waitUntilStable(grab, { intervalMs: 1, timeoutMs: 1000, step: 't' })
    expect(frame.rgb[0]).toBe(3)
  })
  it('times out naming the step', async () => {
    let i = 0
    const grab = async () => ({ width: 1, rgb: Buffer.from([i++ % 256, 0, 0]) })
    await expect(waitUntilStable(grab, { intervalMs: 1, timeoutMs: 20, step: 'menu' })).rejects.toMatchObject({
      code: ERROR_CODES.NAVIGATION_TIMEOUT,
      step: 'menu',
    })
  })
  it('hashes regions independently of other pixels', () => {
    const a = Buffer.alloc(4 * 4 * 3)
    const b = Buffer.from(a)
    b[0] = 255
    const rect = { x: 2, y: 2, w: 2, h: 2 }
    expect(regionHash(a, 4, rect)).toBe(regionHash(b, 4, rect))
  })
})

describe('cli', () => {
  it('parses flags and repeated values', () => {
    const p = parseArgs(['still', '--map', 'A.h3m', '--x=3', '--overlay', 'grid', '--overlay', 'pass', '--dry-run'])
    expect(p.command).toBe('still')
    expect(p.flags.get('x')).toEqual(['3'])
    expect(p.flags.get('overlay')).toEqual(['grid', 'pass'])
    expect(p.flags.get('dry-run')).toEqual(['true'])
  })
  it('maps errors to exit codes', () => {
    expect(() => parseArgs(['still', '--map'])).toThrow(RefError)
    expect(exitCodeFor(new RefError(ERROR_CODES.USAGE, ''))).toBe(2)
    expect(exitCodeFor(new RefError(ERROR_CODES.PREREQ_MISSING, ''))).toBe(3)
    expect(exitCodeFor(new RefError(ERROR_CODES.LOCKED, ''))).toBe(1)
  })
})
