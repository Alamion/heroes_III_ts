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

## Studied only (no code copied)

- **h3lwp** (`heroes_iii_android`, no license): file format facts, palette rotation ranges,
  terrain draw order.
- **VCMI** (GPL): H3M layout details used to verify and correct field layouts.
