// Quiet overlay for all hosts (spec 004 FR-006): a centred placeholder while files are missing and
// small corner messages that fade after 10 s. Styles use a constructed stylesheet (no inline
// <style> or style attributes: the package CSP forbids them).

import { messageText, SLOT_KIND_KEYS } from './messages.ts'
import type { FileSlot, UserMessage } from './messages.ts'
import { format } from './strings.ts'
import type { Language } from './strings.ts'

export const MESSAGE_FADE_MS = 10_000

const CSS = `
.h3o-root { position: fixed; inset: 0; pointer-events: none; font: 14px/1.45 system-ui, sans-serif; color: #e8dcc0; }
.h3o-placeholder { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); max-width: min(80vw, 46em); text-align: center; background: rgba(12, 10, 8, 0.72); padding: 18px 24px; border-radius: 10px; border: 1px solid rgba(232, 220, 192, 0.18); }
.h3o-placeholder h1 { font-size: 20px; margin: 0 0 8px; font-weight: 600; }
.h3o-placeholder p { margin: 6px 0; }
.h3o-placeholder .h3o-hint { opacity: 0.7; font-size: 12px; }
.h3o-messages { position: absolute; right: 12px; bottom: 12px; display: flex; flex-direction: column; gap: 6px; align-items: flex-end; max-width: min(90vw, 40em); }
.h3o-message { background: rgba(12, 10, 8, 0.78); padding: 6px 10px; border-radius: 6px; border-left: 3px solid #b99a55; transition: opacity 0.6s; }
.h3o-message.h3o-warn { border-left-color: #d9a032; }
.h3o-message.h3o-error { border-left-color: #d9543a; }
.h3o-message.h3o-fading { opacity: 0; }
.h3o-hidden { display: none; }
`

export interface OverlayState {
  /** Missing slots while the map cannot be shown; null when the map is shown. */
  missing: FileSlot[] | null
  /** Message shown in the placeholder while loading (the file name), or null. */
  loading: string | null
  messages: readonly { id: number; message: UserMessage; sticky: boolean }[]
}

export interface Overlay {
  render(state: OverlayState, lang: Language): void
  /** Text currently visible (checks). */
  texts(): string[]
  dispose(): void
}

export function createOverlay(root: HTMLElement, timers: { set: (cb: () => void, ms: number) => number; clear: (h: number) => void } = { set: (cb, ms) => window.setTimeout(cb, ms), clear: (h) => window.clearTimeout(h) }): Overlay {
  const doc = root.ownerDocument
  try {
    const sheet = new CSSStyleSheet()
    sheet.replaceSync(CSS)
    doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]
  } catch {
    // Very old hosts: the overlay still works unstyled.
  }
  const box = doc.createElement('div')
  box.className = 'h3o-root'
  box.setAttribute('aria-live', 'polite')
  const placeholder = doc.createElement('div')
  placeholder.className = 'h3o-placeholder h3o-hidden'
  const list = doc.createElement('div')
  list.className = 'h3o-messages'
  box.append(placeholder, list)
  root.append(box)

  const shown = new Map<number, { el: HTMLElement; timer: number | undefined }>()

  const render = (state: OverlayState, lang: Language): void => {
    box.lang = lang
    placeholder.replaceChildren()
    if (state.missing !== null || state.loading !== null) {
      const h = doc.createElement('h1')
      h.textContent = format(lang, 'placeholder_title')
      placeholder.append(h)
      if (state.loading !== null) {
        const p = doc.createElement('p')
        p.textContent = format(lang, 'msg_LOADING', { file: state.loading })
        placeholder.append(p)
      } else if (state.missing !== null && state.missing.length > 0) {
        const p = doc.createElement('p')
        p.textContent = format(lang, 'placeholder_missing', { files: state.missing.map((s) => format(lang, SLOT_KIND_KEYS[s])).join(', ') })
        placeholder.append(p)
      }
      const hint = doc.createElement('p')
      hint.className = 'h3o-hint'
      hint.textContent = format(lang, 'placeholder_hint')
      placeholder.append(hint)
      placeholder.classList.remove('h3o-hidden')
    } else {
      placeholder.classList.add('h3o-hidden')
    }

    const ids = new Set(state.messages.map((m) => m.id))
    for (const [id, entry] of shown) {
      if (!ids.has(id)) {
        if (entry.timer !== undefined) timers.clear(entry.timer)
        entry.el.remove()
        shown.delete(id)
      }
    }
    for (const { id, message, sticky } of state.messages) {
      let entry = shown.get(id)
      if (entry === undefined) {
        const el = doc.createElement('div')
        el.className = `h3o-message h3o-${message.level}`
        list.append(el)
        entry = { el, timer: undefined }
        shown.set(id, entry)
        if (!sticky) {
          const e = entry
          e.timer = timers.set(() => {
            e.el.classList.add('h3o-fading')
            e.timer = timers.set(() => {
              e.el.remove()
              shown.delete(id)
            }, 700)
          }, MESSAGE_FADE_MS)
        }
      }
      entry.el.textContent = messageText(lang, message)
    }
  }

  return {
    render,
    texts: () => [placeholder, ...list.children]
      .filter((el) => !el.classList.contains('h3o-hidden') && !el.classList.contains('h3o-fading'))
      .map((el) => el.textContent ?? '')
      .filter((t) => t !== ''),
    dispose: () => {
      for (const e of shown.values()) if (e.timer !== undefined) timers.clear(e.timer)
      box.remove()
    },
  }
}
