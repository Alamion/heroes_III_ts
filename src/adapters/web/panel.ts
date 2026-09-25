// Settings panel of the browser version (spec 004 FR-013, contracts/settings.md "Browser — panel"):
// rendered from the settings definition, localized, hides itself after 4 s without pointer activity
// while the map is shown.

import type { ControllerSnapshot } from '../shared/controller.ts'
import type { FileSlot } from '../shared/messages.ts'
import { SLOT_KIND_KEYS } from '../shared/messages.ts'
import { SETTINGS, validateSettings } from '../shared/settings.ts'
import type { SettingKey, WallpaperSettings } from '../shared/settings.ts'
import { format } from '../shared/strings.ts'
import type { Language, StringKey } from '../shared/strings.ts'

export type LanguageChoice = 'auto' | 'en' | 'ru'
export const PANEL_IDLE_MS = 4000

export interface PanelHandlers {
  onSetting(key: SettingKey, value: string | number | boolean): void
  onFiles(files: File[]): void
  onForget(): void
  onNewPlace(): void
  onLanguage(choice: LanguageChoice): void
  /** Spec 007: a folder chosen with the folder picker (files carry webkitRelativePath). */
  onFolder(files: File[]): void
  onNextMap(): void
}

export interface Panel {
  update(state: ControllerSnapshot, languageChoice: LanguageChoice): void
  toggle(): void
  /** Pointer or key activity: shows the panel and restarts the idle timer. */
  activity(): void
  element: HTMLElement
}

const FILE_SLOTS: readonly FileSlot[] = ['spriteArchive', 'dataArchive', 'hotaArchive', 'map']
/** Slots listed only once a file fills them: the HotA archive is optional. */
const OPTIONAL_SLOTS: ReadonlySet<FileSlot> = new Set(['hotaArchive'])

export function createPanel(root: HTMLElement, handlers: PanelHandlers): Panel {
  const doc = root.ownerDocument
  const el = doc.createElement('aside')
  el.className = 'h3p'
  root.append(el)
  let hideTimer: number | undefined
  let pinnedHidden = false
  let last: { state: ControllerSnapshot; choice: LanguageChoice } | undefined
  /** Last settings rendered: controls are rebuilt only when language or visibility changes. */
  let renderedKey = ''

  const input = doc.createElement('input')
  input.type = 'file'
  input.multiple = true
  input.hidden = true
  input.addEventListener('change', () => {
    handlers.onFiles(Array.from(input.files ?? []))
    input.value = ''
  })
  root.append(input)
  // Spec 007: a folder of maps; the browser hands over every file with its relative path.
  const folderInput = doc.createElement('input')
  folderInput.type = 'file'
  folderInput.id = 'h3p-folder-input'
  folderInput.hidden = true
  folderInput.setAttribute('webkitdirectory', '')
  folderInput.addEventListener('change', () => {
    handlers.onFolder(Array.from(folderInput.files ?? []))
    folderInput.value = ''
  })
  root.append(folderInput)

  const el_ = <K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string): HTMLElementTagNameMap[K] => {
    const e = doc.createElement(tag)
    if (cls !== undefined) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  const scheduleHide = (): void => {
    if (hideTimer !== undefined) window.clearTimeout(hideTimer)
    hideTimer = window.setTimeout(() => {
      if (last?.state.phase === 'showing' && !el.matches(':hover') && !el.contains(doc.activeElement)) el.classList.add('h3p-hidden')
    }, PANEL_IDLE_MS)
  }

  const settingRow = (lang: Language, settings: WallpaperSettings, key: SettingKey): HTMLElement | undefined => {
    const def = SETTINGS.find((d) => d.key === key)
    if (def === undefined || def.type === 'file') return undefined
    if (def.visibleWhen !== undefined && String(settings[def.visibleWhen.key]) !== def.visibleWhen.equals) return undefined
    const row = el_('div', 'h3p-row')
    const id = `h3p-${key}`
    const label = el_('label', undefined, format(lang, def.label))
    label.htmlFor = id
    row.append(label)
    if (def.type === 'enum') {
      const select = el_('select')
      select.id = id
      for (const o of def.options) {
        const opt = el_('option', undefined, format(lang, o.label))
        opt.value = o.value
        select.append(opt)
      }
      select.value = String(settings[key])
      select.addEventListener('change', () => handlers.onSetting(key, select.value))
      row.append(select)
    } else if (def.type === 'int') {
      if (def.input === 'number') {
        const field = el_('input')
        field.id = id
        field.type = 'number'
        field.inputMode = 'numeric'
        field.min = String(def.min)
        field.max = String(def.max)
        field.step = String(def.step)
        field.value = String(settings[key])
        field.addEventListener('change', () => {
          // Invalid or out-of-range input is corrected and shown corrected.
          const value = validateSettings({ [key]: field.value }).patch[key] as number
          field.value = String(value)
          handlers.onSetting(key, value)
        })
        row.append(field)
        return row
      }
      const range = el_('input')
      range.id = id
      range.type = 'range'
      range.min = String(def.min)
      range.max = String(def.max)
      range.step = String(def.step)
      range.value = String(settings[key])
      range.addEventListener('input', () => handlers.onSetting(key, Number(range.value)))
      row.append(range)
    } else {
      const box = el_('input')
      box.id = id
      box.type = 'checkbox'
      box.checked = settings[key] === true
      box.addEventListener('change', () => handlers.onSetting(key, box.checked))
      row.append(box)
    }
    return row
  }

  const render = (state: ControllerSnapshot, choice: LanguageChoice): void => {
    const lang = state.language
    el.lang = lang
    el.replaceChildren()
    const close = el_('button', 'h3p-close', '×')
    close.title = format(lang, 'panel_hide')
    close.addEventListener('click', () => panel.toggle())
    el.append(close, el_('h2', undefined, format(lang, 'panel_title')))

    el.append(el_('h3', undefined, format(lang, 'panel_files')))
    for (const slot of FILE_SLOTS) {
      const s = state.slots[slot]
      if (OPTIONAL_SLOTS.has(slot) && s.status !== 'loaded') continue
      const row = el_('div', `h3p-file${s.status === 'loaded' ? '' : ' h3p-missing'}`)
      row.dataset.slot = slot
      row.append(el_('span', undefined, format(lang, SLOT_KIND_KEYS[slot])), el_('span', undefined, s.name ?? format(lang, 'panel_none')))
      el.append(row)
    }
    const actions = el_('div', 'h3p-row')
    const choose = el_('button', undefined, format(lang, 'panel_choose'))
    choose.id = 'h3p-choose'
    choose.addEventListener('click', () => input.click())
    const forget = el_('button', undefined, format(lang, 'panel_forget'))
    forget.id = 'h3p-forget'
    forget.addEventListener('click', () => handlers.onForget())
    actions.append(choose, forget)
    el.append(actions, el_('div', 'h3p-hint', format(lang, 'panel_drop')))

    // Spec 007: the map source; with a folder its summary, the map shown, filters and "next map".
    el.append(el_('h3', undefined, format(lang, 'setting_mapsource')))
    const sourceRow = settingRow(lang, state.settings, 'mapsource')
    if (sourceRow !== undefined) el.append(sourceRow)
    if (state.settings.mapsource === 'folder') {
      const f = state.folder
      const folderRow = el_('div', 'h3p-row')
      const chooseFolder = el_('button', undefined, format(lang, 'panel_choose_folder'))
      chooseFolder.id = 'h3p-choose-folder'
      chooseFolder.addEventListener('click', () => folderInput.click())
      folderRow.append(chooseFolder)
      el.append(folderRow)
      if (f !== null && f.entries !== null) {
        const summary = el_('div', 'h3p-hint', format(lang, 'panel_folder_summary', { file: f.name, detail: String(f.entries) }))
        summary.id = 'h3p-folder-summary'
        el.append(summary)
      } else {
        el.append(el_('div', 'h3p-hint', format(lang, 'panel_drop_folder')))
      }
      if (f?.shown != null) {
        const title = f.shown.title !== '' ? `${f.shown.title} (${f.shown.path})` : f.shown.path
        const now = el_('div', 'h3p-current', format(lang, 'panel_current_map', { file: title }))
        now.id = 'h3p-current-map'
        el.append(now)
      }
      for (const key of ['maprotation', 'mapsizemin', 'mapsizemax', 'mapunderground'] as const) {
        const row = settingRow(lang, state.settings, key)
        if (row !== undefined) el.append(row)
      }
      const nextRow = el_('div', 'h3p-row')
      const next = el_('button', undefined, format(lang, 'action_mapnext'))
      next.id = 'h3p-mapnext'
      next.title = 'N'
      next.addEventListener('click', () => handlers.onNextMap())
      nextRow.append(next)
      el.append(nextRow)
    }

    el.append(el_('h3', undefined, format(lang, 'setting_viewmode')))
    for (const key of ['level', 'viewmode', 'viewx', 'viewy', 'viewinterval', 'viewreroll', 'scale', 'objects'] as const) {
      if (key === 'viewreroll') {
        if (state.settings.viewmode !== 'random') continue
        const row = el_('div', 'h3p-row')
        const button = el_('button', undefined, format(lang, 'action_viewreroll'))
        button.id = 'h3p-viewreroll'
        button.title = 'R'
        button.addEventListener('click', () => handlers.onNewPlace())
        row.append(button)
        el.append(row)
        continue
      }
      const row = settingRow(lang, state.settings, key)
      if (row !== undefined) el.append(row)
    }
    const langRow = el_('div', 'h3p-row')
    const langLabel = el_('label', undefined, format(lang, 'setting_language'))
    langLabel.htmlFor = 'h3p-language'
    const langSelect = el_('select')
    langSelect.id = 'h3p-language'
    for (const [value, key] of [['auto', 'language_auto'], ['en', 'language_en'], ['ru', 'language_ru']] as [LanguageChoice, StringKey][]) {
      const o = el_('option', undefined, format(lang, key))
      o.value = value
      langSelect.append(o)
    }
    langSelect.value = choice
    langSelect.addEventListener('change', () => handlers.onLanguage(langSelect.value as LanguageChoice))
    langRow.append(langLabel, langSelect)
    el.append(langRow)

    const help = el_('details')
    help.append(el_('summary', undefined, format(lang, 'panel_help')))
    for (const key of ['help_files', 'help_web', 'help_privacy'] as const) help.append(el_('p', undefined, format(lang, key)))
    el.append(help, el_('div', 'h3p-keys', format(lang, 'panel_keys')))
  }

  const panel: Panel = {
    element: el,
    update(state, choice) {
      last = { state, choice }
      // Rebuild only when something shown in the panel changed (keeps focus while dragging sliders).
      const folder = state.folder === null ? null : { name: state.folder.name, entries: state.folder.entries, shown: state.folder.shown?.path ?? null }
      const key = JSON.stringify([state.language, choice, state.slots, state.settings.viewmode, state.settings.mapsource, folder, state.phase === 'showing', ...(doc.activeElement instanceof HTMLInputElement && el.contains(doc.activeElement) ? [] : [state.settings])])
      if (key !== renderedKey) {
        renderedKey = key
        render(state, choice)
      }
      if (state.phase !== 'showing' && !pinnedHidden) el.classList.remove('h3p-hidden')
    },
    toggle() {
      pinnedHidden = !el.classList.contains('h3p-hidden')
      el.classList.toggle('h3p-hidden', pinnedHidden)
    },
    activity() {
      if (!pinnedHidden) el.classList.remove('h3p-hidden')
      scheduleHide()
    },
  }
  return panel
}
