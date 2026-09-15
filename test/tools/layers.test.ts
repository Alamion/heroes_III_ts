import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { checkLayers } from '../../tools/checks/layers.ts'

const roots: string[] = []

function tree(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), 'layers-'))
  roots.push(root)
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true })
    writeFileSync(join(root, path), content)
  }
  return root
}

afterAll(() => {
  for (const r of roots) rmSync(r, { recursive: true, force: true })
})

describe('verify layers', () => {
  it('passes for downward imports', () => {
    const root = tree({
      'src/core/util/a.ts': 'export const a = 1\n',
      'src/core/formats/b.ts': "import { a } from '../util/a.ts'\nexport const b = a\n",
      'src/core/render/c.ts': "import { b } from '../formats/b.ts'\nexport const c = (gl: WebGLRenderingContext) => b + gl.drawingBufferWidth\n",
      'src/runtime/d.ts': "import { c } from '../core/render/c.ts'\nexport const d = () => window.innerWidth + c.length\n",
      'tools/x.ts': "import { readFileSync } from 'node:fs'\nimport { d } from '../src/runtime/d.ts'\nexport const x = [readFileSync, d]\n",
    })
    expect(checkLayers(root)).toEqual([])
  })

  it('reports upward imports, platform globals and node imports', () => {
    const root = tree({
      'src/core/render/r.ts': 'export const r = 1\n',
      'src/core/formats/bad.ts': "import { r } from '../render/r.ts'\nimport { readFileSync } from 'node:fs'\nexport const bad = () => document.title + r + String(readFileSync)\n",
      'src/core/state/local.ts': 'export function f(window: number) { return window }\n',
      'src/runtime/t.ts': "import { x } from '../../tools/x.ts'\nexport const t = x\n",
      'tools/x.ts': 'export const x = 1\n',
    })
    const rules = checkLayers(root).map((v) => `${v.file}:${v.rule}:${v.to}`)
    expect(rules).toContain('src/core/formats/bad.ts:layer-order:core/render')
    expect(rules).toContain('src/core/formats/bad.ts:node-import:node:fs')
    expect(rules).toContain('src/core/formats/bad.ts:platform-global:document')
    expect(rules).toContain('src/runtime/t.ts:imports-tools:tools')
    expect(rules.some((r) => r.startsWith('src/core/state/local.ts'))).toBe(false)
  })
})
