import type { ByteReader } from '../../util/byte-reader.ts'
import { featuresFor } from './features.ts'
import type { H3mFeatures } from './features.ts'
import type { H3mVersion } from './types.ts'

/** Reader plus version feature flags shared by all H3M section readers. */
export interface H3mContext {
  r: ByteReader
  version: H3mVersion
  /** Armageddon's Blade or later. */
  ab: boolean
  /** Shadow of Death or later (HotA is built on SoD, so this is true for HotA too). */
  sod: boolean
  /** Everything a version may add on top; see features.ts. */
  f: H3mFeatures
}

export function makeContext(r: ByteReader, version: H3mVersion, subVersion: number | null = null): H3mContext {
  const f = featuresFor(version, subVersion)
  return { r, version, ab: f.ab, sod: f.sod, f }
}
