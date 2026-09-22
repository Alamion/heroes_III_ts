# Third-Party Notices

This project is MIT-licensed. It contains code or data layouts derived from the works below.
No game content (archives, sprites, maps, text tables, palettes, or anything extracted from
them) is part of this repository.

## homm3-parser

- Source: <https://github.com/srg-kostyrko/homm3-parser> (version 0.8.11, studied locally)
- License: MIT
- Used for: the structure of the H3M map format (section order, field layouts per version,
  object body layouts) was ported into hand-written readers. The readers were rewritten on a
  bounds-checked byte reader; no code was copied verbatim.
- Files: see "Ported files" below.

```text
MIT License

Copyright (c) 2018 Sergey Kostyrko

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

### Ported files

- `src/core/formats/h3m/**` — H3M readers
- `test/fixtures/synthetic/h3m.ts` — H3M writer (the inverse of the readers)
- `src/core/data/object-classes.ts` — object class to body layout mapping

## homm3tools

homm3-parser credits the homm3tools H3M format description (`h3m_description.english.txt`);
the same format knowledge underlies the H3M readers here.

## hota-lod-convert

- Source: <https://codeberg.org/DarkAtom/hota-lod-convert> (studied locally, 2026-09-22)
- License: MIT OR Apache-2.0 (MIT chosen here)
- Used for: the layout of the obfuscated HotA 1.8 LOD index (XOR key at header offset 12, the
  32-byte entry record, the compression byte values) and the rule that distinguishes an obfuscated
  archive from a plain one. Reimplemented on this project's bounds-checked byte reader; no code was
  copied verbatim. The FNV-1a-32 name hash is not in that source and was derived here by
  measurement. Its `data/hashes.txt` name dictionary is **not** redistributed: it is read from the
  local, git-ignored `context/` folder by the inspection CLI when present.
- Files: `src/core/formats/lod/lod.ts`, `src/core/formats/lod/name-hash.ts`

```text
MIT License

Copyright (c) 2026 DarkAtom

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## FreeHeroes

- Source: <https://github.com/mapron/FreeHeroes> (`src/Core/MapUtil/`, studied locally, 2026-09-22)
- License: MIT
- Used for: the shape of the H3M feature table per format and sub-version, and the HotA map layout
  for sub-versions 0–3 and 5. Sub-versions 9 and 10 are not covered there and were measured against
  the owner's own maps. Readers are hand-written here; no code was copied verbatim.
- Files: `src/core/formats/h3m/**`

```text
MIT License

Copyright (c) 2020 Smirnov Vladimir

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## MMArchiveCLI

- Source: <https://github.com/imahero1492/MMArchiveCLI> (studied locally, 2026-09-22)
- License: MIT
- Used for: the seed lists of HotA DEF rendering conventions from `defConfig.json` (shadows in
  palette indices 2/3, player-flag colour at index 255) and the object DEF name to class/subtype
  mapping in `objectsByID.json`. The committed tables were verified against the archive itself
  before use.
- Files: `src/core/data/hota-def-conventions.ts`

```text
MIT License

Copyright (c) 2025 imahero1492

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## h3m2json

- Source: <https://github.com/HeroWO-js/h3m2json> (`h3m-The-Corpus.txt`, studied locally, 2026-09-22)
- License: Unlicense (public domain)
- Used for: a prose field-by-field description of the H3M format with HotA annotations, used as a
  cross-check while deriving the `0x20` layout. Where it disagreed with the owner's map files (for
  example the day count of victory condition 12, which is a u32) the files won.

## VCMI HotA mod (configuration data)

- Source: <https://github.com/vcmi-mods/horn-of-the-abyss> (configuration only, studied locally,
  2026-09-22)
- License: CC BY-SA 4.0
- Used for: naming data — town sprite names per faction and fortification level, HotA terrain and
  object definitions — which informed hand-written typed tables in this repository. The data is not
  shipped in any build output or package.
- Files: `src/core/data/object-classes.ts`, `src/core/data/terrain.ts`, `src/core/data/heroes.ts`

## Studied only (no code copied)

- **h3lwp** (`heroes_iii_android`, no license): file format facts, palette rotation ranges,
  terrain draw order.
- **VCMI** (GPL): H3M layout details used to verify and correct field layouts, and the behaviour of
  the HotA event-system ("script") block, which was reimplemented here from that understanding.
- **vcmiextract** (GPL): the only complete description of the HotA D32/P32 truecolour formats. Those
  formats are out of scope for this project (they hold interface art only), so nothing was written
  from it.
- **HotA-editor** (no license): the `HDAT` container of `HotA.dat`, which turned out to hold editor
  text and descriptions rather than anything the map renderer needs.
