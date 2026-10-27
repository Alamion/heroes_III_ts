// Single-byte code pages decoded with our own tables instead of TextDecoder. Chromium hands every
// legacy encoding except windows-1252 to ICU, and Qt WebEngine 6.11.2 on Fedora 44 (system ICU 77)
// hangs the whole renderer on `new TextDecoder('windows-1251')`: main thread and workers stop, and
// the page is killed about a minute later (KDE session 2026-10-27). The tables are the WHATWG
// Encoding Standard's; test/core/util.test.ts compares them with Node's TextDecoder byte by byte.

export type SingleByteEncoding = 'windows-1251' | 'ibm866'

/** Characters of bytes 0x80–0xFF; bytes below 0x80 are ASCII in both code pages. */
const HIGH_HALF: Record<SingleByteEncoding, string> = {
  'windows-1251':
    'ЂЃ‚ѓ„…†‡€‰Љ‹ЊЌЋЏ' +
    'ђ‘’“”•–—\u0098™љ›њќћџ' +
    ' ЎўЈ¤Ґ¦§Ё©Є«¬­®Ї' +
    '°±Ііґµ¶·ё№є»јЅѕї' +
    'АБВГДЕЖЗИЙКЛМНОП' +
    'РСТУФХЦЧШЩЪЫЬЭЮЯ' +
    'абвгдежзийклмноп' +
    'рстуфхцчшщъыьэюя',
  ibm866:
    'АБВГДЕЖЗИЙКЛМНОП' +
    'РСТУФХЦЧШЩЪЫЬЭЮЯ' +
    'абвгдежзийклмноп' +
    '░▒▓│┤╡╢╖╕╣║╗╝╜╛┐' +
    '└┴┬├─┼╞╟╚╔╩╦╠═╬╧' +
    '╨╤╥╙╘╒╓╫╪┘┌█▄▌▐▀' +
    'рстуфхцчшщъыьэюя' +
    'ЁёЄєЇїЎў°∙·√№¤■ ',
}

/** Decodes bytes of a single-byte code page; every byte maps to exactly one character. */
export function decodeSingleByte(bytes: Uint8Array, encoding: SingleByteEncoding): string {
  const high = HIGH_HALF[encoding]
  let out = ''
  for (const b of bytes) out += b < 0x80 ? String.fromCharCode(b) : high.charAt(b - 0x80)
  return out
}
