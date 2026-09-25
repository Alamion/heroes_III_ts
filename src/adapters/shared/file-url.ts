// Host file values → URLs, and reading user files (spec 004 research R4). Wallpaper Engine gives raw
// Windows paths, Lively a path relative to the wallpaper folder, KDE a file:// URL. Local files are
// read with XMLHttpRequest because fetch() does not support file: URLs in Chromium hosts.

const encodeSegments = (path: string): string =>
  path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')

/**
 * Wallpaper Engine file property value → file:// URL (null when the setting is empty).
 *
 * WE settings hold paths relative to the wallpaper folder (the CEF reads only inside it, 2026-09-19
 * session). They are resolved to an absolute `file:` URL here, so `readUserFile` reads them with XHR
 * `responseType = 'blob'` (keeps large archives out of the JS heap, 004 Measurements); a relative
 * value would otherwise go through `fetch`, which WE's CEF rejects for a directory with
 * `TypeError: Failed to fetch` and never answers for a directory over XHR either (2026-09-25) — the
 * map folder therefore falls back to a `.zip` on WE. The base is already percent-encoded by the
 * browser; the relative segments are encoded here so a `#` cannot become a fragment.
 */
export function weFileUrl(value: string | null | undefined, base?: string): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const v = value.trim()
  if (/^file:/i.test(v)) return v
  const slashed = v.replace(/\\/g, '/')
  // UNC path: \\server\share\x → file://server/share/x
  if (slashed.startsWith('//')) {
    const [host, ...rest] = slashed.slice(2).split('/')
    return `file://${host ?? ''}/${encodeSegments(rest.join('/'))}`
  }
  const drive = /^([A-Za-z]):\/(.*)$/.exec(slashed)
  if (drive !== null) return `file:///${drive[1]}:/${encodeSegments(drive[2] ?? '')}`
  // POSIX absolute path outside a browser (checks) is already rooted.
  if (slashed.startsWith('/')) return `file://${encodeSegments(slashed)}`
  // Relative to the wallpaper folder (the folder of the page). `base` is injectable for tests.
  const root = base ?? (typeof location !== 'undefined' ? locationFolder() : '')
  return `${root === '' ? 'file://' : root}/${encodeSegments(slashed)}`
}

/** The encoded file:// folder of the page (the wallpaper folder), without a trailing slash. */
function locationFolder(): string {
  // Location is not touched at module scope so the function stays testable without a DOM.
  const href = typeof location !== 'undefined' ? location.href : ''
  const cut = href.replace(/[?#].*$/, '').replace(/[^/]*$/, '')
  return cut.replace(/\/$/, '')
}

/** Lively folderDropdown value (`userfiles\name`) → URL relative to the page. */
export function livelyFileUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const slashed = value.trim().replace(/\\/g, '/').replace(/^\/+/, '')
  return encodeSegments(slashed)
}

/** KDE FileDialog value: already a file:// URL; plain absolute paths are converted. */
export function kdeFileUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string' || value.trim() === '') return null
  const v = value.trim()
  if (/^[a-z][a-z0-9+.-]*:/i.test(v)) return v
  return v.startsWith('/') ? `file://${encodeSegments(v)}` : encodeSegments(v)
}

/** Last path segment of a URL or path, decoded, for messages. */
export function displayName(urlOrPath: string): string {
  const last = urlOrPath.replace(/\\/g, '/').split(/[/?#]/).filter((s) => s !== '').pop() ?? urlOrPath
  try {
    return decodeURIComponent(last)
  } catch {
    return last
  }
}

export type ReadFailure = 'missing' | 'unreadable'

export class UserFileError extends Error {
  readonly reason: ReadFailure
  readonly url: string
  constructor(reason: ReadFailure, url: string, message: string) {
    super(message)
    this.name = 'UserFileError'
    this.reason = reason
    this.url = url
  }
}

/**
 * WE's CEF neither completes nor cancels a file: XHR that resolves outside the wallpaper folder
 * (2026-09-19 Windows session, Measurements): every read gets a timeout, so a host quirk degrades
 * to an error message instead of an endless "loading". 64 MB measured in 0.12 s locally, so 30 s
 * leaves headroom for slow disks.
 */
export const READ_TIMEOUT_MS = 30_000

const timeoutMessage = `reading timed out after ${Math.round(READ_TIMEOUT_MS / 1000)} s`

/** Minimal XMLHttpRequest surface, so the reader can be tested without a browser. */
export interface XhrLike {
  open(method: string, url: string): void
  responseType: string
  status: number
  response: unknown
  onload: (() => void) | null
  onerror: (() => void) | null
  abort?(): void
  send(): void
}

export interface ReadDeps {
  createXhr: () => XhrLike
  fetch: (url: string) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob> }>
}

/** Reads a user file into a Blob. `file:` URLs via XHR, everything else via fetch; both bounded by READ_TIMEOUT_MS. */
export function readUserFile(url: string, deps: ReadDeps): Promise<Blob> {
  if (!/^file:/i.test(url)) {
    return Promise.race([
      deps.fetch(url).then(
        async (res) => {
          if (res.status === 404) throw new UserFileError('missing', url, `not found (${res.status})`)
          if (!res.ok) throw new UserFileError('unreadable', url, `HTTP ${res.status}`)
          return res.blob()
        },
        (err: unknown) => {
          throw new UserFileError('unreadable', url, err instanceof Error ? err.message : String(err))
        },
      ),
      new Promise<never>((_, reject) => setTimeout(() => reject(new UserFileError('unreadable', url, timeoutMessage)), READ_TIMEOUT_MS)),
    ])
  }
  return new Promise((resolve, reject) => {
    const xhr = deps.createXhr()
    const timer = setTimeout(() => {
      try {
        xhr.abort?.()
      } catch {
        // The request is already gone; the rejection below is what matters.
      }
      reject(new UserFileError('unreadable', url, timeoutMessage))
    }, READ_TIMEOUT_MS)
    xhr.open('GET', url)
    // A blob response lets Chromium keep the file data out of the JS heap (no 50 MB ArrayBuffer copy).
    xhr.responseType = 'blob'
    xhr.onload = () => {
      clearTimeout(timer)
      const body = xhr.response
      const size = body instanceof Blob ? body.size : body instanceof ArrayBuffer ? body.byteLength : 0
      // file: requests report status 0 on success in Chromium; an absent file errors or is empty.
      if ((xhr.status === 0 || xhr.status === 200) && size > 0) {
        resolve(body instanceof Blob ? body : new Blob([body as ArrayBuffer]))
      } else if (xhr.status === 404 || size === 0) {
        reject(new UserFileError('missing', url, 'the file is missing or empty'))
      } else {
        reject(new UserFileError('unreadable', url, `status ${xhr.status}`))
      }
    }
    xhr.onerror = () => {
      clearTimeout(timer)
      reject(new UserFileError('missing', url, 'the file cannot be opened'))
    }
    try {
      xhr.send()
    } catch (err) {
      clearTimeout(timer)
      reject(new UserFileError('unreadable', url, err instanceof Error ? err.message : String(err)))
    }
  })
}

/** Browser dependencies for readUserFile. */
export function browserReadDeps(): ReadDeps {
  return { createXhr: () => new XMLHttpRequest() as unknown as XhrLike, fetch: (url) => fetch(url) }
}
