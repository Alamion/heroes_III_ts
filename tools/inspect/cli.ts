// Entry point: yarn h3 <group> <command> [options]. See specs/002-foundation-rewrite/contracts/inspect-cli.md
// and specs/003-map-objects/contracts/inspect-cli.md.
import { runCli } from '../shared/cli-runner.ts'
import type { CommandSpec } from '../shared/cli-runner.ts'

export const INSPECT_COMMANDS: Record<string, CommandSpec> = {
  'lod list': { help: 'list LOD entries [--filter GLOB]', load: async () => (await import('./lod.ts')).lodList },
  'lod extract': { help: 'extract FILE:ENTRY --out PATH', load: async () => (await import('./lod.ts')).lodExtract },
  'def dump': { help: 'DEF groups and frames', load: async () => (await import('./def.ts')).defDump },
  'def png': { help: 'export a DEF frame as PNG --frame N --out PATH [--full] [--opaque] [--step N]', booleanFlags: ['full', 'opaque'], load: async () => (await import('./def.ts')).defPng },
  'def palette': { help: 'DEF palette after --step N rotation steps', load: async () => (await import('./def.ts')).defPalette },
  'pcx dump': { help: 'PCX image header', load: async () => (await import('./pcx.ts')).pcxDump },
  'pcx png': { help: 'export PCX as PNG --out PATH', load: async () => (await import('./pcx.ts')).pcxPng },
  'map info': { help: 'map header, players, conditions, counts', load: async () => (await import('./map.ts')).mapInfo },
  'map tile': { help: 'one tile --x --y [--level] with covering objects', load: async () => (await import('./map.ts')).mapTile },
  'map tiles': { help: 'tile records [--level] [--region x0,y0,x1,y1]', load: async () => (await import('./map.ts')).mapTiles },
  'map objects': { help: 'objects [--level] [--region] [--class ID]', load: async () => (await import('./map.ts')).mapObjects },
  'map object': { help: 'one object --index N', load: async () => (await import('./map.ts')).mapObject },
  'map draw-list': { help: 'objects drawn in a region, in draw order: MAP --level Z --region x0,y0,x1,y1 (--time MS | --tick N) [--seed S]', load: async () => (await import('./objects.ts')).mapDrawList },
  'map random': { help: 'resolved random objects: MAP [--seed S] [--level Z]', load: async () => (await import('./objects.ts')).mapRandom },
  'map floating': { help: 'floating tiles [--level Z] [--region] [--format list|json]', load: async () => (await import('./floating.ts')).mapFloating },
  render: { help: 'render a map region headlessly: MAP --level Z --region x0,y0,x1,y1 (--time MS | --palette-step N) [--tick N] [--seed S] [--no-objects] [--draw-list] --out PATH [--archive FILE] [--rebuild]', booleanFlags: ['rebuild', 'no-objects', 'draw-list'], load: async () => (await import('./render.ts')).renderCommand },
  'map parse-all': { help: 'parse every map in the install Maps folder [--dir DIR]', load: async () => (await import('./map.ts')).mapParseAll },
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCli('h3', INSPECT_COMMANDS, process.argv.slice(2)).then((code) => {
    process.exitCode = code
  })
}
