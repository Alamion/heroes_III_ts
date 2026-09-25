// Typed parser errors (constitution VII): every failure names the file, byte offset, format,
// version and the structure being read.

export const FORMAT_ERROR_CODES = {
  TRUNCATED: 'TRUNCATED',
  BAD_MAGIC: 'BAD_MAGIC',
  UNSUPPORTED_VERSION: 'UNSUPPORTED_VERSION',
  UNSUPPORTED_OBJECT: 'UNSUPPORTED_OBJECT',
  INVALID_VALUE: 'INVALID_VALUE',
  DECOMPRESS_FAILED: 'DECOMPRESS_FAILED',
  TRAILING_DATA: 'TRAILING_DATA',
  NOT_FOUND: 'NOT_FOUND',
} as const

export type FormatErrorCode = (typeof FORMAT_ERROR_CODES)[keyof typeof FORMAT_ERROR_CODES]

export type FormatName = 'lod' | 'def' | 'pcx' | 'h3m' | 'text' | 'data' | 'pal' | 'zip'

export interface FormatErrorInit {
  code: FormatErrorCode
  file: string
  offset: number
  format: FormatName
  structure: string
  message: string
  version?: string
  cause?: unknown
}

export interface SerializedFormatError {
  name: 'FormatError'
  code: FormatErrorCode
  file: string
  offset: number
  format: FormatName
  structure: string
  message: string
  version?: string
}

export class FormatError extends Error {
  readonly code: FormatErrorCode
  readonly file: string
  readonly offset: number
  readonly format: FormatName
  readonly structure: string
  readonly version: string | undefined

  constructor(init: FormatErrorInit) {
    const where = `${init.file} @${init.offset} (${init.format}${init.version !== undefined ? ` ${init.version}` : ''}, ${init.structure})`
    super(`${init.message} — ${where}`, { cause: init.cause })
    this.name = 'FormatError'
    this.code = init.code
    this.file = init.file
    this.offset = init.offset
    this.format = init.format
    this.structure = init.structure
    this.version = init.version
  }

  /** The message without the location suffix. */
  get detail(): string {
    const idx = this.message.lastIndexOf(' — ')
    return idx >= 0 ? this.message.slice(0, idx) : this.message
  }

  toJSON(): SerializedFormatError {
    return {
      name: 'FormatError',
      code: this.code,
      file: this.file,
      offset: this.offset,
      format: this.format,
      structure: this.structure,
      message: this.detail,
      ...(this.version !== undefined ? { version: this.version } : {}),
    }
  }

  static fromJSON(json: SerializedFormatError): FormatError {
    return new FormatError({
      code: json.code,
      file: json.file,
      offset: json.offset,
      format: json.format,
      structure: json.structure,
      message: json.message,
      ...(json.version !== undefined ? { version: json.version } : {}),
    })
  }
}

export function isSerializedFormatError(value: unknown): value is SerializedFormatError {
  return typeof value === 'object' && value !== null && (value as { name?: unknown }).name === 'FormatError'
}
