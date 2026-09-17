// Host file values → URLs, and reading user files (spec 004 research R4). Wallpaper Engine gives raw
// Windows paths, Lively a path relative to the wallpaper folder, KDE a file:// URL. Local files are
// read with XMLHttpRequest because fetch() does not support file: URLs in Chromium hosts.

const encodeSegments = (path: string): string =>
  path
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/')

/** Wallpaper Engine file property value → file:// URL (null when the setting is empty). */
export function weFileUrl(value: string | null | undefined): string | null {
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
  // POSIX absolute path (Wallpaper Engine on Linux via Proton, or checks).
  if (slashed.startsWith('/')) return `file://${encodeSegments(slashed)}`
  return encodeSegments(slashed)
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

/** Minimal XMLHttpRequest surface, so the reader can be tested without a browser. */
export interface XhrLike {
  open(method: string, url: string): void
  responseType: string
  status: number
  response: unknown
  onload: (() => void) | null
  onerror: (() => void) | null
  send(): void
}

export interface ReadDeps {
  createXhr: () => XhrLike
  fetch: (url: string) => Promise<{ ok: boolean; status: number; blob(): Promise<Blob> }>
}

/** Reads a user file into a Blob. `file:` URLs via XHR, everything else via fetch. */
export function readUserFile(url: string, deps: ReadDeps): Promise<Blob> {
  if (!/^file:/i.test(url)) {
    return deps.fetch(url).then(
      async (res) => {
        if (res.status === 404) throw new UserFileError('missing', url, `not found (${res.status})`)
        if (!res.ok) throw new UserFileError('unreadable', url, `HTTP ${res.status}`)
        return res.blob()
      },
      (err: unknown) => {
        throw new UserFileError('unreadable', url, err instanceof Error ? err.message : String(err))
      },
    )
  }
  return new Promise((resolve, reject) => {
    const xhr = deps.createXhr()
    xhr.open('GET', url)
    // A blob response lets Chromium keep the file data out of the JS heap (no 50 MB ArrayBuffer copy).
    xhr.responseType = 'blob'
    xhr.onload = () => {
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
    xhr.onerror = () => reject(new UserFileError('missing', url, 'the file cannot be opened'))
    try {
      xhr.send()
    } catch (err) {
      reject(new UserFileError('unreadable', url, err instanceof Error ? err.message : String(err)))
    }
  })
}

/** Browser dependencies for readUserFile. */
export function browserReadDeps(): ReadDeps {
  return { createXhr: () => new XMLHttpRequest() as unknown as XhrLike, fetch: (url) => fetch(url) }
}
