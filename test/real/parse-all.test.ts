// SC-002a: every map in the install's Maps folder parses (RoE/AB/SoD) or is rejected as an
// unsupported version; nothing else. Also checks that the writer reproduces each base-game map
// byte for byte, which proves no field is skipped or guessed.
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { gunzipSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { parseH3m } from '../../src/core/formats/h3m/h3m.ts'
import { FormatError } from '../../src/core/util/errors.ts'
import { installMaps } from '../../tools/shared/game-files.ts'
import { writeH3m } from '../fixtures/synthetic/h3m.ts'

const maps = installMaps()
if (maps.length === 0) process.stderr.write('[real-file test skipped] parse-all: no game install configured (bundleDir)\n')

describe.skipIf(maps.length === 0)('install map corpus (SC-002a)', () => {
  it('parses every base-game map exactly and rejects the rest as unsupported', async () => {
    let parsed = 0
    let unsupported = 0
    const failed: string[] = []
    for (const path of maps) {
      const raw = new Uint8Array(gunzipSync(await readFile(path)))
      try {
        const map = parseH3m(raw, basename(path))
        parsed++
        const out = writeH3m(map)
        if (out.length !== raw.length || out.some((b, i) => b !== raw[i])) failed.push(`${basename(path)}: writer output differs`)
      } catch (err) {
        if (err instanceof FormatError && err.code === 'UNSUPPORTED_VERSION') unsupported++
        else failed.push(`${basename(path)}: ${String(err)}`)
      }
    }
    expect(failed).toEqual([])
    expect(parsed).toBeGreaterThan(0)
    process.stderr.write(`[parse-all] parsed ${parsed}, unsupported ${unsupported}\n`)
  }, 300_000)
})
