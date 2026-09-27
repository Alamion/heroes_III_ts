# Research: spec 008

## R1 — LZMA entries of HotA archives

- The user's log: `compression type 2 (LZMA) is not supported (entry "#7e70701d" @66720431)`, file
  `HotA.lod`, HotA 1.8.0. The owner's installs (1.8.1, and the older plain-index copy) hold only types
  0 and 3 (5232 entries: 1363 raw, 3869 zlib; counted 2026-09-27), which is why 005 research M1 found
  no LZMA.
- `context/hota-lod-convert` (version `0.1.1+hota1.8.0-1.8.1`, so written for both builds) reads
  type 2 as: first byte 0; then a raw LZMA1 stream fed to liblzma's raw decoder with preset 6 and
  `dict_size = 1 << 24` (preset 6 means lc 3, lp 0, pb 2); the last 16 bytes are a footer of two
  little-endian i64, the uncompressed size and the index's stored size + 5. Implemented exactly so.
- No runtime dependencies (constitution): `src/core/util/lzma.ts` is a decoder written from the
  public-domain LZMA SDK reference decoder. Output buffer = dictionary (the size is known), so a
  distance before the start is corrupt data.
- Checked 2026-09-27 against Python's `lzma` (liblzma) in both directions, outside the repository:
  16 liblzma streams (empty, 1 byte, runs, 5 KB random, 20 KB two-symbol, 290 KB text, 300 KB with
  long-distance copies, 1.5 MB of `/usr/bin/bash`; each with and without the end marker) decode byte
  for byte; streams of the synthetic encoder decode with liblzma. One liblzma vector is embedded in
  the unit test. - **Verified on the real 1.8.0 archive (2026-09-27).** `HotA.lod` was taken out of
  `HotA_1.8.0_setup.exe` (from `h3hota.com/ru/download` → `heroes3towns.com/HotA/HotA_1.8.0_setup.exe`,
  Inno Setup 5.5.7) with `innoextract -I app/Data/HotA.lod`, without running the installer. It has
  5169 entries: **2970 LZMA**, 841 zlib, 1358 raw (1.8.1 has none of type 2), all with the framing
  above. All 5169 entries read through `LodArchive.read`; the sha256 of every entry equals an
  independent decode with Python's liblzma. The owner keeps the file as
  `public/dev-assets/HotA-1.8.0.lod`; `test/real/hota-archives.test.ts` reads every entry of it and of
  the configured install on each run.
- Rendering the HotA novelty zone of `test_map_hota.h3m` (`yarn h3 render … --hota`) gives the same
  pixels with the 1.8.0 and the 1.8.1 archive. `yarn verify hosts --files real --only 12,13` passes on
  all four hosts with `H3REF_HOTA_BUNDLE_DIR` pointing at the extracted 1.8.0 install.
- Speed. The data is dense: liblzma itself decodes the 174.4 MB of LZMA entries at 14 MB/s (12.2 s).
  The first decoder (closures over `let` variables) reached ~4 MB/s; the second (one object with
  fields, one probability array, `copyWithin` for non-overlapping matches) 4.8 MB/s on these entries
  and 7 MB/s on the liblzma test vectors. In the browser version, cold start without cache,
  1920×1080: `test_map_hota.h3m` 10.3–11.2 s with 1.8.0 against 8.6–10.0 s with 1.8.1; the 252×252
  `[HotA] The Devil Is in the Detail.h3m` 10.8–12.0 s against 12.4–12.9 s (noise ±1.5 s). A warm start
  comes from the decode cache and reads no LZMA. Not optimised further.

## R2 — Why one entry failed the whole archive

`LodArchive.read` threw for type 2; `decodeArchive` reads HotA's overrides of base terrain sprites
through the archive set, so the first such entry aborted the atlas and the controller reported
`CORRUPT_FILE HotA.lod`. The same happened for any object sprite in `decodeObjects`. Now reads fall
through to the next archive with the name, optional reads return `undefined`, and index anomalies other
than the wrong-key signals are per entry (spec FR-010).

## R3 — The browser never remembered HotA.lod

`indexedDbRememberedFiles` saved every slot but read back only `spriteArchive`, `dataArchive` and
`map` (the list dates from spec 004, before HotA). So after a reload a HotA map was drawn without the
archive — the same picture as the first report — until the user dropped HotA.lod again. The slot list
now includes `hotaArchive`.
