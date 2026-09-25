// The only web platform globals core code may use. They exist in every target Chromium host and
// in Node >= 18. Accessed through typed lookups on globalThis so the core tsconfig can keep DOM
// and Node types out (constitution V) without ambient declarations that would clash with them.

export interface TextDecoderLike {
  decode(input: Uint8Array): string
}

interface TextDecoderCtor {
  new (label: string, options?: { fatal?: boolean }): TextDecoderLike
}

export interface TransformStreamLike {
  readonly readable: unknown
  readonly writable: unknown
}

interface DecompressionStreamCtor {
  new (format: 'deflate' | 'gzip' | 'deflate-raw'): TransformStreamLike
}

interface ResponseLike {
  arrayBuffer(): Promise<ArrayBuffer>
  readonly body: { pipeThrough(stream: TransformStreamLike): unknown } | null
}

interface ResponseCtor {
  new (body: unknown): ResponseLike
}

interface BlobCtor {
  new (parts: Uint8Array[]): { stream(): unknown }
}

interface WebGlobals {
  TextDecoder: TextDecoderCtor
  DecompressionStream: DecompressionStreamCtor
  Response: ResponseCtor
  Blob: BlobCtor
}

function globals(): WebGlobals {
  return globalThis as unknown as WebGlobals
}

export function textDecoder(label: string): TextDecoderLike {
  return new (globals().TextDecoder)(label)
}

export function decompressionStream(format: 'deflate' | 'gzip' | 'deflate-raw'): TransformStreamLike {
  return new (globals().DecompressionStream)(format)
}

/** Pipes bytes through a transform stream and collects the output. */
export async function pipeBytes(bytes: Uint8Array, stream: TransformStreamLike): Promise<Uint8Array> {
  const g = globals()
  const blobStream = new g.Blob([bytes]).stream()
  const piped = (blobStream as { pipeThrough(s: TransformStreamLike): unknown }).pipeThrough(stream)
  const buffer = await new g.Response(piped).arrayBuffer()
  return new Uint8Array(buffer)
}
