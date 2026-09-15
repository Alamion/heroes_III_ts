// Shared CLI plumbing for `yarn h3` and `yarn verify`: same conventions as `yarn ref` — one JSON
// document on stdout, logs on stderr, exit codes 0 ok, 1 failure, 2 usage, 3 missing
// prerequisite, 4 skip (verify only).

import { FormatError } from '../../src/core/util/errors.ts'
import { isLogLevel, log, setLogLevel, setLogSink } from '../../src/core/util/log.ts'
import { TOOL_ERROR_CODES, ToolError, usage } from './errors.ts'

export interface ParsedArgs {
  positional: string[]
  flags: Map<string, string[]>
}

export interface CommandResult {
  ok: boolean
  exitCode?: number
  [key: string]: unknown
}

export type Command = (args: ParsedArgs) => Promise<CommandResult>

export interface CommandSpec {
  load: () => Promise<Command>
  booleanFlags?: readonly string[]
  help: string
}

export function parseArgs(argv: string[], booleanFlags: ReadonlySet<string>): ParsedArgs {
  const flags = new Map<string, string[]>()
  const positional: string[] = []
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2)
      let value: string
      if (eq > 0) value = arg.slice(eq + 1)
      else if (booleanFlags.has(name)) value = 'true'
      else {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) throw usage(`option --${name} needs a value`)
        value = next
        i++
      }
      flags.set(name, [...(flags.get(name) ?? []), value])
    } else {
      positional.push(arg)
    }
  }
  return { positional, flags }
}

export function opt(args: ParsedArgs, name: string): string | undefined {
  const v = args.flags.get(name)
  return v === undefined ? undefined : v[v.length - 1]
}

export function required(args: ParsedArgs, name: string): string {
  const v = opt(args, name)
  if (v === undefined) throw usage(`missing --${name}`)
  return v
}

export function intOpt(args: ParsedArgs, name: string, fallback?: number): number {
  const v = opt(args, name)
  if (v === undefined) {
    if (fallback === undefined) throw usage(`missing --${name}`)
    return fallback
  }
  const n = Number(v)
  if (!Number.isInteger(n)) throw usage(`--${name} must be an integer (got "${v}")`)
  return n
}

export function flag(args: ParsedArgs, name: string): boolean {
  return opt(args, name) === 'true'
}

export function positional(args: ParsedArgs, index: number, what: string): string {
  const v = args.positional[index]
  if (v === undefined) throw usage(`missing ${what}`)
  return v
}

export interface Region {
  x0: number
  y0: number
  x1: number
  y1: number
}

export function parseRegion(value: string): Region {
  const parts = value.split(',').map((p) => Number(p.trim()))
  if (parts.length !== 4 || parts.some((p) => !Number.isInteger(p) || p < 0)) {
    throw usage(`region must be x0,y0,x1,y1 (got "${value}")`)
  }
  const [x0, y0, x1, y1] = parts as [number, number, number, number]
  if (x1 < x0 || y1 < y0) throw usage(`region corners out of order: ${value}`)
  return { x0, y0, x1, y1 }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof ToolError) {
    if (err.code === TOOL_ERROR_CODES.USAGE) return 2
    if (err.code === TOOL_ERROR_CODES.PREREQ_MISSING) return 3
  }
  return 1
}

export function installStderrLogger(): void {
  setLogSink((level, message, data) => {
    const suffix = data === undefined ? '' : ` ${JSON.stringify(data)}`
    process.stderr.write(`[${level}] ${message}${suffix}\n`)
  })
  setLogLevel('info')
}

/** Runs a CLI: `<tool> <command…> [options]`. Command names may have two words (`map info`). */
export async function runCli(tool: string, commands: Record<string, CommandSpec>, argv: string[]): Promise<number> {
  installStderrLogger()
  let result: CommandResult
  let code = 0
  try {
    const two = argv.length >= 2 ? `${argv[0]} ${argv[1]}` : undefined
    const name = two !== undefined && two in commands ? two : argv[0]
    if (name === undefined || !(name in commands)) {
      const list = Object.entries(commands)
        .map(([n, s]) => `  ${n} — ${s.help}`)
        .join('\n')
      throw usage(`usage: yarn ${tool} <command> [options]${name !== undefined ? ` (unknown command "${name}")` : ''}\n${list}`)
    }
    const spec = commands[name] as CommandSpec
    const rest = argv.slice(name.split(' ').length)
    const args = parseArgs(rest, new Set(['help', ...(spec.booleanFlags ?? [])]))
    const level = opt(args, 'log-level')
    if (level !== undefined) {
      if (!isLogLevel(level)) throw usage(`unknown log level "${level}"`)
      setLogLevel(level)
    }
    result = await (await spec.load())(args)
    code = result.exitCode ?? (result.ok ? 0 : 1)
    delete result.exitCode
  } catch (err) {
    code = exitCodeFor(err)
    if (err instanceof ToolError) {
      log.error(err.message, err.details)
      result = { ok: false, error: err.toJSON() }
    } else if (err instanceof FormatError) {
      log.error(err.message)
      result = { ok: false, error: err.toJSON() }
    } else {
      log.error(`unexpected error: ${(err as Error).stack ?? String(err)}`)
      result = { ok: false, error: { code: 'INTERNAL', message: String(err) } }
    }
  }
  process.stdout.write(`${JSON.stringify(result, jsonReplacer, 2)}\n`)
  return code
}

/** JSON replacer: typed arrays as plain arrays, Maps as objects, bigint as string. */
export function jsonReplacer(_key: string, value: unknown): unknown {
  if (value instanceof Uint8Array || value instanceof Uint16Array || value instanceof Uint32Array || value instanceof Int32Array) {
    return Array.from(value)
  }
  if (value instanceof Map) return Object.fromEntries(value)
  if (value instanceof Set) return Array.from(value)
  if (typeof value === 'bigint') return value.toString()
  return value
}
