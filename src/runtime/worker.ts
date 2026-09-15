// Decode worker (constitution IV): archive decompression, sprite decoding, atlas packing and map
// parsing run here, off the main thread.

import { FormatError } from '../core/util/errors.ts'
import { openCache } from './cache.ts'
import { decodeArchive, decodeMap } from './decode.ts'
import type { WorkerRequest, WorkerResponse } from './protocol.ts'

const scope = globalThis as unknown as DedicatedWorkerGlobalScope
const caches = new Map<boolean, ReturnType<typeof openCache>>()

function cacheFor(enabled: boolean) {
  let c = caches.get(enabled)
  if (c === undefined) {
    c = openCache(enabled)
    caches.set(enabled, c)
  }
  return c
}

function post(msg: WorkerResponse, transfer: Transferable[] = []): void {
  scope.postMessage(msg, transfer)
}

scope.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const req = event.data
  try {
    if (req.kind === 'openArchive') {
      const r = await decodeArchive(req.file, req.name, cacheFor(req.useCache))
      // Copies are transferred; the cache keeps its own structured clone.
      const indices = r.atlas.indices.slice()
      const palettes = r.atlas.palettes.slice()
      post({ id: req.id, kind: 'archiveReady', identity: r.identity, atlas: { layout: r.atlas.layout, indices, palettes }, fromCache: r.fromCache, warnings: r.warnings }, [indices.buffer, palettes.buffer])
    } else {
      const r = await decodeMap(req.file, req.name, cacheFor(req.useCache))
      post({ id: req.id, kind: 'mapReady', identity: r.identity, world: r.world, fromCache: r.fromCache, warnings: r.warnings })
    }
  } catch (err) {
    const error = err instanceof FormatError ? err.toJSON() : { level: 'error' as const, code: 'INTERNAL', message: err instanceof Error ? err.message : String(err), file: req.name }
    post({ id: req.id, kind: 'failed', error })
  }
}
