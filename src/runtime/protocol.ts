// Messages between the engine (main thread) and the decode worker.

import type { Atlas } from '../core/render/atlas.ts'
import type { WorldState } from '../core/state/world.ts'
import type { SerializedFormatError } from '../core/util/errors.ts'

export type WorkerRequest =
  | { id: number; kind: 'openArchive'; file: File | Blob; name: string; useCache: boolean }
  | { id: number; kind: 'openMap'; file: File | Blob; name: string; useCache: boolean }

export interface WorkerDiagnostic {
  level: 'warn' | 'error'
  code: string
  message: string
  file?: string
}

export type WorkerResponse =
  | { id: number; kind: 'archiveReady'; identity: string; atlas: Atlas; fromCache: boolean; warnings: WorkerDiagnostic[] }
  | { id: number; kind: 'mapReady'; identity: string; world: WorldState; fromCache: boolean; warnings: WorkerDiagnostic[] }
  | { id: number; kind: 'failed'; error: SerializedFormatError | WorkerDiagnostic }
