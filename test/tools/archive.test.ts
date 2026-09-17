import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeTarGz, writeZip } from '../../tools/shared/archive.ts'
import type { ArchiveEntry } from '../../tools/shared/archive.ts'

const has = (cmd: string): boolean => {
  try {
    execFileSync('sh', ['-c', `command -v ${cmd}`], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

const entries: ArchiveEntry[] = [
  { path: 'userfiles/.keep', data: new Uint8Array(0) },
  { path: 'index.html', data: new TextEncoder().encode('<!doctype html>'.repeat(40)) },
  { path: 'contents/ui/main.qml', data: new TextEncoder().encode('import QtQuick\nItem {}\n') },
  { path: 'contents/', data: new Uint8Array(0) },
  { path: 'Карты/readme.txt', data: new TextEncoder().encode('привет') },
]

describe('deterministic archives', () => {
  it('writes identical bytes for the same entries in any order', () => {
    expect(writeZip(entries)).toEqual(writeZip([...entries].reverse()))
    expect(writeTarGz(entries)).toEqual(writeTarGz([...entries].reverse()))
  })

  it('rejects unsafe paths', () => {
    expect(() => writeZip([{ path: '../x', data: new Uint8Array(1) }])).toThrow()
    expect(() => writeTarGz([{ path: '/abs', data: new Uint8Array(1) }])).toThrow()
  })

  it.skipIf(!has('unzip') || !has('tar'))('round-trips through system unzip and tar', () => {
    const dir = mkdtempSync(join(tmpdir(), 'archive-'))
    try {
      writeFileSync(join(dir, 'a.zip'), writeZip(entries))
      writeFileSync(join(dir, 'a.tar.gz'), writeTarGz(entries))
      execFileSync('unzip', ['-q', join(dir, 'a.zip'), '-d', join(dir, 'z')])
      execFileSync('mkdir', ['-p', join(dir, 't')])
      execFileSync('tar', ['-xzf', join(dir, 'a.tar.gz'), '-C', join(dir, 't')])
      for (const root of ['z', 't']) {
        expect(readFileSync(join(dir, root, 'index.html'), 'utf8')).toBe('<!doctype html>'.repeat(40))
        expect(readFileSync(join(dir, root, 'Карты/readme.txt'), 'utf8')).toBe('привет')
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
