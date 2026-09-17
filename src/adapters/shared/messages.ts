// User messages (spec 004 data-model "UserMessage"): codes, levels and their localized text.

import { format } from './strings.ts'
import type { Language, StringKey } from './strings.ts'

export type FileSlot = 'spriteArchive' | 'dataArchive' | 'map'

export type MessageCode =
  | 'LOADING'
  | 'FILE_MISSING'
  | 'FILE_UNREADABLE'
  | 'WRONG_KIND'
  | 'UNKNOWN_FILE'
  | 'UNSUPPORTED_MAP'
  | 'CORRUPT_FILE'
  | 'DATA_ARCHIVE_MISSING'
  | 'WEBGL_UNAVAILABLE'
  | 'CONTEXT_LOST'
  | 'CACHE_UNAVAILABLE'

export interface UserMessage {
  code: MessageCode
  level: 'info' | 'warn' | 'error'
  file?: string
  detail?: string
  /** Slot kinds for WRONG_KIND. */
  expected?: FileSlot
  found?: FileSlot | 'unknown'
  /** Map format name for UNSUPPORTED_MAP. */
  format?: string
}

export const SLOT_KIND_KEYS: Record<FileSlot | 'unknown', StringKey> = {
  spriteArchive: 'kind_spriteArchive',
  dataArchive: 'kind_dataArchive',
  map: 'kind_map',
  unknown: 'kind_unknown',
}

export function messageText(lang: Language, m: UserMessage): string {
  const kind = (k: FileSlot | 'unknown' | undefined) => (k === undefined ? '' : format(lang, SLOT_KIND_KEYS[k]))
  return format(lang, `msg_${m.code}` as StringKey, {
    file: m.file ?? '',
    detail: m.detail ?? '',
    expected: kind(m.expected),
    found: kind(m.found),
    format: m.format ?? '',
  })
}
