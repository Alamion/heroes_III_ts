import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ACTIONS, SETTINGS } from '../../src/adapters/shared/settings.ts'
import { en } from '../../src/adapters/shared/strings.ts'
import { configQml, KDE_PLUGIN_ID, mainXml, metadataJson, stringsJs } from '../../tools/package/manifests/kde.ts'

describe('KDE manifests (spec 004 FR-017)', () => {
  it('declares a Plasma 6 wallpaper package', () => {
    expect(metadataJson('1.2.3')).toMatchObject({ KPackageStructure: 'Plasma/Wallpaper', 'X-Plasma-API-Minimum-Version': '6.0', KPlugin: { Id: KDE_PLUGIN_ID, Version: '1.2.3' } })
  })

  it('names the author, the repository and the issue forms (spec 006 FR-015, FR-017)', () => {
    expect(metadataJson('1.2.3')).toMatchObject({
      KPlugin: { Authors: [{ Name: 'Alamion' }], Website: 'https://github.com/Alamion/heroes_III_ts', BugReportUrl: 'https://github.com/Alamion/heroes_III_ts/issues/new/choose' },
    })
  })

  it('has one kcfg entry per setting with types, defaults and ranges', () => {
    const xml = mainXml()
    for (const def of SETTINGS) {
      const m = new RegExp(`<entry name="${def.key}" type="(\\w+)">([\\s\\S]*?)</entry>`).exec(xml)
      expect(m, def.key).not.toBeNull()
      const type = m?.[1]
      if (def.type === 'int') {
        expect(type).toBe('Int')
        expect(m?.[2]).toContain(`<min>${def.min}</min>`)
      } else if (def.type === 'bool') expect(type).toBe('Bool')
      else expect(type).toBe('String')
    }
  })

  it('generates a settings page binding every setting and using only known strings', () => {
    const qml = configQml()
    for (const def of SETTINGS) expect(qml).toContain(`property ${def.type === 'int' ? 'int' : def.type === 'bool' ? 'bool' : 'string'} cfg_${def.key}\n`)
    for (const m of qml.matchAll(/page\.t\.(\w+)/g)) expect(en, m[1]).toHaveProperty(m[1] as string)
    expect(qml).toContain('visible: page.cfg_viewmode === "coords"')
    expect(qml).toContain('property int cfg_viewreroll\n')
    expect(qml).toContain('page.cfg_viewreroll = (page.cfg_viewreroll + 1)')
    expect(mainXml()).toContain('<entry name="viewreroll" type="Int">')
    expect(qml).toMatch(/QQC2\.SpinBox \{\n\s+Kirigami\.FormData\.label: page\.t\.setting_viewinterval\n\s+visible: page\.cfg_viewmode === "random"/)
  })

  it('passes every setting from the QML shell to the page', () => {
    const shell = readFileSync(resolve(import.meta.dirname, '../../packaging/kde/contents/ui/main.qml'), 'utf8')
    for (const def of [...SETTINGS, ...ACTIONS]) expect(shell, def.key).toContain(`"${def.key}": c.${def.key}`)
  })

  it('recomputes window coverage whenever the tasks model may refilter', () => {
    // A wallpaper moved to a newly plugged-in monitor stayed black: the model refiltered for the new
    // screen with the same count, so `covered` kept the old screen's answer (2026-09-24).
    const watcher = readFileSync(resolve(import.meta.dirname, '../../packaging/kde/contents/ui/WindowWatcher.qml'), 'utf8')
    for (const handler of ['onScreenGeometryChanged', 'onCurrentDesktopChanged', 'onCurrentActivityChanged', 'onDataChanged', 'onCountChanged', 'onRowsInserted', 'onRowsRemoved', 'onModelReset', 'onLayoutChanged'])
      expect(watcher, handler).toMatch(new RegExp(`${handler}: Qt\\.callLater\\(watcher\\.update\\)`))
  })

  it('ships both string tables for the settings page', () => {
    const js = stringsJs()
    expect(js).toMatch(/\ben: \{/)
    expect(js).toMatch(/\bru: \{/)
    const table = new Function(`${js.replace('.pragma library', '')}; return table`)() as (lang: string) => Record<string, string>
    expect(table('ru_RU').setting_level).toBe('Уровень')
    expect(table('de_DE').setting_level).toBe('Level')
  })
})

describe('KDE map folder (spec 007)', () => {
  it('offers a folder dialog, a .zip dialog and a typed path, shown only with the folder source', () => {
    const qml = configQml()
    expect(qml).toContain('FolderDialog {\n            id: folderDialog_mapfolder')
    expect(qml).toContain('nameFilters: ["*.zip"]')
    expect(qml).toContain('visible: page.cfg_mapsource === "folder"')
    expect(qml).toContain('visible: page.cfg_mapsource === "single"')
    expect(mainXml()).toContain('<entry name="maprotation" type="Int">\n      <default>0</default>\n      <min>0</min>\n      <max>1440</max>')
  })
})
