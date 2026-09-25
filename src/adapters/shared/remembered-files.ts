// Remembered user files for the browser version (spec 004 FR-012, data-model "RememberedFile"):
// copies of the user's own files in a separate IndexedDB database, so a decode-cache schema change
// never forgets them. Every failure degrades to "nothing remembered".

import { log } from '../../core/util/log.ts'
import type { RememberedFile, RememberedFiles } from './controller.ts'
import type { FileSlot } from './messages.ts'

export const FILES_DB = 'h3dynam-files'
const STORE = 'userFiles'
const SLOTS: readonly FileSlot[] = ['spriteArchive', 'dataArchive', 'map']

interface Stored {
  slot: FileSlot
  name: string
  blob: Blob
  savedAt: number
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error ?? new Error('IndexedDB request failed'))
  })
}

export function indexedDbRememberedFiles(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): RememberedFiles {
  let db: Promise<IDBDatabase | undefined> | undefined
  const open = (): Promise<IDBDatabase | undefined> => {
    db ??= new Promise((resolve) => {
      if (factory === undefined) {
        resolve(undefined)
        return
      }
      try {
        const req = factory.open(FILES_DB, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => {
          log.warn('remembered files unavailable', String(req.error))
          resolve(undefined)
        }
      } catch (err) {
        log.warn('remembered files unavailable', String(err))
        resolve(undefined)
      }
    })
    return db
  }
  return {
    async load() {
      const d = await open()
      if (d === undefined) return []
      try {
        const store = d.transaction(STORE, 'readonly').objectStore(STORE)
        const found = await Promise.all(SLOTS.map((slot) => request(store.get(slot) as IDBRequest<Stored | undefined>)))
        return found.filter((f): f is Stored => f !== undefined && f.blob instanceof Blob).map(({ slot, name, blob }): RememberedFile => ({ slot, name, blob }))
      } catch (err) {
        log.warn('reading remembered files failed', String(err))
        return []
      }
    },
    async save(file) {
      const d = await open()
      if (d === undefined) return
      const value: Stored = { slot: file.slot, name: file.name, blob: file.blob, savedAt: Date.now() }
      await request(d.transaction(STORE, 'readwrite').objectStore(STORE).put(value, file.slot))
    },
    async clear() {
      const d = await open()
      if (d === undefined) return
      await request(d.transaction(STORE, 'readwrite').objectStore(STORE).clear())
    },
  }
}

/** Limits of a remembered map folder (spec 007 research R9); above them it lasts for the visit only. */
export const REMEMBERED_FOLDER_LIMITS = { maxEntries: 5000, maxBytes: 256 * 1024 * 1024 } as const
const FOLDER_KEY = 'folder'
const FOLDER_PREFIX = 'folder:'

export interface RememberedFolderFiles {
  name: string
  files: { path: string; blob: Blob }[]
}

/** The browser's remembered map folder (spec 007 FR-019), next to the remembered files. */
export interface RememberedFolder {
  load(): Promise<RememberedFolderFiles | null>
  /** Replaces the remembered folder; false when it is over the limits or storage fails. */
  save(folder: RememberedFolderFiles): Promise<boolean>
  clear(): Promise<void>
}

/**
 * Stored in the same database and store as the remembered files, under `folder` (name, count) and
 * `folder:<path>` (one map each), so "Forget files" clears it with them.
 */
export function indexedDbRememberedFolder(factory: IDBFactory | undefined = typeof indexedDB === 'undefined' ? undefined : indexedDB): RememberedFolder {
  let db: Promise<IDBDatabase | undefined> | undefined
  const open = (): Promise<IDBDatabase | undefined> => {
    db ??= new Promise((resolve) => {
      if (factory === undefined) {
        resolve(undefined)
        return
      }
      try {
        const req = factory.open(FILES_DB, 1)
        req.onupgradeneeded = () => req.result.createObjectStore(STORE)
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => {
          log.warn('remembered folder unavailable', String(req.error))
          resolve(undefined)
        }
      } catch (err) {
        log.warn('remembered folder unavailable', String(err))
        resolve(undefined)
      }
    })
    return db
  }
  const folderKeys = async (store: IDBObjectStore): Promise<string[]> =>
    ((await request(store.getAllKeys())) as IDBValidKey[]).filter((k): k is string => typeof k === 'string' && (k === FOLDER_KEY || k.startsWith(FOLDER_PREFIX)))
  return {
    async load() {
      const d = await open()
      if (d === undefined) return null
      try {
        const store = d.transaction(STORE, 'readonly').objectStore(STORE)
        const meta = (await request(store.get(FOLDER_KEY))) as { name: string } | undefined
        if (meta === undefined) return null
        const files: { path: string; blob: Blob }[] = []
        for (const key of await folderKeys(store)) {
          if (key === FOLDER_KEY) continue
          const v = (await request(store.get(key))) as { path: string; blob: Blob } | undefined
          if (v !== undefined && v.blob instanceof Blob) files.push({ path: v.path, blob: v.blob })
        }
        return { name: meta.name, files }
      } catch (err) {
        log.warn('reading the remembered folder failed', String(err))
        return null
      }
    },
    async save(folder) {
      const bytes = folder.files.reduce((n, f) => n + f.blob.size, 0)
      if (folder.files.length > REMEMBERED_FOLDER_LIMITS.maxEntries || bytes > REMEMBERED_FOLDER_LIMITS.maxBytes) {
        log.warn(`map folder ${folder.name} is not remembered: ${folder.files.length} maps, ${Math.round(bytes / 1048576)} MB (limits ${REMEMBERED_FOLDER_LIMITS.maxEntries}, ${REMEMBERED_FOLDER_LIMITS.maxBytes / 1048576} MB)`)
        return false
      }
      const d = await open()
      if (d === undefined) return false
      try {
        const tx = d.transaction(STORE, 'readwrite')
        const store = tx.objectStore(STORE)
        for (const key of await folderKeys(store)) await request(store.delete(key))
        for (const f of folder.files) await request(store.put({ path: f.path, blob: f.blob }, `${FOLDER_PREFIX}${f.path}`))
        await request(store.put({ name: folder.name, count: folder.files.length, savedAt: Date.now() }, FOLDER_KEY))
        return true
      } catch (err) {
        log.warn(`could not remember map folder ${folder.name}`, String(err))
        return false
      }
    },
    async clear() {
      const d = await open()
      if (d === undefined) return
      try {
        const store = d.transaction(STORE, 'readwrite').objectStore(STORE)
        for (const key of await folderKeys(store)) await request(store.delete(key))
      } catch (err) {
        log.warn('could not forget the map folder', String(err))
      }
    },
  }
}
