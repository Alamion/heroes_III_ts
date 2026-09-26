import { randomBytes } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { checkClassicFlavour, checkFeedback, checkKdeWebEngineFallback, checkManifests, checkNoAffiliation, checkNoExternalUrls, checkNoGameContent, checkNoInlineScripts, checkRequired, checkRuntimeSize, MAX_FILE_BYTES } from '../../tools/checks/packages/index.ts'
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
    // Spec 006: exactly the project's own links pass, in prose too.
    expect(checkNoExternalUrls(pkg({ 'README.txt': 'Bug reports: https://github.com/Alamion/heroes_III_ts/issues.' })).outcome).toBe('pass')
    expect(checkNoExternalUrls(pkg({ 'README.txt': 'https://store.kde.org/p/2374098/ and https://alamion.github.io/heroes_III_ts' })).outcome).toBe('pass')
    expect(checkNoExternalUrls(pkg({ 'README.txt': 'https://github.com/someone-else/heroes_III_ts' })).outcome).toBe('fail')
    expect(checkNoExternalUrls(pkg({ 'README.txt': 'https://github.com/Alamion/heroes_III_ts/issues/evil' })).outcome).toBe('fail')
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

  it('guards version, links, author, Workshop id and the absence of e-mail (spec 006)', () => {
    const repo = 'https://github.com/Alamion/heroes_III_ts'
    const readme = `Heroes 3 Living Map 0.1.0 — English\n\nSource: ${repo} · issues: ${repo}/issues`
    const lively = (over: object) => pkg({ 'README.txt': readme, 'LivelyInfo.json': JSON.stringify({ Author: 'Alamion', Contact: `${repo}/issues`, Version: 100, ...over }) })
    expect(checkFeedback('lively', lively({}), '0.1.0').outcome).toBe('pass')
    expect(checkFeedback('lively', lively({ Contact: '' }), '0.1.0').details).toEqual(['LivelyInfo.json Contact '])
    expect(checkFeedback('lively', lively({ Version: 1 }), '0.1.0').outcome).toBe('fail')
    expect(checkFeedback('lively', lively({}), '0.2.0').details[0]).toMatch(/first line lacks version 0.2.0/)
    expect(checkFeedback('lively', lively({ Author: 'me@example.org' }), '0.1.0').details.join()).toMatch(/e-mail address me@example.org/)
    const we = (pj: object) => pkg({ 'README.txt': readme, 'project.json': JSON.stringify(pj) })
    expect(checkFeedback('wallpaper-engine', we({ workshopid: '3808342201' }), '0.1.0').outcome).toBe('pass')
    expect(checkFeedback('wallpaper-engine', we({}), '0.1.0').outcome).toBe('fail')
    const web = (js: string) => pkg({ 'assets/index.js': js })
    expect(checkFeedback('web', web(`a("${repo}/issues/new/choose"),b(\`0.1.0\`)`), '0.1.0').outcome).toBe('pass')
    expect(checkFeedback('web', web('b("0.1.0")'), '0.1.0').outcome).toBe('fail')
  })

  it('keeps QtWebEngine out of main.qml and shows the missing-module message (spec 006 US5)', async () => {
    const { kdePackage } = await import('../../tools/package/manifests/kde.ts')
    const files = kdePackage(process.cwd(), { listener: undefined, main: '' })
    expect(checkKdeWebEngineFallback('kde', files)).toMatchObject({ outcome: 'pass' })
    const broken = new Map(files)
    broken.set('contents/ui/main.qml', utf8(`import QtQuick\nimport QtWebEngine\nWebEngineView {}\n`))
    expect(checkKdeWebEngineFallback('kde', broken).details.length).toBeGreaterThanOrEqual(3)
    broken.delete('contents/ui/WebView.qml')
    expect(checkKdeWebEngineFallback('kde', broken).details).toContain('contents/ui/WebView.qml is missing')
    expect(checkKdeWebEngineFallback('web', files).outcome).toBe('skip')
  })
})
