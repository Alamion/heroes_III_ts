// KDE Plasma 6 wallpaper plugin package (spec 004 contracts/settings.md "KDE"): metadata, kcfg
// schema, a generated settings page with the string table, the QML shell from packaging/kde and the
// classic page under contents/web.

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { ACTIONS, SETTINGS } from '../../../src/adapters/shared/settings.ts'
import type { ActionDef, SettingDef } from '../../../src/adapters/shared/settings.ts'
import { en, ru } from '../../../src/adapters/shared/strings.ts'
import type { ClassicBundle, PackageFiles } from '../build.ts'
import { AUTHOR, NEW_ISSUE_URL, REPOSITORY_URL } from '../../../src/adapters/shared/project.ts'
import { readme, utf8, versionOf } from './common.ts'

export const KDE_PLUGIN_ID = 'io.github.alamion.h3dynam'

const xmlEscape = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export function metadataJson(version: string): Record<string, unknown> {
  return {
    KPackageStructure: 'Plasma/Wallpaper',
    KPlugin: {
      Id: KDE_PLUGIN_ID,
      Name: en.package_title,
      'Name[ru]': ru.package_title,
      Description: en.package_description,
      'Description[ru]': ru.package_description,
      Icon: 'preferences-desktop-wallpaper',
      License: 'MIT',
      Version: version,
      Authors: [{ Name: AUTHOR }],
      // Spec 006 FR-015/FR-017: shown in Plasma's "About" of the plugin.
      Website: REPOSITORY_URL,
      BugReportUrl: NEW_ISSUE_URL,
    },
    'X-Plasma-API-Minimum-Version': '6.0',
    'X-KDE-ParentApp': 'org.kde.plasmashell',
  }
}

function kcfgEntry(def: SettingDef | ActionDef): string {
  // An action is a counter: the settings page increments it, the shell passes it to the page.
  if (def.type === 'action') return `    <entry name="${def.key}" type="Int">\n      <default>0</default>\n    </entry>`
  if (def.type === 'file') return `    <entry name="${def.key}" type="String">\n      <default></default>\n    </entry>`
  if (def.type === 'enum') return `    <entry name="${def.key}" type="String">\n      <default>${xmlEscape(def.default)}</default>\n    </entry>`
  if (def.type === 'int') return `    <entry name="${def.key}" type="Int">\n      <default>${def.default}</default>\n      <min>${def.min}</min>\n      <max>${def.max}</max>\n    </entry>`
  return `    <entry name="${def.key}" type="Bool">\n      <default>${def.default}</default>\n    </entry>`
}

export function mainXml(): string {
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<kcfg xmlns="http://www.kde.org/standards/kcfg/1.0" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.kde.org/standards/kcfg/1.0 http://www.kde.org/standards/kcfg/1.0/kcfg.xsd">',
    '  <kcfgfile name=""/>',
    '  <group name="General">',
    ...[...SETTINGS, ...ACTIONS].map(kcfgEntry),
    '  </group>',
    '</kcfg>',
    '',
  ].join('\n')
}

/** String tables for the settings page, picked by Qt.uiLanguage. */
export function stringsJs(): string {
  return [
    '.pragma library',
    '// Generated from src/adapters/shared/strings.ts by yarn package.',
    `var tables = {\n  en: ${JSON.stringify(en)},\n  ru: ${JSON.stringify(ru)}\n};`,
    'function table(lang) {',
    '  return /^ru(\\b|[-_])/i.test(String(lang || "")) ? tables.ru : tables.en;',
    '}',
    '',
  ].join('\n')
}

/** `visible:` line for a setting shown only for one value of another (spec 007: the folder settings). */
const visibleLine = (def: { visibleWhen?: { key: string; equals: string } }): string =>
  def.visibleWhen !== undefined ? `\n        visible: page.cfg_${def.visibleWhen.key} === "${def.visibleWhen.equals}"` : ''

function configRow(def: SettingDef | ActionDef): string {
  const k = def.key
  const visible = visibleLine(def)
  if (def.type === 'action') {
    // Written to the live configuration too, so the desktop reacts without "Apply".
    return `    QQC2.Button {
        Kirigami.FormData.label: " "${visible}
        icon.name: "${k === 'mapnext' ? 'go-next' : 'roll'}"
        text: page.t.${def.label}
        onClicked: {
            page.cfg_${k} = (page.cfg_${k} + 1) % 1000000
            if (page.wallpaperConfiguration) page.wallpaperConfiguration["${k}"] = page.cfg_${k}
        }
    }`
  }
  if (def.type === 'file' && def.pick === 'folder') {
    // Spec 007: a folder of maps (listed by the page), or a .zip standing for one; the path can be typed.
    return `    RowLayout {
        Kirigami.FormData.label: page.t.${def.label}${visible}
        QQC2.TextField {
            Layout.preferredWidth: Kirigami.Units.gridUnit * 14
            text: page.cfg_${k}
            placeholderText: page.t.panel_none
            onEditingFinished: page.cfg_${k} = text.trim()
        }
        QQC2.Button {
            icon.name: "folder-open"
            text: page.t.panel_choose_folder
            onClicked: folderDialog_${k}.open()
        }
        QQC2.Button {
            icon.name: "application-zip"
            text: page.t.panel_choose_zip
            onClicked: dialog_${k}.open()
        }
        QQC2.Button {
            icon.name: "edit-clear"
            visible: page.cfg_${k} !== ""
            onClicked: page.cfg_${k} = ""
        }
        FolderDialog {
            id: folderDialog_${k}
            onAccepted: page.cfg_${k} = selectedFolder.toString()
        }
        FileDialog {
            id: dialog_${k}
            nameFilters: ["${def.fileFilter}"]
            onAccepted: page.cfg_${k} = selectedFile.toString()
        }
    }`
  }
  if (def.type === 'file') {
    return `    RowLayout {
        Kirigami.FormData.label: page.t.${def.label}${visible}
        QQC2.Label {
            Layout.maximumWidth: Kirigami.Units.gridUnit * 16
            elide: Text.ElideMiddle
            text: page.cfg_${k} !== "" ? decodeURIComponent(page.cfg_${k}.split("/").pop()) : page.t.panel_none
        }
        QQC2.Button {
            icon.name: "document-open"
            text: page.t.panel_choose
            onClicked: dialog_${k}.open()
        }
        QQC2.Button {
            icon.name: "edit-clear"
            visible: page.cfg_${k} !== ""
            onClicked: page.cfg_${k} = ""
        }
        FileDialog {
            id: dialog_${k}
            nameFilters: ["${def.fileFilter}", "*"]
            onAccepted: page.cfg_${k} = selectedFile.toString()
        }
    }`
  }
  if (def.type === 'enum') {
    const model = def.options.map((o) => `{ "value": "${o.value}", "text": page.t.${o.label} }`).join(', ')
    return `    QQC2.ComboBox {
        id: combo_${k}
        Kirigami.FormData.label: page.t.${def.label}${visible}
        textRole: "text"
        valueRole: "value"
        model: [${model}]
        onActivated: page.cfg_${k} = currentValue
        Component.onCompleted: currentIndex = indexOfValue(page.cfg_${k})
    }`
  }
  if (def.type === 'int' && def.input === 'number') {
    return `    QQC2.SpinBox {
        Kirigami.FormData.label: page.t.${def.label}${visible}
        editable: true
        from: ${def.min}
        to: ${def.max}
        stepSize: ${def.step}
        value: page.cfg_${k}
        onValueModified: page.cfg_${k} = value
    }`
  }
  if (def.type === 'int') {
    return `    RowLayout {
        Kirigami.FormData.label: page.t.${def.label}${visible}
        QQC2.Slider {
            id: slider_${k}
            from: ${def.min}
            to: ${def.max}
            stepSize: ${def.step}
            value: page.cfg_${k}
            onMoved: page.cfg_${k} = Math.round(value)
        }
        QQC2.Label {
            text: page.cfg_${k}
        }
    }`
  }
  return `    QQC2.CheckBox {
        Kirigami.FormData.label: page.t.${def.label}${visible}
        checked: page.cfg_${k}
        onToggled: page.cfg_${k} = checked
    }`
}

export function configQml(): string {
  const props = [...SETTINGS, ...ACTIONS].map((d) => {
    if (d.type === 'action') return `    property int cfg_${d.key}\n    property int cfg_${d.key}Default: 0`
    const type = d.type === 'int' ? 'int' : d.type === 'bool' ? 'bool' : 'string'
    const dflt = d.type === 'file' ? '""' : d.type === 'enum' ? `"${d.default}"` : String(d.default)
    return `    property ${type} cfg_${d.key}\n    property ${type} cfg_${d.key}Default: ${dflt}`
  }).join('\n')
  return `// Generated from src/adapters/shared/settings.ts by yarn package (spec 004 contracts/settings.md).
import QtQuick
import QtQuick.Controls as QQC2
import QtQuick.Dialogs
import QtQuick.Layouts
import org.kde.kirigami as Kirigami
import "strings.js" as Strings

Kirigami.FormLayout {
    id: page
    readonly property var t: Strings.table(Qt.uiLanguage !== "" ? Qt.uiLanguage : Qt.locale().name)
    // Set by Plasma: the live wallpaper configuration and the dialog.
    property var wallpaperConfiguration
    property var configDialog
${props}

${[...SETTINGS, ...ACTIONS].sort((a, b) => a.order - b.order).map(configRow).join('\n\n')}

    QQC2.Label {
        Layout.maximumWidth: Kirigami.Units.gridUnit * 24
        wrapMode: Text.WordWrap
        opacity: 0.7
        text: page.t.help_files + "\\n\\n" + page.t.help_privacy
    }
}
`
}

export function kdePackage(repoRoot: string, bundle: ClassicBundle): PackageFiles {
  const version = versionOf(repoRoot)
  const read = (p: string) => new Uint8Array(readFileSync(resolve(repoRoot, p)))
  const files: PackageFiles = new Map()
  files.set('metadata.json', utf8(`${JSON.stringify(metadataJson(version), null, 2)}\n`))
  for (const f of ['main.qml', 'WebView.qml', 'SharedProfile.qml', 'qmldir', 'WindowWatcher.qml', 'LockWatcher.qml']) files.set(`contents/ui/${f}`, read(`packaging/kde/contents/ui/${f}`))
  files.set('contents/ui/config.qml', utf8(configQml()))
  files.set('contents/ui/strings.js', utf8(stringsJs()))
  files.set('contents/config/main.xml', utf8(mainXml()))
  files.set('contents/web/index.html', read('src/adapters/kde/index.html'))
  files.set('contents/web/page.css', read('src/adapters/shared/page.css'))
  files.set('contents/web/main.js', utf8(bundle.main))
  files.set('README.md', readme('help_kde', version))
  return files
}
