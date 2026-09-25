// Messages between the engine (main thread) and the decode worker.

import type { Atlas } from '../core/render/atlas.ts'
import type { ObjectAtlas } from '../core/render/object-atlas.ts'
import type { RenderObject } from '../core/state/render-objects.ts'
import type { WorldState } from '../core/state/world.ts'
import type { SerializedFormatError } from '../core/util/errors.ts'

/**
 * One archive of an ordered set (spec 005 FR-004). The last member is the base archive of its
 * role, earlier members (the HotA archive) override it.
 */
export interface ArchiveFileMsg {
  file: File | Blob
  name: string
}

export type WorkerRequest =
  | { id: number; kind: 'openArchive'; files: ArchiveFileMsg[]; useCache: boolean }
  /**
   * `keep: 'add'` keeps the worlds decoded before (spec 007: the shown map and the one being
   * prepared); the default replaces them.
   */
  | { id: number; kind: 'openMap'; file: File | Blob; name: string; useCache: boolean; keep?: 'replace' | 'add' }
  /** Forgets a world the engine no longer needs objects for. */
  | { id: number; kind: 'dropMap'; identity: string }
  | { id: number; kind: 'openDataArchive'; files: ArchiveFileMsg[]; useCache: boolean }
  | {
      id: number
      kind: 'buildObjects'
      sprites: { files: ArchiveFileMsg[]; identity: string }
      data: { files: ArchiveFileMsg[]; identity: string }
      /** The worker uses the world it decoded for this identity. */
      mapIdentity: string
      seed: number
      /** Object atlas page size the renderer's GPU supports (spec 005). */
      pageSize: number
      useCache: boolean
    }

export interface WorkerDiagnostic {
  level: 'warn' | 'error'
  code: string
  message: string
  file?: string
  /** Machine-readable payload for checks (spec 005 FR-017: unresolved objects are counted). */
  details?: Record<string, unknown>
}

export type WorkerResponse =
  | { id: number; kind: 'archiveReady'; identity: string; atlas: Atlas; fromCache: boolean; warnings: WorkerDiagnostic[] }
  | { id: number; kind: 'mapReady'; identity: string; world: WorldState; fromCache: boolean; warnings: WorkerDiagnostic[] }
  | { id: number; kind: 'dataArchiveReady'; identity: string; warnings: WorkerDiagnostic[] }
  | { id: number; kind: 'mapDropped' }
  | { id: number; kind: 'objectsReady'; identity: string; objects: RenderObject[]; atlas: ObjectAtlas; flagColors: Uint8Array; fromCache: boolean; warnings: WorkerDiagnostic[] }
  | { id: number; kind: 'failed'; error: SerializedFormatError | WorkerDiagnostic }
