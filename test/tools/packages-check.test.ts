import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkClassicFlavour, checkManifests, checkNoAffiliation, checkNoExternalUrls, checkNoGameContent, checkNoInlineScripts, checkRequired, checkRuntimeSize, MAX_FILE_BYTES } from '../../tools/checks/packages/index.ts'
import type { PackageFiles } from '../../tools/package/build.ts'
import { projectJson } from '../../tools/package/manifests/wallpaper-engine.ts'

const utf8 = (t: string) => new TextEncoder().encode(t)
const pkg = (entries: Record<string, Uint8Array | string>): PackageFiles => new Map(Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? utf8(v) : v]))
const CSP = `<meta http-equiv="Content-Security-Policy" content="default-src 'self'" />`

describe('package checks (spec 004 FR-020)', () => {
  it('finds game files by extension, signature and size', () => {
    const r = checkNoGameContent(
      pkg({
        'userfiles/H3sprite.lod': new Uint8Array(4),
        'data.bin': Uint8Array.of(0x4c, 0x4f, 0x44, 0, 1),
        'map.dat': Uint8Array.of(0x1f, 0x8b, 8, 0),
        'big.js': new Uint8Array(MAX_FILE_BYTES + 1),
        'ok.js': 'console',
      }),
    )
    expect(r.outcome).toBe('fail')
    expect(r.details).toHaveLength(4)
  })

  it('rejects external URLs but allows XML namespaces', () => {
    expect(checkNoExternalUrls(pkg({ 'a.js': 'fetch("https://example.com/x.js")' })).outcome).toBe('fail')
    expect(checkNoExternalUrls(pkg({ 'a.js': 'createElementNS("http://www.w3.org/2000/svg","svg")' })).outcome).toBe('pass')
  })

  it('rejects affiliation wording in manifests', () => {
    expect(checkNoAffiliation(pkg({ 'project.json': '{"title":"Official Ubisoft wallpaper"}' })).details).toHaveLength(2)
    expect(checkNoAffiliation(pkg({ 'README.txt': 'Fan-made, not affiliated with the game publishers.' })).outcome).toBe('pass')
  })

  it('requires CSP and forbids inline scripts, styles and handlers', () => {
    expect(checkNoInlineScripts(pkg({ 'index.html': `${CSP}<script src="main.js"></script>` })).outcome).toBe('pass')
    const bad = checkNoInlineScripts(pkg({ 'index.html': '<script>go()</script><style>a{}</style><body onload="x()" style="color:red">' }))
    expect(bad.details).toHaveLength(5)
  })

  it('forbids module scripts in host packages', () => {
    expect(checkClassicFlavour('wallpaper-engine', pkg({ 'index.html': '<script type="module" src="m.js"></script>', 'main.js': 'new Worker(u,{type:"module"});import.meta.url' })).details).toHaveLength(3)
    expect(checkClassicFlavour('web', pkg({ 'index.html': '<script type="module"></script>' })).outcome).toBe('skip')
  })

  it('checks required files, manifests and size', () => {
    expect(checkRequired('wallpaper-engine', pkg({ 'index.html': '' })).outcome).toBe('fail')
    expect(checkManifests('wallpaper-engine', pkg({ 'project.json': JSON.stringify(projectJson()) })).outcome).toBe('pass')
    const broken = projectJson() as { general: { properties: Record<string, unknown> } }
    delete broken.general.properties.scale
    expect(checkManifests('wallpaper-engine', pkg({ 'project.json': JSON.stringify(broken) })).outcome).toBe('fail')
    const random = new Uint8Array(randomBytes(200_000))
    expect(checkRuntimeSize(pkg({ 'main.js': random })).outcome).toBe('fail')
  })
})
