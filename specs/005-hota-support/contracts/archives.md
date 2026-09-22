# Contract: Archives

**Feature**: [../spec.md](../spec.md) | **Evidence**: [../research.md](../research.md) M1, M2, R1–R3

## Detection

```
openArchive(source) →
  key = u32 LE at header offset 12
  kind = (key === 0 || key === 0x7E0213) ? 'plain' : 'obfuscated'
```

`0x7E0213` is uninitialised filler in `h3sprite.lod`, `sprite.lod` and `lsprite.lod`, not a key. The
old `header[12] === 135` rule is removed, together with the `hota18Marker` synthetic fixture that
encodes it.

## Obfuscated entry record (32 bytes)

| Offset | Size | Field |
| --- | --- | --- |
| 0 | 4 | `nameHash` (u32, not XORed) |
| 4 | 4 | `offset ^ key` (i32) |
| 8 | 4 | `size ^ key` (i32) |
| 12 | 4 | `compressedSize ^ key` (i32) |
| 16 | 1 | `compression` (u8, not XORed) |
| 17 | 15 | filler (random; never read) |

**Post-conditions after de-XOR** — any failure raises `FormatError` with `structure: 'entry N'` and
the byte offset, because a wrong key is indistinguishable from corruption otherwise:

- `offset ≥ 0`, `size ≥ 0`, `compressedSize ≥ 0`
- `compressedSize === 0 ⇔ compression === 0`
- `compression ∈ {0, 1, 2, 3}`
- `offset + max(size, compressedSize)` within the file
- entries do not overlap

## Name hash

```
fnv1a32(lowercase(name)) with basis 0x811C9DC5, prime 0x01000193, no trailing NUL
```

`find(name)`, `has(name)` and `get(name)` hash the argument, so lookups work with no name table.
`get` on a missing name keeps raising `NOT_FOUND` with the archive file name.

## Reading

| compression | Behaviour |
| --- | --- |
| 0 | raw bytes of length `size` |
| 3 | inflate (`DecompressionStream`/zlib) to exactly `size`; a short or long result is `DECOMPRESS_FAILED` |
| 1, 2 | `UNSUPPORTED_VERSION`-class typed error naming the entry and the compression type; other entries stay readable |

## Archive set

```
ArchiveSet.of([hotaArchive?, ...baseArchives])
  find(name)  → first member whose index has the name
  read(name)  → read from that member
  identity()  → ordered join of each member's archiveIdentity()
```

| Rule | Contract |
| --- | --- |
| Precedence | HotA first. Deterministic and documented; overrides observed in practice: `grastl.def`, `watrtl.def`, `clrrvr.def`, `icyrvr.def`, `game.pal`. |
| Both directions | Names missing from HotA resolve from the base archives (several town village DEFs, `artraits.txt`). |
| Identity | Each member contributes its existing header+index hash, so a 111 MB archive costs no more to identify than a 64 MB one. Set identity changes if the order changes. |
| Logging | A duplicate name is resolvable and logged once at debug level; never an error. |

## Inspection CLI behaviour

| Command | Contract |
| --- | --- |
| `yarn h3 lod list HotA.lod` | Lists entries. A name resolved from the local, git-ignored `context/hota-lod-convert/data/hashes.txt` is printed as the name; otherwise `#<hex hash>`. Output shape (JSON document, exit codes) unchanged. |
| `yarn h3 lod extract HotA.lod:Objects.txt` | Works by hashing the requested name; no dictionary needed. |
| Other `lod`/`def`/`pcx` commands | Unchanged shape; they accept a HotA archive wherever they accept a base one. |

Nothing derived from the archive — names, palettes, tiles — is written into the repository.
