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
