import { FORMAT_ERROR_CODES, FormatError } from './errors.ts'
import type { FormatName } from './errors.ts'
import { decompressionStream, pipeBytes } from './web-globals.ts'

export interface InflateContext {
  file: string
  format: FormatName
  offset: number
  structure: string
  version?: string
}

/**
 * Decompresses zlib ('deflate', LOD entries) or gzip (H3M) data with the platform's
 * DecompressionStream. When `expectedSize` is given the output length must match exactly.
 */
export async function inflate(
  bytes: Uint8Array,
  format: 'deflate' | 'gzip',
  ctx: InflateContext,
  expectedSize?: number,
): Promise<Uint8Array> {
  let out: Uint8Array
  try {
    out = await pipeBytes(bytes, decompressionStream(format))
  } catch (err) {
    throw new FormatError({
      code: FORMAT_ERROR_CODES.DECOMPRESS_FAILED,
      file: ctx.file,
      offset: ctx.offset,
      format: ctx.format,
      structure: ctx.structure,
      message: `${format} decompression failed: ${(err as Error).message}`,
      ...(ctx.version !== undefined ? { version: ctx.version } : {}),
      cause: err,
    })
  }
  if (expectedSize !== undefined && out.byteLength !== expectedSize) {
    throw new FormatError({
      code: FORMAT_ERROR_CODES.DECOMPRESS_FAILED,
      file: ctx.file,
      offset: ctx.offset,
      format: ctx.format,
      structure: ctx.structure,
      message: `decompressed ${out.byteLength} bytes, expected ${expectedSize}`,
      ...(ctx.version !== undefined ? { version: ctx.version } : {}),
    })
  }
  return out
}

export function isGzip(bytes: Uint8Array): boolean {
  return bytes.byteLength >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b
}
