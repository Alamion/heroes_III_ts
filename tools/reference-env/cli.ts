// Entry point: yarn ref <command> [options]. See specs/001-reference-environment/contracts/cli.md.
import { ERROR_CODES, RefError } from './errors.ts'
import { isLogLevel, log, setLogLevel } from './log.ts'

export interface ParsedArgs {
  command: string | undefined
  flags: Map<string, string[]>
}

const BOOLEAN_FLAGS = new Set(['force', 'dry-run', 'json-only', 'keep-going'])

export function parseArgs(argv: string[]): ParsedArgs {
  const flags = new Map<string, string[]>()
  let command: string | undefined
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] as string
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=')
      const name = eq > 0 ? arg.slice(2, eq) : arg.slice(2)
      let value: string
      if (eq > 0) value = arg.slice(eq + 1)
      else if (BOOLEAN_FLAGS.has(name)) value = 'true'
      else {
        const next = argv[i + 1]
        if (next === undefined || next.startsWith('--')) {
          throw new RefError(ERROR_CODES.USAGE, `option --${name} needs a value`)
        }
        value = next
        i++
      }
      flags.set(name, [...(flags.get(name) ?? []), value])
    } else if (command === undefined) {
      command = arg
    } else {
      throw new RefError(ERROR_CODES.USAGE, `unexpected argument "${arg}"`)
    }
  }
  return { command, flags }
}

export function exitCodeFor(err: unknown): number {
  if (err instanceof RefError) {
    if (err.code === ERROR_CODES.USAGE) return 2
    if (err.code === ERROR_CODES.PREREQ_MISSING) return 3
    return 1
  }
  return 1
}

export interface CommandResult {
  ok: boolean
  exitCode?: number
  [key: string]: unknown
}

export type Command = (args: ParsedArgs) => Promise<CommandResult>

const COMMANDS: Record<string, () => Promise<Command>> = {
  doctor: async () => (await import('./commands/doctor.ts')).doctorCommand,
  setup: async () => (await import('./commands/setup.ts')).setupCommand,
  calibrate: async () => (await import('./commands/calibrate.ts')).calibrateCommand,
  still: async () => (await import('./commands/still.ts')).stillCommand,
  clip: async () => (await import('./commands/clip.ts')).clipCommand,
  editor: async () => (await import('./commands/editor.ts')).editorCommand,
  find: async () => (await import('./commands/find.ts')).findCommand,
  list: async () => (await import('./commands/list.ts')).listCommand,
  prune: async () => (await import('./commands/prune.ts')).pruneCommand,
  selfcheck: async () => (await import('./commands/selfcheck.ts')).selfcheckCommand,
}

export async function main(argv: string[]): Promise<number> {
  let result: CommandResult
  let code = 0
  try {
    const args = parseArgs(argv)
    const level = args.flags.get('log-level')?.[0]
    if (level !== undefined) {
      if (!isLogLevel(level)) throw new RefError(ERROR_CODES.USAGE, `unknown log level "${level}"`)
      setLogLevel(level)
    }
    if (args.command === undefined || !(args.command in COMMANDS)) {
      throw new RefError(
        ERROR_CODES.USAGE,
        `usage: yarn ref <${Object.keys(COMMANDS).join('|')}> [options]` +
          (args.command !== undefined ? ` (unknown command "${args.command}")` : ''),
      )
    }
    const load = COMMANDS[args.command] as () => Promise<Command>
    result = await (await load())(args)
    code = result.exitCode ?? (result.ok ? 0 : 1)
    delete result.exitCode
  } catch (err) {
    code = exitCodeFor(err)
    if (err instanceof RefError) {
      log.error(err.message, err.details)
      result = { ok: false, error: err.toJSON() }
    } else {
      log.error(`unexpected error: ${(err as Error).stack ?? String(err)}`)
      result = { ok: false, error: { code: 'INTERNAL', message: String(err) } }
    }
  }
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
  return code
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
