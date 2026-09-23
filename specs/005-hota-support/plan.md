# Implementation Plan: HotA Support

**Branch**: `005-hota-support` | **Date**: 2026-09-22 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/005-hota-support/spec.md`

## Summary

Make Horn of the Abyss maps first-class without touching base-game behaviour. The user supplies one
extra archive (`HotA.lod`) next to their base archives; every layer learns HotA additively:

- **Archives** — `LodArchive` gains the HotA 1.8 obfuscated index (XOR key at header offset 12,
  FNV-1a name hashes), replacing the broken `header[12] === 135` check, and archives become an
  ordered **archive set** resolved first-match-wins with HotA in front, because HotA overrides four
  vanilla sprites and `game.pal`.
- **Map format** — `H3mVersion` becomes a (format code, sub-version) descriptor and `H3mContext`
  gains a declarative feature table; HotA `0x20` sub-versions 9 and 10 are required, 0–8 are
  best-effort. Research parsed 72/72 local HotA maps to the exact last byte, so the layout is known
  rather than guessed; the one genuinely open piece is the event-system ("script") block carried by
  4 maps, which gets its own bounds-checked walker validated by the exact-EOF invariant.
- **Data and render** — terrains gain a PCX-tile source for Highlands (id 10) and Wasteland (id 11),
  124 tiles each; towns move from three forms to five per faction with an explicit table of
  irregular stems; hero classes extend to `ah23_`; a name-keyed table carries HotA's two DEF
  conventions (shadows at palette 2/3, flag colour at index 255), verified by our own sweep before
  it is committed. `Objects.txt` learns the 12-wide terrain mask.
- **Verification** — a coverage check classifies the available maps and opens one of every class
  plus the named edge cases; the reference environment gains a second baseline captured from
  `h3hota.exe` with its own calibration and capture namespace, and the constitution is amended for
  that baseline and for HotA-specific budgets.
- **Hosts** — one new optional file setting flows to all four host manifests from the existing
  single source; unset means today's behaviour, byte for byte.

D32/P32 decoding, `HotA.dat`, `EdObjts.txt`, LZMA entries, HotA saves and random-map templates are
out of scope with recorded evidence ([research.md](research.md) R12).

## Technical Context

**Language/Version**: TypeScript 5.9 (strict, `erasableSyntaxOnly`), ES2022; Node 22 for tooling and
CLIs. Unchanged.

**Primary Dependencies**: runtime — none (WebGL 1.0, Worker, IndexedDB, `DecompressionStream`).
Dev — unchanged (Vite, Vitest, TypeScript, `playwright-core`). Ported source, not dependencies:
`hota-lod-convert` (MIT OR Apache-2.0) for the obfuscated index layout and detection rule,
`freeheroes` (MIT) for the map feature-table shape and sub-versions 0–5, `mmarchive-cli` (MIT) for
the seed lists of HotA DEF conventions, `h3m2json` Corpus (Unlicense) as prose reference;
`vcmi-hota-mod` (CC BY-SA) for town/terrain/object naming data, kept out of shipped builds. All
recorded in [THIRD_PARTY_NOTICES.md](../../THIRD_PARTY_NOTICES.md).

**Storage**: IndexedDB `h3dynam` decode cache — `CACHE_SCHEMA` bumps (payload shape changes: archive
set identity, terrain tile sources, five town forms). Cache identity for an archive set is the
ordered concatenation of each archive's existing `archiveIdentity` (header + index hash, so the
111 MB archive costs no more than today's). Reports in git-ignored `check-reports/`; HotA reference
captures in the git-ignored capture folder under their own baseline namespace.

**Testing**: Vitest (Node) on synthetic fixtures — a HotA-shaped obfuscated LOD (random key,
hashed names, raw + zlib entries), a `0x20` sub-9 and sub-10 map generator including the sub-10
deltas and an active script block, a 12-wide `Objects.txt`, PCX terrain tile sets, HotA-convention
DEFs; real-file suites in `test/real/` that skip with a message when the install is absent;
`yarn verify maps` (new coverage check), `yarn verify fidelity` against HotA captures,
`yarn verify determinism|layers|budget|packages|hosts` unchanged for the base game and extended for
the HotA case.

**Target Platform**: unchanged — desktop Chromium, Wallpaper Engine CEF, Lively WebView2, KDE Plasma
6 Qt WebEngine; all development, packaging and checks on Linux.

**Project Type**: single project — browser library + adapters + Node CLIs.

**Performance Goals**: base-game budgets unchanged and still gating. HotA case measured separately
and fixed by the constitution amendment: cold start with a 111 MB archive (244 MB uncompressed,
5232 entries), decode-cache size, total memory, and a 252×252 two-level map with up to ~53 600
objects and 1666 templates; GPU surface and paused-frame rules unchanged (they are structural).

**Constraints**: no runtime dependency may be added; parsers stay bounds-checked with typed errors
and no guessed skips (this rules out length-search for the script block); no game content or
game-derived data in the repository, including entry-name dictionaries; `src/core` stays DOM-free
and Node-runnable; HotA content must never change base-game rendering when no HotA archive is
loaded (US3 requires byte-identical renders).

**Scale/Scope**: 1 new archive index shape; 1 new map format with 2 required sub-versions; 2 new
terrains × 124 tiles; 11 factions × 5 town forms; hero classes 0–23; ~52 HotA DEF-convention names;
1883-row HotA `Objects.txt` with 830 class:subtype pairs; 237 local maps across 4 generations for
the coverage check.

**Thresholds fixed by this plan**: obfuscated-archive detection `u32 @12 ∉ {0, 0x7E0213}`; accepted
`Objects.txt` mask widths {9, 12}; accepted map format codes {0x0e, 0x15, 0x1c, 0x20}; required HotA
sub-versions {9, 10}; terrain tile-set size 124; exact-EOF + 124 zero bytes as the map-parse
acceptance invariant.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Check | Status |
| --- | --- | --- |
| I. User-Supplied Assets | HotA archive comes from the user at runtime as one more file setting; no entry-name dictionary, palette, tile or map is committed (R2); `context/` sources stay git-ignored and only their layouts/tables are ported, with attribution in THIRD_PARTY_NOTICES; CC BY-SA data (`vcmi-hota-mod`) informs hand-written tables and is not shipped; GPL sources (VCMI, vcmiextract, HotA-editor) are study-only, reimplemented in our own words; HotA captures live in the git-ignored capture folder; the hygiene test keeps covering new folders. | Pass |
| II. Fidelity to Complete | The Complete baseline is untouched and still gates base-game views; HotA gets a **second** baseline captured from `h3hota.exe`, which requires the constitution amendment that ships with this feature (FR-024, R13); captures are namespaced per baseline so the two can never be compared with each other. | Pass, with amendment |
| III. Script-Verifiable | New headless checks: map coverage (`yarn verify maps`), HotA fidelity against HotA captures, extended budget run for the HotA case; inspection CLIs work on HotA archives and maps with the same shape; the exact-EOF invariant makes a correct map parse machine-checkable; the DEF-convention sweep is a scripted measurement, not an eyeball. | Pass |
| IV. Screen-Bound Performance | Nothing becomes map-sized: terrain tiles are 248 additional 32×32 sprites in the existing atlas; the object atlas keeps its page budget; archive identity still hashes header + index only, so a 111 MB archive costs the same as a 64 MB one; decode stays in the worker; HotA budgets are measured and approved rather than assumed (R16). | Pass, pending measurement |
| V. Platform-Agnostic, Linux-First | All work is in core/runtime plus one settings entry; HotA capture tooling runs under the same Wine/Xvfb path on Linux; no Windows-only tooling. | Pass |
| VI. Layered, State-Driven | Archive set lives in `core/formats/lod`; the map feature table in `core/formats/h3m`; terrain sources, town forms, hero classes and DEF conventions are typed data modules in `core/data`; the renderer gains a sprite source kind, not special cases; `yarn verify layers` unchanged. | Pass |
| VII. Robust Parsing, Honest Failure | De-XOR sanity asserts catch a wrong key and raise a typed error; unsupported compression type, unknown sub-version and an unwalkable script block all produce typed `FormatError`s with file, offset, version and structure; an unresolved object class is counted and reported, never guessed or silently skipped (FR-017); no length search for the script block (R6). | Pass |
| VIII. Lean Dependencies | No runtime dependency added; the new code is parsing and data tables; no name dictionary in the bundle (lookup by hash); `erasableSyntaxOnly` and strict typing unchanged. | Pass |

**Gate result**: pass, with one required constitution amendment (Principle II baseline + the
"Formats in scope" list + HotA budget numbers), which is itself a task of this feature. No
Complexity Tracking entries.

**Post-design re-check (after Phase 1)**: the data model, contracts and quickstart add no runtime
dependency, no platform API below adapters and no new layer; the only cross-layer change is that
decode functions take an archive set instead of a single archive, which stays within
`formats → runtime`. **Pass**.

## Project Structure

### Documentation (this feature)

```text
specs/005-hota-support/
├── plan.md                  # this file
├── research.md              # Phase 0: measurements M1–M7, decisions R1–R16, risks
├── data-model.md            # Phase 1: entities and their rules
├── quickstart.md            # Phase 1: how to validate the feature end to end
├── contracts/
│   ├── archives.md          # archive set, HotA index, precedence, identity
│   ├── map-format.md        # 0x20 layout, feature table, script block, errors
│   ├── render-data.md       # terrain sources, town forms, heroes, DEF conventions
│   ├── cli.md               # yarn h3 / yarn verify maps / ref hota additions
│   └── settings.md          # the hotaarchive setting across the four hosts
├── checklists/requirements.md
└── tasks.md                 # /speckit-tasks
```

### Source Code (repository root)

```text
src/core/formats/lod/
├── lod.ts                        # + obfuscated index shape, key detection, sanity asserts
├── name-hash.ts                  # new: FNV-1a-32 over the lower-cased name
└── archive-set.ts                # new: ordered set, first-match-wins, combined identity
src/core/formats/text/objects-txt.ts   # mask width 9 or 12, group range widened
src/core/formats/h3m/
├── types.ts                      # version descriptor (format code + sub-version)
├── features.ts                   # new: feature table per (format, sub-version)
├── context.ts                    # context carries the feature table
├── header.ts, tiles.ts, templates.ts     # HotA header fields; tiles unchanged
├── script.ts                     # new: event-system walker (sub >= 9)
└── objects/                      # HotA subtypes: classes 144/145/146, 212/1000-1001, 36/1000+,
                                  # quest/seer sub-10 tails, creature bank preset, mine guards
src/core/data/
├── terrain.ts                    # ids 10/11, per-terrain sprite source (DEF | PCX tile set)
├── object-classes.ts             # five town forms per faction, HotA class/subtype families
├── heroes.ts                     # classes 0-23, gendered bodies (default non-suffixed)
└── hota-def-conventions.ts       # new: name-keyed shadow 2/3 and flag-255 tables
src/core/render/
├── atlas.ts                      # accepts PCX tile inputs beside DEF frames
├── object-atlas.ts               # per-DEF convention selection
└── palette.ts                    # rotation ranges re-checked against HotA game.pal
src/runtime/
├── decode.ts                     # takes an archive set; HotA before base
├── engine.ts                     # optional HotA archive blob
├── cache-key.ts                  # CACHE_SCHEMA bump; set identity
└── file-kind.ts                  # classify a HotA archive
src/adapters/shared/settings.ts   # + hotaarchive file setting (manifests regenerate)
tools/inspect/                    # lod list on hashed names; map info reports sub-version
tools/checks/maps/                # new: coverage-class check (yarn verify maps)
tools/reference-env/              # second baseline: hota game root, calibration, capture namespace
test/fixtures/synthetic/          # + hota-lod.ts, hota-map.ts, hota-objects-txt.ts, pcx tile set
test/real/                        # + hota archive/map suites (skip when the install is absent)
.specify/memory/constitution.md   # amendment: HotA baseline + HotA budgets
```

**Structure Decision**: single project, unchanged layering. HotA is additive data and additive
branches inside the existing format/data/render modules; the only structural additions are the
archive set, the map feature table, the script walker and one new check. No new layer, no new
package, no adapter change beyond one setting.

## Phase outline for tasks

1. **Archives (US1 groundwork)**: name hash, obfuscated index, detection rule, sanity asserts,
   delete the 135 marker and fix the synthetic fixture; archive set with precedence and combined
   identity; `file-kind` classification; CLI works on `HotA.lod`.
2. **Text tables**: `Objects.txt` mask width 9/12 and widened group range, with fixtures.
3. **Map format**: version descriptor + feature table; HotA header, counted heroes/artifacts,
   predefined-hero additions, event changes; tiles unchanged; templates `type` 0–10.
4. **Map objects**: HotA subtype families, the sub-10 quest/seer tails, class 144/145/146 bodies,
   Quest Gate and Grave, arena locations; every unknown class/subtype still a typed error.
5. **Script block (US2 blocker)**: the walker, validated on the four maps that carry one plus a
   synthetic fixture; exact-EOF invariant enforced for every map.
6. **Coverage check (US2)**: classification, sampling, on-demand full sweep, report shape.
7. **Terrain render (US1/US4)**: PCX tile source, atlas input kind, terrain ids 10/11, rivers/roads
   unchanged; palette rotation re-check under HotA `game.pal`.
8. **Objects, towns, heroes (US1/US4)**: five town forms, hero classes to 23, DEF-convention sweep
   then the committed table, object atlas convention selection.
9. **Fidelity reference (US4)**: HotA game root and calibration, capture namespace, constitution
   amendment, first HotA captures and fidelity views of `test_map_hota.h3m` including the
   lower-left novelty zone of the underground level.
10. **Hosts and budgets (US5)**: the `hotaarchive` setting and regenerated manifests, host
    simulations with a HotA archive and map, HotA budget measurement and the approved numbers.
11. **Polish**: AGENTS.md (state, facts, commands, the base-game-only town rule), TODO.md, docs,
    compliance review against this Constitution Check.

## Compliance Review (2026-09-23, after all five user stories)

| Principle | Implementation | Status |
| --- | --- | --- |
| I. User-Supplied Assets | The HotA archive comes from the user at runtime as one more file setting. Nothing game-derived is committed: no entry-name dictionary (lookups hash the name; the CLI reads the list from the git-ignored `context/` when present), no tiles, palettes or captures. Ported layouts are attributed in THIRD_PARTY_NOTICES (hota-lod-convert, FreeHeroes, MMArchiveCLI, h3m2json, and the VCMI HotA mod's naming data); VCMI, vcmiextract and HotA-editor are recorded as study-only, and the event-system walker was written from an understanding of behaviour, not from code. `yarn verify packages` passes. | Pass |
| II. Fidelity to Complete | The Complete baseline is untouched and still gates base-game views: fidelity gives the same 7 fail / 5 pass over the same captures as the pre-feature commit. The HotA baseline (constitution 1.3.0) is now built: its own game root, calibration, probe masks and capture namespace, refused outright without the amendment. Eight HotA views are captured from `h3hota.exe` and compared; a view is only ever compared against captures of its own baseline, and a mismatch is an error. | Pass |
| III. Script-Verifiable | New headless checks: `yarn verify maps` (453 maps, 229 classes, zero unresolved objects), the HotA budget case and now HotA image-level fidelity — `yarn verify fidelity --map test_map_hota.h3m --all-regions` runs on Linux without a human. Inspection CLIs work on HotA archives and maps. Synthetic fixtures keep the format covered without game files. | Pass |
| IV. Screen-Bound Performance | Measured: cold start 6.1 s, warm 2.0 s, memory 63 MB, object atlas 8.4 MB, zero frames and timers while hidden. Archive identity still hashes header + index only. **Known deviation**: object GPU memory still scales with the map; HotA made it visible, and the page size now follows the GPU's limit instead of the guaranteed minimum. A region-scoped atlas is recorded as the proper fix in TODO.md. | Pass, with a recorded deviation |
| V. Platform-Agnostic, Linux-First | All work is in core/runtime plus one settings entry; every check runs on Linux; no Windows-only tooling added. | Pass |
| VI. Layered, State-Driven | Archive set in `core/formats/lod`, feature table and script walker in `core/formats/h3m`, terrain sources, town forms, hero classes and sprite conventions in `core/data`; the renderer gained a sprite source kind and a per-tile palette row, not special cases. `yarn verify layers` passes. | Pass |
| VII. Robust Parsing, Honest Failure | De-XOR asserts catch a wrong key; unsupported compression, unknown sub-version, unknown class/subtype and an unknown event-system opcode all raise typed errors with file, offset, version and structure. No length was guessed: the event-system block is walked, and its correctness is proven by the map ending exactly at its 124-byte trailer on all 453 maps. An unresolved object is counted and named, never silently skipped. | Pass |
| VIII. Lean Dependencies | No runtime dependency added; packages still build and pass their size check. | Pass |

Outstanding for a follow-up: the object-pixel difference the HotA fidelity views show (0.4 %–14 %,
terrain and water exact). It is measured and recorded in research.md "The open difference" with two
explanations already ruled out; it needs owner review before it can become an accepted deviation,
and it is the one thing standing between SC-004 and a clean pass.

## Complexity Tracking

None. The one deviation requiring approval was the HotA reference baseline; the owner approved it
and it is recorded in constitution 1.3.0 (with the budget numbers in 1.3.1).
