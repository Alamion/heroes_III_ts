// Live checks against the real game (FR-021). They need the local reference environment, take
// minutes, and only run with H3REF_LIVE=1; otherwise they skip with an explicit message.
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { CaptureMatch } from '../../tools/reference-env/model/types.ts'
import { validateRecord } from '../../tools/reference-env/model/validate-record.ts'

const REPO = resolve(__dirname, '../..')
const CLI = join(REPO, 'tools/reference-env/cli.ts')

interface CliResult {
  code: number
  json: Record<string, unknown>
  ms: number
}

function ref(args: string[], env: Record<string, string> = {}): Promise<CliResult> {
  const started = Date.now()
  return new Promise((res, rej) => {
    const child = spawn(process.execPath, [CLI, ...args], { cwd: REPO, env: { ...process.env, ...env }, stdio: ['ignore', 'pipe', 'inherit'] })
    let out = ''
    child.stdout.on('data', (d: Buffer) => {
      out += d.toString()
    })
    child.on('error', rej)
    child.on('close', (code) => {
      try {
        res({ code: code ?? -1, json: JSON.parse(out) as Record<string, unknown>, ms: Date.now() - started })
      } catch (err) {
        rej(new Error(`non-JSON output from ref ${args.join(' ')}: ${out.slice(0, 500)} (${(err as Error).message})`))
      }
    })
  })
}

async function environmentReady(): Promise<string | undefined> {
  if (process.env.H3REF_LIVE !== '1') return 'set H3REF_LIVE=1 to run live reference-environment checks'
  const doctor = await ref(['doctor'])
  if (doctor.code !== 0) return `reference environment not ready (yarn ref doctor exited ${doctor.code})`
  return undefined
}

const skipReason = await environmentReady()
if (skipReason !== undefined) console.warn(`[reference-env live tests skipped] ${skipReason}`)
const live = describe.skipIf(skipReason !== undefined)

const MIN = 60_000

function capture(r: CliResult): CaptureMatch {
  expect(r.json.ok, JSON.stringify(r.json.error)).toBe(true)
  const c = r.json.capture as CaptureMatch
  validateRecord(JSON.parse(readFileSync(join(c.dir, 'record.json'), 'utf8')))
  return c
}

live('live: still (Story 1)', () => {
  it('captures Arrogance (10, 12) unattended in under 2 minutes', async () => {
    const r = await ref(['still', '--map', 'Arrogance.h3m', '--level', '0', '--x', '10', '--y', '12'])
    const c = capture(r)
    expect(r.ms).toBeLessThan(2 * MIN)
    const v = c.record.visible
    expect(10 >= v.x0 && 10 <= v.x1 && 12 >= v.y0 && 12 <= v.y1).toBe(true)
    expect(c.record.startSetup?.mode).toBe('fixed')
    expect(existsSync(join(c.dir, 'volatile-mask.png'))).toBe(true)
  }, 4 * MIN)

  it('handles a non-ASCII map name and the underground corner', async () => {
    // No base-game dev map has a non-ASCII name, so use a temporary renamed copy of Arrogance.
    const dir = mkdtempSync(join(tmpdir(), 'h3ref-live-'))
    const cyrillic = join(dir, 'Высокомерие копия.h3m')
    copyFileSync(join(REPO, 'public/dev-assets/Arrogance.h3m'), cyrillic)
    try {
      const ru = capture(await ref(['still', '--map', cyrillic, '--level', '0', '--x', '5', '--y', '5']))
      expect(ru.record.map.name).toBe('Высокомерие копия.h3m')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
    const corner = capture(await ref(['still', '--map', 'Arrogance.h3m', '--level', '1', '--x', '0', '--y', '0']))
    expect(corner.record.visible).toMatchObject({ x0: 0, y0: 0 })
  }, 6 * MIN)
})

live('live: unsupported map', () => {
  it('rejects the HotA-format map with a clear error before launching anything', async () => {
    // По праву силы.h3m is a HotA map (format 0x20), which the base game cannot open.
    const r = await ref(['still', '--map', 'По праву силы.h3m', '--level', '0', '--x', '1', '--y', '1'])
    expect(r.code).toBe(1)
    expect((r.json.error as { code: string }).code).toBe('MAP_UNSUPPORTED')
    expect(r.ms).toBeLessThan(MIN)
  }, 2 * MIN)
})

live('live: clip (Story 2)', () => {
  it('records a 5 s water clip that resolves every animation step', async () => {
    // Tile (18, 18) of Arrogance is the centre of its lake (chosen from a still).
    const c = capture(await ref(['clip', '--map', 'Arrogance.h3m', '--level', '0', '--x', '18', '--y', '18', '--duration', '5000']))
    expect(c.record.clip?.resolvesAllSteps).toBe(true)
    expect(c.record.clip?.distinctFrames).toBeGreaterThan(1)
    const t = JSON.parse(readFileSync(join(c.dir, 'frames.json'), 'utf8')) as { frames: { tStartMs: number; tEndMs: number }[] }
    t.frames.slice(1).forEach((f, i) => expect(f.tStartMs).toBe(t.frames[i]?.tEndMs))
  }, 4 * MIN)
})

live('live: editor (Story 3)', () => {
  it('captures the editor view with source=editor and a launch-based volatile mask', async () => {
    const c = capture(await ref(['editor', '--map', 'Arrogance.h3m', '--level', '0', '--x', '10', '--y', '12']))
    expect(c.record.source).toBe('editor')
    expect(c.record.executable.label).toBe('h3maped.exe (original)')
  }, 4 * MIN)
})

live('live: lock', () => {
  it('a second capture fails with LOCKED while one is running', async () => {
    const first = ref(['still', '--map', 'Arrogance.h3m', '--level', '0', '--x', '20', '--y', '20'])
    await new Promise((r) => setTimeout(r, 5000))
    const cfgTimeouts = { H3REF_LOCK_WAIT_MS: '2000' }
    const second = await ref(['still', '--map', 'Arrogance.h3m', '--level', '0', '--x', '21', '--y', '21'], cfgTimeouts)
    expect(second.code).toBe(1)
    expect((second.json.error as { code: string }).code).toBe('LOCKED')
    capture(await first)
  }, 5 * MIN)
})

live('live: selfcheck (SC-002, SC-003)', () => {
  it('stills are reproducible and positions agree with the editor', async () => {
    const runs = process.env.H3REF_SELFCHECK_RUNS ?? '5'
    const samples = process.env.H3REF_SELFCHECK_SAMPLES ?? '10'
    // Sprite footprint (2×2 tiles) of Arrogance's random monster near the lake (re-rolled every launch).
    // Temporary hand-made list until the H3M object parser can provide random-object tiles.
    const floating = process.env.H3REF_FLOATING_TILES ?? '20,24;21,24;20,25;21,25'
    const r = await ref(['selfcheck', '--map', 'Arrogance.h3m', '--runs', runs, '--samples', samples, '--floating-tiles', floating])
    expect(r.json.ok, JSON.stringify(r.json, null, 2).slice(0, 3000)).toBe(true)
  }, 90 * MIN)
})
