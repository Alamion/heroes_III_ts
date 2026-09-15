# Contract: Inspection CLI (`yarn h3`)

`yarn h3 <group> <command> [options]` → `node tools/inspect/cli.ts`. Same conventions as
`yarn ref`: exactly one JSON document on stdout, logs on stderr (`--log-level`), exit codes
0 ok, 1 failure, 2 usage, 3 missing prerequisite (game files not found).

**File arguments**: a path, or `archive.lod:ENTRY` for LOD entries (case-insensitive), or a bare
name resolved through `public/dev-assets/`, then `<bundleDir>/Maps` and `<bundleDir>/Data`
(bundleDir from `H3REF_BUNDLE_DIR` / `reference-env.config.json`).

**Errors**: `{ "ok": false, "error": { "code", "file", "offset", "format", "version",
"structure", "message" } }`.

## LOD

| Command | Output |
| --- | --- |
| `lod list FILE [--filter GLOB]` | `{ ok, file, count, entries: [{name, offset, size, compressedSize, type}] }` |
| `lod extract FILE:ENTRY --out PATH` | `{ ok, entry, bytes, sha256, out }` (byte-exact) |

## DEF

| Command | Output |
| --- | --- |
| `def dump FILE:ENTRY` | `{ ok, name, type, fullWidth, fullHeight, specialIndices, groups: [{type, frames: [{name, viewIndex, compression, width, height, x, y}]}] }` |
| `def png FILE:ENTRY --frame VIEWINDEX [--group G --index I] --out PATH [--full]` | `{ ok, out, width, height }`; lossless RGBA, index 0 transparent, shadows as alpha |
| `def palette FILE:ENTRY [--step N]` | `{ ok, palette: [[r,g,b]×256], rotations: [...] }` (for rotating DEFs, after N steps) |

## PCX

| Command | Output |
| --- | --- |
| `pcx dump FILE:ENTRY` | `{ ok, width, height, kind }` |
| `pcx png FILE:ENTRY --out PATH` | `{ ok, out }` |

## Map

| Command | Output |
| --- | --- |
| `map info MAP` | header, players, victory/loss, teams, counts of templates/objects/events, `sha256` |
| `map tile MAP --x X --y Y --level Z` | tile record + objects whose footprint covers it |
| `map tiles MAP --level Z [--region x0,y0,x1,y1]` | tile records (compact arrays) |
| `map objects MAP [--level Z] [--region …] [--class ID]` | objects with template and full body |
| `map object MAP --index N` | one object |
| `map floating MAP [--level Z] [--region …] [--format list\|json]` | `list` (default; `--level` defaults to 0, one level only, since item 1 tile keys carry no level): `{ ok, level, tiles: "x,y;x,y", count }` (item 1 `--floating-tiles` format); `json` (all levels unless `--level`): per level and tile `causes: [{kind: randomObject\|generatedHero, index, classId?, player?}]` |
| `map parse-all [--dir DIR]` | `{ ok, parsed, unsupported: [{file, version}], failed: [{file, error}] }` (SC-002a) |

`map floating` and object footprints need sprite archives (`h3sprite.lod`, `H3ab_spr.lod`) and
`h3bitmap.lod` for `Objects.txt`; resolved from bundleDir, overridable with
`--sprites FILE --sprites FILE --bitmaps FILE`.

Example (selfcheck integration):

```bash
tiles=$(yarn -s h3 map floating Arrogance.h3m --level 0 | jq -r .tiles)
yarn ref selfcheck --map Arrogance.h3m --floating-tiles "$tiles"
```

## Render

| Command | Output |
| --- | --- |
| `render MAP --level Z --region x0,y0,x1,y1 (--time MS \| --palette-step N) --out PATH [--border]` | `{ ok, out, width, height, visible, paletteStep }`; headless Chromium + SwiftShader, 32 px tiles, pixel-identical for identical inputs |
