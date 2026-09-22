// Decode worker (constitution IV): archive decompression, sprite decoding, atlas packing and map
// parsing run here, off the main thread.

import { FormatError } from '../core/util/errors.ts'
import { openCache } from './cache.ts'
import { checkDataArchive, decodeArchive, decodeMap, decodeObjects } from './decode.ts'
import type { WorldState } from '../core/state/world.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const caches = new Map<boolean, ReturnType<typeof openCache>>()
/** Worlds decoded here, by identity (the engine asks for objects of the latest map). */
const worlds = new Map<string, WorldState>()

function cacheFor(enabled: boolean) {
  let c = caches.get(enabled)
  if (c === undefined) {
    c = openCache(enabled)
    caches.set(enabled, c)
  }
  return c
}

interface LockManagerLike {
  request<T>(name: string, callback: () => Promise<T>): Promise<T>
}

/**
 * Runs a decode under a Web Lock shared by every page of this origin (spec 004 research R13): two
 * wallpaper views (screens, tabs) that start together decode once; the second finds the result in
 * the cache, which each decode step checks first. Without Web Locks the decode runs unlocked.
 */
function withDecodeLock<T>(key: string, work: () => Promise<T>): Promise<T> {
  const locks = (scope.navigator as { locks?: LockManagerLike } | undefined)?.locks
  if (locks === undefined) return work()
  return locks.request(`h3dynam:decode:${key}`, work)
}

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer)
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    if (req.kind === 'openArchive') {
      const lockKey = req.files.map((f) => `${f.name}:${f.file.size}`).join('|')
      const r = await withDecodeLock(`archive:${lockKey}`, () => decodeArchive(req.files, cacheFor(req.useCache)))
      // Copies are transferred; the cache keeps its own structured clone.
      const indices = r.atlas.indices.slice()
      const palettes = r.atlas.palettes.slice()
      post({ id: req.id, kind: 'archiveReady', identity: r.identity, atlas: { layout: r.atlas.layout, indices, palettes }, fromCache: r.fromCache, warnings: r.warnings }, [indices.buffer, palettes.buffer])
    } else if (req.kind === 'openMap') {
      const r = await withDecodeLock(`map:${req.file.size}:${req.name}`, () => decodeMap(req.file, req.name, cacheFor(req.useCache)))
      worlds.clear()
      worlds.set(r.identity, r.world)
      post({ id: req.id, kind: 'mapReady', identity: r.identity, world: r.world, fromCache: r.fromCache, warnings: r.warnings })
    } else if (req.kind === 'openDataArchive') {
      const r = await checkDataArchive(req.files)
      post({ id: req.id, kind: 'dataArchiveReady', identity: r.identity, warnings: r.warnings })
    } else {
      const world = worlds.get(req.mapIdentity)
      if (world === undefined) throw new Error(`map ${req.mapIdentity} is not loaded in the worker`)
      const r = await withDecodeLock(`objects:${req.sprites.identity}:${req.data.identity}:${req.mapIdentity}:${req.seed}`, () =>
        decodeObjects(req.sprites, req.data, { world, identity: req.mapIdentity }, req.seed, cacheFor(req.useCache)),
      )
      // The cache stored its own structured clone (or this is a fresh clone read from it), so the
      // buffers can be transferred without copying 16 MB of pages.
      const pages = r.atlas.pages
      const palettes = r.atlas.palettes
      post(
        { id: req.id, kind: 'objectsReady', identity: r.identity, objects: r.objects, atlas: { layout: r.atlas.layout, pages, palettes }, flagColors: r.flagColors, fromCache: r.fromCache, warnings: r.warnings },
        [...pages.map((p) => p.buffer), palettes.buffer],
      )
    }
  } catch (err) {
    const lastName = (files: readonly { name: string }[]): string => files[files.length - 1]?.name ?? 'archive'
    const where = 'name' in req ? req.name : 'files' in req ? lastName(req.files) : lastName(req.data.files)
    const error = err instanceof FormatError ? err.toJSON() : { level: 'error' as const, code: 'INTERNAL', message: err instanceof Error ? err.message : String(err), file: where }
    post({ id: req.id, kind: 'failed', error })
  }
}
