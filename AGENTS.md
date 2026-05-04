# AGENTS.md - Development Guidelines for heroes_iii_dynam

## Project Overview

Wallpaper Engine wallpaper that renders Heroes 3 game maps using extracted sprites from LOD archives.

**Target Environment:** Wallpaper Engine CEF (Chromium Embedded Framework)

## Tech Stack

- **Framework:** Preact + TypeScript
- **Package Manager:** yarn
- **Bundler:** Vite
- **Testing:** Vitest
- **Rendering:** Pixi.js
- **State Management:** Zustand or Valtio
- **Compression:** fflate (for LOD extraction - supports LZMA and zlib), pako (gzip)
- **Caching:** idb-keyval (IndexedDB)

---

## Commands

```bash
yarn dev          # Start Vite dev server with HMR
yarn build        # TypeScript type-check + Vite production build
yarn preview      # Preview production build locally
yarn sync         # Build + sync to Wallpaper Engine project folder
yarn sync:watch   # Watch dist/ changes and auto-sync (dev workflow)
yarn test         # Run Vitest tests
yarn test:watch   # Run Vitest in watch mode
yarn test:coverage # Run tests with coverage report
```

---

## Testing

Tests are located in `test/` directory and use Vitest.

### Running Tests

```bash
yarn test         # Run all tests once
yarn test:watch   # Watch mode for development
yarn test:coverage # Generate coverage report
```

### Test Files

- `test/lod.test.ts` - LOD parser tests
- `test/h3m.test.ts` - H3M map parser tests
- `test/test-utils.ts` - Test utilities and fixtures

### Test Data

Test fixtures are stored in ` public/dev-assets/`:
- `H3sprite.lod` - Standard Heroes 3 sprite archive
- `Arrogance.h3m` - SoD map (36x36 with underground)
- `[HotA] The Devil Is in the Detail.h3m` - HotA map (252x252)

---

## Code Style Guidelines

- **Strict TypeScript** - all strict flags enabled, avoid `any`
- **Type imports** - separate `import type { ... }` statements
- **Preact** - functional components with hooks, use `preact/hooks`
- **Imports** - group: external → internal → relative, sort alphabetically
- **Naming** - PascalCase components, camelCase hooks/utils, SCREAMING_SNAKE_CASE config
- **Async/await** - over `.then()` chains, always wrap in try/catch

---

## File Organization

```
src/
├── lib/
│   ├── utils/           # Shared utilities
│   │   ├── BinaryReader.ts  # Base class for binary parsing
│   │   └── index.ts     # Re-exports
│   ├── utils.ts         # Debug logging utilities
│   ├── def/             # DEF sprite format parsing
│   │   ├── DefReader.ts     # DEF sprite parser
│   │   └── DefTypes.ts      # TypeScript types
│   ├── h3m/             # H3M map format parsing
│   │   ├── H3mReader.ts     # H3M map parser
│   │   └── H3mTypes.ts      # TypeScript types
│   ├── lod/             # LOD archive parsing
│   │   ├── LodReader.ts     # LOD archive reader
│   │   └── LodArchive.ts    # LOD entry types
│   ├── terrain/         # Terrain type definitions
│   │   └── TerrainTypes.ts  # Terrain constants
│   ├── rendering/       # Pixi.js rendering
│   │   └── TerrainRenderer.ts  # Terrain rendering
│   └── wallpaper/      # Wallpaper Engine integration
│       └── WallpaperEngine.ts  # WE utilities
├── App.tsx              # Main application component
└── main.tsx             # Entry point
```
src/
├── components/       # Preact components
├── hooks/           # Custom hooks
├── lib/             # Utilities
│   ├── lod/         # LOD file parsing (see Reference Implementation)
│   ├── h3m/         # Map format parsing
│   ├── wallpaper/  # Wallpaper Engine integration
│   └── rendering/  # Pixi.js rendering
├── stores/          # Zustand/Valtio stores
└── types/           # TypeScript types
test/
├── *.test.ts        # Test files
└── test-utils.ts   # Test utilities
```

---

## Reference Implementation

**Primary Reference:** `tmp/heroes_iii_android/` - Kotlin Android implementation

### LOD Format (`tmp/heroes_iii_android/core/src/main/kotlin/com/homm3/livewallpaper/parser/lod/`)

- **LodReader.kt** - Parses LOD archive header, supports:
  - Standard H3 LOD format
  - HoTA 1.8+ encrypted format (XOR decryption)
- **LodArchive.kt** - Data structures for entries
- **Compression:** LZMA (method 2), zlib (method 3), or raw

### DEF Sprite Format (`tmp/heroes_iii_android/core/src/main/kotlin/com/homm3/livewallpaper/parser/def/`)

- **DefReader.kt** - Full parser with 4 compression types (0-3)
- Palette-based (256 colors), supports animation groups

### H3M Map Format (`tmp/heroes_iii_android/core/src/main/kotlin/com/homm3/livewallpaper/parser/h3m/`)

- **H3mReader.kt** - Complete map parser (terrain, objects, heroes, towns)
- Supports RoE, AB, SoD, and HotA versions
- Map files use `.h3m` extension (NOT .sav)

---

## User Configuration (project.json)

Use Wallpaper Engine user properties for configuration:

```json
"properties": {
  "lodfile": { "type": "file", "text": "H3sprite.lod File" },
  "hotalodfile": { "type": "file", "text": "HotA.lod (Optional)" },
  "mapfile": { "type": "file", "text": "Map File (.h3m)" }
}
```

**Important:** Do not set `fileType` to restrict files - use just `"type": "file"` to allow all file types.

File property paths are automatically resolved with `file:///` prefix by `src/lib/wallpaper/WallpaperEngine.ts`.

---

## Development vs Production

The app automatically detects its environment:

- **Development (browser):** Uses hardcoded paths from `getDevFilePaths()` in `src/lib/wallpaper/WallpaperEngine.ts`
- **Wallpaper Engine:** Listens for property changes via `window.wallpaperPropertyListener`

The detection is handled by `isWallpaperEngine()` which checks for the presence of `window.wallpaperPropertyListener`.

### Development Workflow

1. Edit file paths in `src/lib/wallpaper/WallpaperEngine.ts` -> `getDevFilePaths()` if needed
2. Run `yarn dev` or `yarn preview` to start Vite server
3. Open browser at http://localhost:5173 (or whatever port Vite uses)

### Wallpaper Engine Workflow

1. Build: `yarn build`
2. Sync to Wallpaper Engine: `yarn sync` or `yarn sync:watch`
3. Configure LOD and map files via Wallpaper Engine property panel

---

## Chrome DevTools Integration

The project includes Chrome DevTools MCP for debugging. Use it to:
- Inspect the rendered page
- Debug JavaScript/TypeScript
- Analyze network requests
- Take screenshots for verification

See Chrome DevTools documentation for usage in opencode.

See `tmp/example_wallpaper_engine` for full example of web-based wallpaper engine project and `tmp/wallpaper_dev_wiki` for wallpaper engine web documentation.

---

## Required Assets

| File | Required | Source |
|------|----------|--------|
| `H3sprite.lod` | Yes | Heroes 3 Data folder |
| `HotA.lod` | No | HoTA Data folder (pre-1.8 only) - Required for HIGHLND.DEF and WASTLND.DEF terrain textures |
| `*.h3m` | Yes | Map file |

**Note:** Some terrain textures (HIGHLND.DEF, WASTLND.DEF) are only available in HotA.lod, not the base H3sprite.lod. These terrains will be skipped when only H3sprite.lod is provided.

---

## Error Handling & Logging

Use `src/lib/utils.ts` for debug logging (only outputs in DEV mode):
```typescript
import { debugLog, debugWarn, debugError } from './lib/utils'
```

- Never silently swallow errors
- Log meaningful context (file paths, operation names)

---

## Wallpaper Engine Resources

**Local:** `tmp/wallpaper_dev_wiki/` - Full documentation
- `user_properties.md` - Property types and usage
- `wallpaper_property_listener.md` - Event handling
- `fps_limiter.md` - Performance optimization
- `audio_visualization.md` - Audio processing

**Online:** https://docs.wallpaperengine.io/

---

## What NOT To Do

- Do NOT use `console.log` - use debug logging utilities
- Do NOT commit secrets, API keys, or game assets
- Do NOT assume file paths - use proper path resolution
