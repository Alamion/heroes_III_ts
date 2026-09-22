# Contract: Render data

**Feature**: [../spec.md](../spec.md) | **Evidence**: [../research.md](../research.md) M1, M7, R7–R11

## Terrain

```
TerrainSpriteSource =
  { kind: 'def',   defName: string }            // the ten existing terrains, unchanged
| { kind: 'tiles', prefix: string, count: 124 } // 10 Highlands 'hglnt', 11 Wasteland 'wstlt'
```

| Rule | Contract |
| --- | --- |
| Tile names | `<prefix><index, 3 digits>.pcx`, indices 000–123, resolved through the archive set |
| Tile shape | 32×32 indexed LOD-PCX, 1024 pixels + 768-byte palette, stored raw in the archive |
| Selection | The map tile record supplies the index and the mirroring bits; no pattern matching is performed at render time |
| Bounds | `terrainView` must be < `count` for the terrain; otherwise a typed `INVALID_VALUE` naming tile and terrain |
| Rivers / roads | Unchanged — HotA adds none; Highlands uses the clear river art, Wasteland the mud river art |
| Atlas | `buildAtlas` accepts decoded PCX tiles as inputs beside DEF frames; page budget and `toDisplayColor` are unchanged |
| Missing archive | With no HotA archive loaded, terrain ids 10/11 resolve to nothing: the tiles are reported as unresolved (FR-017) and the rest of the map still renders |

## Towns

```
TownForms = { village, fort, citadel, castle, capitol }   // DEF names per faction
```

| Rule | Contract |
| --- | --- |
| Coverage | Nine base factions + Cove + Factory + random town |
| Irregular stems | Spelled out in the table: Fortress `avcftrt0 / avcforf0 / avcforc0 / avcftrx0 / avcforz0`; Conflux `avchfor0 / avchfof0 / avchfoc0 / avchforx / avchforz` (eight characters, no trailing zero) |
| Selection | capitol → castle → citadel → fort → village, by the town's fortification level |
| Resolution | Through the archive set: some village DEFs exist only in the base archive |
| Base game | Unchanged behaviour with no HotA archive: base `Objects.txt` declares only the castle form, so the placed template keeps deciding (US3 requires byte-identical renders) |
| Documentation | The "two forms" rule in AGENTS.md is re-scoped as base-game-only |

## Heroes

| Rule | Contract |
| --- | --- |
| Classes | `ah00_ … ah23_` (18 Cove Captain, 19 Cove Navigator, 20 Factory Mercenary, 21 Factory Artificer; 22/23 unreleased) |
| Gendered bodies | Every class also has an `ah<NN>b_` body; the table carries both, the renderer uses the non-suffixed one until a measured gender source exists (recorded as a candidate deviation) |
| Flags | Unchanged: eight `af0?.def` with the colour baked in; HotA repaints only `af01` and that resolves through the archive set |

## DEF conventions

```
HotaDefConventions = {
  shadowAt2And3: readonly string[],   // index 3 behaves like base 1, index 2 like base 4
  flagAt255:     readonly string[],   // player-flag slot is index 255 instead of 5
  keepSelection: readonly string[],   // index 5 is not made transparent
}
```

| Rule | Contract |
| --- | --- |
| Keying | By DEF name only. Never by archive, never by heuristic, so a base-game sprite is never re-interpreted |
| Provenance | Seeded from the MIT source, then replaced by the result of our own sweep over every `av*`/`ah*` DEF in the HotA archive (count pixels at indices 2, 3, 255) |
| Stems | The sweep settles whether listed stems cover numbered family members; the committed table lists exact names |
| Base rules | Unchanged for every DEF not in the table: index 1 `(c>>1)+(c>>2)`, index 4 `c>>1`, flag index 5 |

## Palettes

| Rule | Contract |
| --- | --- |
| Source | `game.pal` resolves through the archive set, so the HotA palette wins when a HotA archive is loaded |
| Difference | HotA's palette differs from the base one only at indices 65 and 67 (two player flag colours in the 64–71 range) |
| Rotation | Ranges (lava 246–254, mud river 228–239, lava river 240–248) are re-verified against the HotA palette; any difference becomes a data-table entry, not a code branch |
| Terrain tiles | Whether the Highlands/Wasteland tile palettes contain a rotating range is measured during implementation; the expectation from the data is that they do not animate |

## Unresolved content

| Rule | Contract |
| --- | --- |
| Not drawn | An object whose class/subtype has no sprite is not drawn; the terrain under it stays visible |
| Counted | Class, subtype, DEF name and map position are recorded in the diagnostics and in the check report |
| Dev harness | Marked visibly there, never on the wallpaper |
| Acceptance | A non-zero count fails `yarn verify maps` (FR-017, FR-020) |
| Draw order | Unaffected: the object keeps its place in the order, it simply contributes no pixels |
