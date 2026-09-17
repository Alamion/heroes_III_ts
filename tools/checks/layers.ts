// `yarn verify layers` (contracts/checks-cli.md): one-directional layer imports and no
// platform globals in the platform-agnostic layers (constitution V, VI).

import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import ts from 'typescript'
import type { CommandResult } from '../shared/cli-runner.ts'

export interface LayerViolation {
  file: string
  line: number
  from: string
  to: string
  rule: 'layer-order' | 'platform-global' | 'node-import' | 'imports-tools' | 'imports-adapters' | 'adapter-isolation'
  detail: string
}

const LAYER_RANK: Record<string, number> = {
  'core/util': 0,
  'core/data': 1,
  'core/formats': 2,
  'core/state': 3,
  'core/sim': 4,
  'core/render': 5,
  runtime: 6,
  adapters: 7,
}

/**
 * Adapter files tools may import (spec 004 FR-008): the DOM-free settings definition and string
 * tables, used to generate host manifests. These files must stay DOM-free and import nothing from
 * runtime or other adapter files except each other.
 */
export const TOOL_IMPORTABLE_ADAPTER_FILES = new Set(['src/adapters/shared/settings.ts', 'src/adapters/shared/strings.ts'])

/** The adapter folder of a path under src/adapters/ (e.g. "shared", "wallpaper-engine"). */
function adapterFolder(posixPath: string): string | undefined {
  const m = /^src\/adapters\/([^/]+)\//.exec(posixPath)
  return m?.[1]
}

/** Layers that must run in Node and in a worker: no DOM, no Node APIs. */
const PURE_LAYERS = new Set(['core/util', 'core/data', 'core/formats', 'core/state', 'core/sim'])

const DOM_GLOBALS = new Set([
  'window',
  'document',
  'navigator',
  'localStorage',
  'sessionStorage',
  'indexedDB',
  'Worker',
  'self',
  'requestAnimationFrame',
  'cancelAnimationFrame',
  'HTMLCanvasElement',
  'HTMLElement',
  'File',
  'FileReader',
  'fetch',
  'setTimeout',
  'setInterval',
  'process',
  'Buffer',
  'require',
])

/** Globals the renderer may not use (it receives a canvas/GL context from the runtime). */
const RENDER_FORBIDDEN = new Set(['window', 'document', 'indexedDB', 'Worker', 'self', 'localStorage', 'process', 'Buffer', 'require'])

export function layerOf(srcRelative: string): string | undefined {
  const p = srcRelative.split(sep).join('/')
  if (p.startsWith('src/core/')) {
    const seg = p.split('/')[2]
    const key = `core/${seg}`
    return key in LAYER_RANK ? key : undefined
  }
  if (p.startsWith('src/runtime/')) return 'runtime'
  if (p.startsWith('src/adapters/')) return 'adapters'
  if (p.startsWith('tools/')) return 'tools'
  return undefined
}

function listTs(dir: string): string[] {
  const out: string[] = []
  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return out
  }
  for (const e of entries) {
    const full = join(dir, e)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (e === 'node_modules') continue
      out.push(...listTs(full))
    } else if (/\.ts$/.test(e) && !e.endsWith('.d.ts')) {
      out.push(full)
    }
  }
  return out
}

function isDeclarationName(node: ts.Identifier): boolean {
  const p = node.parent
  if (ts.isPropertyAccessExpression(p) && p.name === node) return true
  if ((ts.isPropertyAssignment(p) || ts.isPropertyDeclaration(p) || ts.isPropertySignature(p) || ts.isMethodDeclaration(p) || ts.isMethodSignature(p)) && p.name === node) return true
  if ((ts.isVariableDeclaration(p) || ts.isParameter(p) || ts.isFunctionDeclaration(p) || ts.isClassDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isBindingElement(p)) && p.name === node) return true
  if (ts.isImportSpecifier(p) || ts.isImportClause(p) || ts.isNamespaceImport(p)) return true
  if (ts.isShorthandPropertyAssignment(p)) return false
  if (ts.isQualifiedName(p) && p.right === node) return true
  if (ts.isEnumMember(p) || ts.isGetAccessor(p) || ts.isSetAccessor(p)) return true
  return false
}

/** Names declared anywhere in the file (locals shadowing a global are not violations). */
function declaredNames(sf: ts.SourceFile): Set<string> {
  const names = new Set<string>()
  const visit = (n: ts.Node): void => {
    if ((ts.isVariableDeclaration(n) || ts.isParameter(n) || ts.isFunctionDeclaration(n) || ts.isClassDeclaration(n) || ts.isBindingElement(n)) && n.name !== undefined && ts.isIdentifier(n.name)) {
      names.add(n.name.text)
    }
    if (ts.isImportSpecifier(n) || ts.isNamespaceImport(n)) names.add(n.name.text)
    if (ts.isImportClause(n) && n.name !== undefined) names.add(n.name.text)
    ts.forEachChild(n, visit)
  }
  visit(sf)
  return names
}

export function checkLayers(repoRoot: string): LayerViolation[] {
  const root = resolve(repoRoot)
  const files = [...listTs(join(root, 'src')), ...listTs(join(root, 'tools'))]
  const violations: LayerViolation[] = []
  for (const file of files) {
    const rel = relative(root, file)
    const fromLayer = layerOf(rel)
    if (fromLayer === undefined) continue
    const text = readFileSync(file, 'utf8')
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TS)
    const lineOf = (node: ts.Node): number => sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1

    const specifiers: { spec: string; node: ts.Node }[] = []
    const collect = (n: ts.Node): void => {
      if ((ts.isImportDeclaration(n) || ts.isExportDeclaration(n)) && n.moduleSpecifier !== undefined && ts.isStringLiteral(n.moduleSpecifier)) {
        specifiers.push({ spec: n.moduleSpecifier.text, node: n })
      }
      if (ts.isCallExpression(n) && n.expression.kind === ts.SyntaxKind.ImportKeyword && n.arguments[0] !== undefined && ts.isStringLiteral(n.arguments[0])) {
        specifiers.push({ spec: n.arguments[0].text, node: n })
      }
      ts.forEachChild(n, collect)
    }
    collect(sf)

    for (const { spec, node } of specifiers) {
      const fileRel = rel.split(sep).join('/')
      if (spec.startsWith('.')) {
        const target = relative(root, resolve(dirname(file), spec))
        const toLayer = layerOf(target)
        const targetPosix = target.split(sep).join('/')
        if (targetPosix.startsWith('tools/') && fromLayer !== 'tools') {
          violations.push({ file: fileRel, line: lineOf(node), from: fromLayer, to: 'tools', rule: 'imports-tools', detail: spec })
          continue
        }
        if (toLayer === 'adapters' && fromLayer !== 'adapters') {
          if (fromLayer === 'tools' && TOOL_IMPORTABLE_ADAPTER_FILES.has(targetPosix)) continue
          violations.push({ file: fileRel, line: lineOf(node), from: fromLayer, to: 'adapters', rule: 'imports-adapters', detail: spec })
          continue
        }
        if (fromLayer === 'adapters') {
          const fromFolder = adapterFolder(fileRel)
          const toFolder = toLayer === 'adapters' ? adapterFolder(targetPosix) : undefined
          // Host bridges share only adapters/shared; shared never depends on a host bridge.
          if (toFolder !== undefined && fromFolder !== undefined && toFolder !== fromFolder && (toFolder !== 'shared' || fromFolder === 'dev-harness')) {
            violations.push({ file: fileRel, line: lineOf(node), from: `adapters/${fromFolder}`, to: `adapters/${toFolder}`, rule: 'adapter-isolation', detail: spec })
            continue
          }
          if (TOOL_IMPORTABLE_ADAPTER_FILES.has(fileRel) && !TOOL_IMPORTABLE_ADAPTER_FILES.has(targetPosix)) {
            violations.push({ file: fileRel, line: lineOf(node), from: fileRel, to: targetPosix, rule: 'adapter-isolation', detail: `${spec} (tool-importable files import only each other)` })
            continue
          }
        }
        if (fromLayer !== 'tools' && toLayer !== undefined && toLayer !== 'tools') {
          if ((LAYER_RANK[toLayer] as number) > (LAYER_RANK[fromLayer] as number)) {
            violations.push({ file: fileRel, line: lineOf(node), from: fromLayer, to: toLayer, rule: 'layer-order', detail: spec })
          }
        }
      } else if (fromLayer !== 'tools') {
        const isNode = spec.startsWith('node:') || ['fs', 'path', 'os', 'zlib', 'crypto', 'child_process', 'url'].includes(spec)
        if (isNode) violations.push({ file: fileRel, line: lineOf(node), from: fromLayer, to: spec, rule: 'node-import', detail: spec })
      }
    }

    const toolImportable = TOOL_IMPORTABLE_ADAPTER_FILES.has(rel.split(sep).join('/'))
    const forbidden = PURE_LAYERS.has(fromLayer) || toolImportable ? DOM_GLOBALS : fromLayer === 'core/render' ? RENDER_FORBIDDEN : undefined
    if (forbidden !== undefined) {
      const declared = declaredNames(sf)
      const visit = (n: ts.Node): void => {
        if (ts.isIdentifier(n) && forbidden.has(n.text) && !isDeclarationName(n) && !declared.has(n.text)) {
          // Type positions that only name a DOM type are still platform coupling; report them too.
          violations.push({ file: rel.split(sep).join('/'), line: lineOf(n), from: fromLayer, to: n.text, rule: 'platform-global', detail: n.text })
        }
        ts.forEachChild(n, visit)
      }
      visit(sf)
    }
  }
  return violations
}

export async function layersCommand(): Promise<CommandResult> {
  const violations = checkLayers(process.cwd())
  return { ok: violations.length === 0, violations }
}
