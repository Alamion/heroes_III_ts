// Wine in a dedicated prefix under stateDir. Never touches ~/.wine.
import { spawn } from 'node:child_process'
import { closeSync, existsSync, mkdirSync, openSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { log } from '../log.ts'
import type { Env, LongRunning } from './process.ts'
import { runProcess, sleep } from './process.ts'

export interface WineContext {
  wineBinary: string
  prefix: string
  logsDir: string
}

export function wineContext(stateDir: string, wineBinary: string): WineContext {
  return { wineBinary, prefix: join(stateDir, 'prefix'), logsDir: join(stateDir, 'logs') }
}

export function wineEnv(ctx: WineContext, extra: Env = {}): Env {
  const env: Env = {
    ...process.env,
    WINEPREFIX: ctx.prefix,
    // No audio (captures must not play sound on the developer's machine), no desktop menu entries.
    // No debugger either: a crashed program must exit so the tooling can detect it and retry.
    WINEDLLOVERRIDES: 'winemenubuilder.exe=d;winepulse.drv=d;winealsa.drv=d;winedbg.exe=d',
    WINEDEBUG: '-all',
    ...extra,
  }
  delete env.WAYLAND_DISPLAY
  return env
}

function wineserverBinary(ctx: WineContext): string {
  return ctx.wineBinary.endsWith('wine') ? `${ctx.wineBinary}server` : 'wineserver'
}

export async function ensurePrefix(ctx: WineContext, force = false): Promise<void> {
  mkdirSync(ctx.logsDir, { recursive: true })
  if (force && existsSync(ctx.prefix)) {
    await killAll(ctx)
    await runProcess('rm', ['-rf', ctx.prefix])
  }
  if (!existsSync(join(ctx.prefix, 'system.reg'))) {
    log.info('creating dedicated Wine prefix (about a minute)', { prefix: ctx.prefix })
    await runProcess(ctx.wineBinary, ['wineboot', '-u'], {
      env: wineEnv(ctx, { DISPLAY: '' }),
      timeoutMs: 300_000,
    })
    await runProcess(wineserverBinary(ctx), ['-w'], { env: wineEnv(ctx), timeoutMs: 120_000, check: false })
  }
  await regAdd(ctx, 'HKCU\\Software\\Wine\\Drivers', 'Graphics', 'REG_SZ', 'x11')
}

export async function regAdd(ctx: WineContext, key: string, name: string, type: 'REG_SZ' | 'REG_DWORD', data: string): Promise<void> {
  await runProcess(ctx.wineBinary, ['reg', 'add', key, '/v', name, '/t', type, '/d', data, '/f'], {
    env: wineEnv(ctx, { DISPLAY: '' }),
    timeoutMs: 60_000,
  })
}

/** Reads a REG_SZ/REG_DWORD value from the prefix's user.reg without starting Wine. */
export function readUserRegValue(ctx: WineContext, key: string, name: string): string | undefined {
  const path = join(ctx.prefix, 'user.reg')
  if (!existsSync(path)) return undefined
  const text = readFileSync(path, 'utf8')
  const header = `[${key.replace(/^HKCU\\/, '').replace(/\\/g, '\\\\')}]`
  const start = text.indexOf(header)
  if (start < 0) return undefined
  const end = text.indexOf('\n[', start + header.length)
  const section = text.slice(start, end < 0 ? undefined : end)
  const m = new RegExp(`^"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"=(.*)$`, 'm').exec(section)
  if (m?.[1] === undefined) return undefined
  const raw = m[1].trim()
  if (raw.startsWith('dword:')) return String(parseInt(raw.slice(6), 16))
  return raw.replace(/^"|"$/g, '')
}

export interface LaunchedApp {
  proc: LongRunning
  logPath: string
}

export function launch(
  ctx: WineContext,
  exe: string,
  opts: { display: string; cwd: string; loadDllLog: boolean; args?: string[]; virtualDesktop?: string; keepLocale?: boolean },
): LaunchedApp {
  mkdirSync(ctx.logsDir, { recursive: true })
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const logPath = join(ctx.logsDir, `${stamp}-${exe.replace(/\W+/g, '_')}.log`)
  const fd = openSync(logPath, 'w')
  const args = opts.virtualDesktop !== undefined
    ? ['explorer', `/desktop=h3ref,${opts.virtualDesktop}`, exe, ...(opts.args ?? [])]
    : [exe, ...(opts.args ?? [])]
  const env = wineEnv(ctx, {
    DISPLAY: opts.display,
    WINEDEBUG: opts.loadDllLog ? '+loaddll' : '-all',
    // The game gets a neutral locale for predictable key handling; the editor keeps the host
    // locale so its localized menus render (menus are outside the captured map area).
    ...(opts.keepLocale === true ? {} : { LANG: 'en_US.UTF-8', LC_ALL: 'en_US.UTF-8' }),
  })
  const child = spawn(ctx.wineBinary, args, { env, cwd: opts.cwd, detached: true, stdio: ['ignore', fd, fd] })
  closeSync(fd)
  const exited = new Promise<number>((res) => {
    child.on('exit', (code) => res(code ?? -1))
    child.on('error', () => res(-1))
  })
  const proc: LongRunning = {
    child,
    exited,
    kill: () => {
      try {
        if (child.pid !== undefined) process.kill(-child.pid, 'SIGTERM')
      } catch {
        child.kill('SIGTERM')
      }
    },
  }
  log.debug('launched', { exe, logPath })
  return { proc, logPath }
}

export async function killAll(ctx: WineContext): Promise<void> {
  await runProcess(wineserverBinary(ctx), ['-k'], { env: wineEnv(ctx), timeoutMs: 30_000, check: false })
  await sleep(500)
}

export async function wineVersion(ctx: WineContext): Promise<string> {
  const r = await runProcess(ctx.wineBinary, ['--version'], { timeoutMs: 10_000 })
  return r.stdout.toString().trim()
}
