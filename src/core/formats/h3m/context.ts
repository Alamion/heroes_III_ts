import type { ByteReader } from '../../util/byte-reader.ts'
import type { H3mVersion } from './types.ts'

/** Reader plus version feature flags shared by all H3M section readers. */
export interface H3mContext {
  r: ByteReader
  version: H3mVersion
  /** Armageddon's Blade or later. */
  ab: boolean
  /** Shadow of Death. */
  sod: boolean
}

export function makeContext(r: ByteReader, version: H3mVersion): H3mContext {
  return { r, version, ab: version !== 'RoE', sod: version === 'SoD' }
}
