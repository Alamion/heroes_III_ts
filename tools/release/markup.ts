// A small Markdown subset rendered for each surface (spec 006 research R3): changelog sections and
// inline strings become GitHub Markdown, plain text (package readmes), Steam BBCode and KDE Store
// BBCode. Anything outside the subset is an error naming the line — never silently degraded — so a
// store text can be checked before it is pasted.
//
// Blocks: `### heading`, paragraphs, `-` bullets with one nested level (two-space or four-space
// indent). Inline: **bold**, *italic*, `code`, [text](url).

export type Profile = 'markdown' | 'text' | 'steam' | 'kde'

export class MarkupError extends Error {
  readonly code = 'MARKUP_UNSUPPORTED'
  readonly line: number
  constructor(line: number, message: string) {
    super(`line ${line}: ${message}`)
    this.name = 'MarkupError'
    this.line = line
  }
}

interface ListItem {
  text: string
  line: number
  children: { text: string; line: number }[]
}

export type Block = { kind: 'heading'; text: string; line: number } | { kind: 'para'; text: string; line: number } | { kind: 'list'; items: ListItem[] }

export function parseBlocks(source: string, firstLine = 1): Block[] {
  const blocks: Block[] = []
  let para: { text: string[]; line: number } | undefined
  let list: ListItem[] | undefined
  const flush = () => {
    if (para !== undefined) blocks.push({ kind: 'para', text: para.text.join(' '), line: para.line })
    if (list !== undefined) blocks.push({ kind: 'list', items: list })
    para = undefined
    list = undefined
  }
  source.split(/\r?\n/).forEach((raw, i) => {
    const line = firstLine + i
    if (raw.trim() === '') {
      flush()
      return
    }
    const bullet = /^( *)- (.*)$/.exec(raw)
    const trimmed = raw.trim()
    if (bullet === null) {
      if (/^#{1,2} /.test(trimmed)) throw new MarkupError(line, 'only "###" headings are allowed inside a section')
      if (/^#{4,} /.test(trimmed)) throw new MarkupError(line, 'headings deeper than "###" are not supported')
      if (/^\|/.test(trimmed)) throw new MarkupError(line, 'tables are not supported (the KDE Store has none)')
      if (/^```/.test(trimmed)) throw new MarkupError(line, 'code blocks are not supported; use `inline code`')
      if (/^>/.test(trimmed)) throw new MarkupError(line, 'quotes are not supported')
      if (/^\d+[.)] /.test(trimmed)) throw new MarkupError(line, 'numbered lists are not supported; use "-" bullets')
      if (/^[*+] /.test(trimmed)) throw new MarkupError(line, 'bullets must start with "-"')
      if (/^<\/?[a-z]/i.test(trimmed)) throw new MarkupError(line, 'HTML is not supported')
      if (/^(-{3,}|\*{3,}|_{3,})$/.test(trimmed)) throw new MarkupError(line, 'horizontal rules are not supported')
    }
    checkInline(trimmed, line)
    if (/^### /.test(trimmed) && bullet === null) {
      flush()
      blocks.push({ kind: 'heading', text: trimmed.slice(4).trim(), line })
      return
    }
    if (bullet !== null) {
      const indent = (bullet[1] as string).length
      const text = (bullet[2] as string).trim()
      if (para !== undefined) {
        blocks.push({ kind: 'para', text: para.text.join(' '), line: para.line })
        para = undefined
      }
      list ??= []
      if (indent === 0) list.push({ text, line, children: [] })
      else if (indent === 2 || indent === 4) {
        const parent = list[list.length - 1]
        if (parent === undefined) throw new MarkupError(line, 'a nested bullet needs a parent bullet')
        parent.children.push({ text, line })
      } else throw new MarkupError(line, 'only one nesting level (two or four spaces) is supported')
      return
    }
    if (list !== undefined) {
      // A continuation line of the last bullet.
      if (/^ {2,}\S/.test(raw)) {
        const last = list[list.length - 1] as ListItem
        const child = last.children[last.children.length - 1]
        if (child !== undefined && /^ {4,}/.test(raw)) child.text += ` ${trimmed}`
        else last.text += ` ${trimmed}`
        return
      }
      flush()
    }
    para ??= { text: [], line }
    para.text.push(trimmed)
  })
  flush()
  return blocks
}

function checkInline(text: string, line: number): void {
  if (/!\[/.test(text)) throw new MarkupError(line, 'images are not supported')
  if (/<[a-z/][^>]*>/i.test(text)) throw new MarkupError(line, 'HTML is not supported')
  if (/\[[^\]]*\]\[[^\]]*\]/.test(text)) throw new MarkupError(line, 'reference links are not supported')
  if (/(^|\s)_[^_]+_(\s|$)/.test(text) || /__/.test(text)) throw new MarkupError(line, 'use *italic* and **bold**, not underscores')
  const stripped = text.replace(/`[^`]*`/g, '').replace(/\*\*[^*]+\*\*/g, '').replace(/\*[^*\s][^*]*\*/g, '')
  if (/`/.test(stripped)) throw new MarkupError(line, 'unbalanced `')
  if (/\*/.test(stripped)) throw new MarkupError(line, 'unbalanced * or **')
}

/** Inline spans for one profile. */
export function renderInline(text: string, profile: Profile): string {
  if (profile === 'markdown') return text
  const out: string[] = []
  const re = /`([^`]*)`|\*\*([^*]+)\*\*|\*([^*\s][^*]*)\*|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  for (const m of text.matchAll(re)) {
    out.push(text.slice(last, m.index))
    last = (m.index as number) + m[0].length
    const [, code, bold, italic, label, url] = m
    if (code !== undefined) out.push(profile === 'text' ? code : `[code]${code}[/code]`)
    else if (bold !== undefined) out.push(profile === 'text' ? renderInline(bold, profile) : `[b]${renderInline(bold, profile)}[/b]`)
    else if (italic !== undefined) out.push(profile === 'text' ? renderInline(italic, profile) : `[i]${renderInline(italic, profile)}[/i]`)
    else if (profile === 'text') out.push(`${label} (${url})`)
    else out.push(`[url=${url}]${label}[/url]`)
  }
  out.push(text.slice(last))
  return out.join('')
}

export function renderBlocks(blocks: readonly Block[], profile: Profile): string {
  const parts = blocks.map((b) => {
    if (b.kind === 'heading') {
      const t = renderInline(b.text, profile)
      if (profile === 'markdown') return `### ${t}`
      if (profile === 'text') return t
      return profile === 'steam' ? `[h2]${t}[/h2]` : `[b]${t}[/b]`
    }
    if (b.kind === 'para') return renderInline(b.text, profile)
    if (profile === 'markdown' || profile === 'text') {
      return b.items.map((it) => [`- ${renderInline(it.text, profile)}`, ...it.children.map((c) => `  - ${renderInline(c.text, profile)}`)].join('\n')).join('\n')
    }
    const item = (it: ListItem) => `[*]${renderInline(it.text, profile)}${it.children.length > 0 ? `\n[list]\n${it.children.map((c) => `[*]${renderInline(c.text, profile)}`).join('\n')}\n[/list]` : ''}`
    return `[list]\n${b.items.map(item).join('\n')}\n[/list]`
  })
  return parts.join('\n\n')
}

export function renderMarkup(source: string, profile: Profile, firstLine = 1): string {
  return renderBlocks(parseBlocks(source, firstLine), profile)
}

/** The changelog rule for `yarn release check` (spec 006 T031); `line` is the section heading's line. */
export function validateChangelogMarkup(body: string, line: number): void {
  // The body starts two lines below the heading (heading, blank line).
  parseBlocks(body, line + 2)
}

/** BBCode tags each store accepts (research R3; KDE: no tables, headings as bold). */
export const ALLOWED_TAGS: Record<'steam' | 'kde', ReadonlySet<string>> = {
  steam: new Set(['h1', 'h2', 'h3', 'b', 'i', 'u', 'url', 'list', '*', 'code', 'hr']),
  kde: new Set(['b', 'i', 'u', 'url', 'list', '*', 'code']),
}

/** Problems of a BBCode text for a store: unknown tags and unbalanced ones. */
export function checkBbcode(text: string, store: 'steam' | 'kde'): string[] {
  const problems: string[] = []
  const stack: string[] = []
  for (const m of text.matchAll(/\[(\/?)([a-z0-9*]+)(=[^\]]*)?\]/gi)) {
    const closing = m[1] === '/'
    const tag = (m[2] as string).toLowerCase()
    if (!ALLOWED_TAGS[store].has(tag)) {
      problems.push(`tag [${closing ? '/' : ''}${tag}] is not supported on the ${store === 'steam' ? 'Steam Workshop' : 'KDE Store'}`)
      continue
    }
    if (tag === '*') continue
    if (!closing) stack.push(tag)
    else if (stack.pop() !== tag) problems.push(`[/${tag}] does not close the open tag`)
  }
  if (stack.length > 0) problems.push(`unclosed tags: ${stack.map((t) => `[${t}]`).join(' ')}`)
  return problems
}
