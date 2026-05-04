import { useEffect, useRef } from "preact/hooks";
import * as PIXI from "pixi.js";
import { LodReader } from "./lib/lod/LodReader";
import { H3mReader } from "./lib/h3m/H3mReader";
import { H3mVersion } from "./lib/h3m/H3mTypes";
import { DefReader } from "./lib/def/DefReader";
import { TerrainRenderer } from "./lib/rendering/TerrainRenderer";
import {
  initWallpaperEngine,
  isWallpaperEngine,
  readFileFromPath,
  getDevFilePaths,
  resolveFilePath,
  type WallpaperProperties,
} from "./lib/wallpaper/WallpaperEngine";
import type { TerrainTextureSet } from "./lib/rendering/TerrainRenderer";
import { DEBUG_MODE, debugLog } from "./lib/utils/logs.ts";

interface DefInfo {
  name: string;
  layer: "terrain" | "river" | "road";
  frameCount: number;
}

function parsePalette(rawPalette: Uint8Array): number[][] {
  const palette: number[][] = [];
  for (let i = 0; i < 256; i++) {
    const offset = i * 3;
    palette.push([
      rawPalette[offset],
      rawPalette[offset + 1],
      rawPalette[offset + 2],
    ]);
  }
  return palette;
}

function rotatePalette(palette: number[][], startIndex: number, endIndex: number, reverse: boolean = false): number[][] {
  if (startIndex >= endIndex || startIndex < 0 || endIndex >= palette.length) {
    return palette;
  }
  const result = palette.map((c) => [...c]);

  if (reverse) {
    const lastColor = [...result[endIndex]];
    for (let i = endIndex; i > startIndex; i--) {
      result[i] = [...result[i - 1]];
    }
    result[startIndex] = lastColor;
  } else {
    const firstColor = [...result[startIndex]];
    for (let i = startIndex; i < endIndex; i++) {
      result[i] = [...result[i + 1]];
    }
    result[endIndex] = firstColor;
  }
  return result;
}

// private val paletteRotations = hashMapOf(
//         "watrtl.def" to listOf(229 to 241, 242 to 254),
//         "lavatl.def" to listOf(246 to 254),
//         "clrrvr.def" to listOf(183 to 195, 195 to 201),
//         "mudrvr.def" to listOf(183 to 189, 240 to 246),
//         "lavrvr.def" to listOf(240 to 248)
//     )

const PALETTE_ROTATIONS: Record<string, number[][]> = {
  WATRTL: [[229, 240], [242, 253]],
  LAVATL: [[246, 253]],
  CLRRVR: [[183, 194], [195, 200]],
  MUDRVR: [[183, 188], [240, 245]],
  LAVRVR: [[240, 247]],
};

const ANIM_FRAMES: Record<string, number> = {
  WATRTL: 12,
  CLRRVR: 6,
};

function createFrameCanvas(
  frame: { width: number; height: number; data: Uint8Array },
  palette: number[][],
  defName: string,
  applyRotation: boolean = true
): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.width = frame.width;
  canvas.height = frame.height;
  const ctx = canvas.getContext("2d")!;
  const imageData = ctx.createImageData(frame.width, frame.height);

  const rotations = PALETTE_ROTATIONS[defName.toUpperCase()];
  let workingPalette = palette;

  if (applyRotation && rotations && rotations.length > 0) {
    for (const [start, end] of rotations) {
      workingPalette = rotatePalette(workingPalette, start, end, true);
    }
  }

  for (let i = 0; i < frame.data.length; i++) {
    const paletteIndex = frame.data[i];
    if (paletteIndex < workingPalette.length) {
      imageData.data[i * 4] = workingPalette[paletteIndex][0];
      imageData.data[i * 4 + 1] = workingPalette[paletteIndex][1];
      imageData.data[i * 4 + 2] = workingPalette[paletteIndex][2];
      imageData.data[i * 4 + 3] = paletteIndex === 0 ? 0 : 255;
    }
  }
  ctx.putImageData(imageData, 0, 0);
  return canvas;
}

async function loadDefTexture(
  lodReader: LodReader,
  archive: ReturnType<LodReader["read"]>,
  defName: string,
  layerType: "terrain" | "river" | "road"
): Promise<{ textures: Map<string, TerrainTextureSet>; defInfo: DefInfo | null }> {
  const textures = new Map<string, TerrainTextureSet>();

  const entry = archive.files.find(
    (f) => f.name.toUpperCase() === `${defName.toUpperCase()}.DEF`
  );

  if (!entry) {
    return { textures, defInfo: null };
  }

  try {
    const defData = lodReader.readFileContent(entry);
    const defReader = new DefReader(defData);
    const defSprite = defReader.read();
    const rawPalette = defSprite.palette;
    const basePalette = parsePalette(rawPalette);

    const isAnimated = !!PALETTE_ROTATIONS[defName.toUpperCase()];
    const rotations = PALETTE_ROTATIONS[defName.toUpperCase()] || [];
    const defKey = defName.toUpperCase();
    const animSteps = isAnimated && rotations.length > 0
      ? (ANIM_FRAMES[defKey] ?? 8)
      : 1;

    const group = defSprite.groups[0];
    const frameCount = group.frames.length;

    for (let frameIdx = 0; frameIdx < frameCount; frameIdx++) {
      const key = `${defName.toLowerCase()}${frameIdx.toString().padStart(2, "0")}`;
      if (!textures.has(key)) {
        textures.set(key, { terrain: [], river: [], road: [] });
      }
      const textureSet = textures.get(key)!;

      const baseFrame = group.frames[frameIdx % group.frames.length];

      if (isAnimated && rotations.length > 0) {
        let rotatedPalette = basePalette;
        for (let step = 0; step < animSteps; step++) {
          const canvas = createFrameCanvas(baseFrame, rotatedPalette, defName, false);
          const pixiTexture = PIXI.Texture.from(canvas);
          if (layerType === "terrain") {
            textureSet.terrain.push(pixiTexture);
          } else if (layerType === "river") {
            textureSet.river.push(pixiTexture);
          } else {
            textureSet.road.push(pixiTexture);
          }
          for (const [start, end] of rotations) {
            rotatedPalette = rotatePalette(rotatedPalette, start, end, true);
          }
        }
      } else {
        const canvas = createFrameCanvas(baseFrame, basePalette, defName, true);
        const pixiTexture = PIXI.Texture.from(canvas);
        if (layerType === "terrain") {
          textureSet.terrain.push(pixiTexture);
        } else if (layerType === "river") {
          textureSet.river.push(pixiTexture);
        } else {
          textureSet.road.push(pixiTexture);
        }
      }
    }

    debugLog(`Loaded ${defName}: ${textures.size} variants`);

    return {
      textures,
      defInfo: { name: defName.toLowerCase(), layer: layerType, frameCount: textures.size },
    };
  } catch (err) {
    debugLog(`Failed to load ${defName}:`, err);
    return { textures, defInfo: null };
  }
}

async function loadTerrainTextures(
  lodReader: LodReader,
  archive: ReturnType<LodReader["read"]>
): Promise<{ textures: Map<string, TerrainTextureSet>; defList: DefInfo[] }> {
  const result = new Map<string, TerrainTextureSet>();
  const defList: DefInfo[] = [];

  const terrainNames = [
    "DIRTTL", "SANDTL", "GRASTL", "SNOWTL", "SWMPTL",
    "ROUGTL", "SUBBTL", "LAVATL", "WATRTL", "ROCKTL",
    "HIGHLND", "WASTLND",
  ];

  const riverNames = ["CLRRVR", "ICRVR", "MUDRVR", "LAVRVR"];
  const roadNames = ["DIRTRD", "GRAVRD", "COBBRD"];

  for (const name of terrainNames) {
    const { textures, defInfo } = await loadDefTexture(lodReader, archive, name, "terrain");
    textures.forEach((value, key) => {
      if (!result.has(key)) {
        result.set(key, { terrain: [], river: [], road: [] });
      }
      const existing = result.get(key)!;
      existing.terrain = value.terrain;
    });
    if (defInfo) defList.push(defInfo);
  }

  for (const name of riverNames) {
    const { textures, defInfo } = await loadDefTexture(lodReader, archive, name, "river");
    textures.forEach((value, key) => {
      if (!result.has(key)) {
        result.set(key, { terrain: [], river: [], road: [] });
      }
      const existing = result.get(key)!;
      existing.river = value.river;
    });
    if (defInfo) defList.push(defInfo);
  }

  for (const name of roadNames) {
    const { textures, defInfo } = await loadDefTexture(lodReader, archive, name, "road");
    textures.forEach((value, key) => {
      if (!result.has(key)) {
        result.set(key, { terrain: [], river: [], road: [] });
      }
      const existing = result.get(key)!;
      existing.road = value.road;
    });
    if (defInfo) defList.push(defInfo);
  }

  debugLog(`Total texture sets: ${result.size}`);
  return { textures: result, defList };
}

export function App() {
  const rendererRef = useRef<TerrainRenderer | null>(null);

  useEffect(() => {
    const we = isWallpaperEngine();

    if (DEBUG_MODE) {
      console.log(`[App] Running in ${we ? "Wallpaper Engine" : "browser (dev)"} mode`);
    }

    if (we) {
      initWallpaperEngine(handlePropertiesChange);
    } else {
      loadDevFiles();
    }
  }, []);

  useEffect(() => {
    if (!rendererRef.current) {
      const renderer = new TerrainRenderer();
      rendererRef.current = renderer;
      renderer.start();
    }

    return () => {
      if (rendererRef.current) {
        rendererRef.current.destroy();
        rendererRef.current = null;
      }
    };
  }, []);

  function handlePropertiesChange(properties: WallpaperProperties): void {
    const lodPath = resolveFilePath(properties.lodfile as string | undefined);
    const mapPath = resolveFilePath(properties.mapfile as string | undefined);

    if (DEBUG_MODE) {
      console.log("[App] Properties changed:", { lodPath, mapPath });
    }

    if (lodPath && mapPath) {
      loadFiles(lodPath, mapPath);
    }
  }

  async function loadDevFiles(): Promise<void> {
    const devPaths = getDevFilePaths();
    await loadFiles(devPaths.lodPath, devPaths.mapPath);
  }

  async function loadFiles(lodPath: string, mapPath: string): Promise<void> {
    try {
      debugLog(`=== Loading Started ===`);
      debugLog(`LOD path: ${lodPath}`);
      debugLog(`Map path: ${mapPath}`);

      const lodData = await readFileFromPath(lodPath);
      const lodReader = new LodReader(lodData);
      const archive = lodReader.read();

      const versionName =
        archive.isHota18 ? `HotA 1.8+ (encrypted)` : "Standard H3 LOD";
      debugLog(`LOD: ${versionName}`);
      debugLog(`Total files: ${archive.files.length}`);
      debugLog(`Compressed: ${archive.files.filter(f => f.compressionMethod === 3).length}`);

      const mapData = await readFileFromPath(mapPath);
      const h3mReader = new H3mReader(mapData);
      const h3mMap = h3mReader.read();

      const mapVersionName =
        h3mMap.version === H3mVersion.ROE
          ? "RoE"
          : h3mMap.version === H3mVersion.AB
          ? "AB"
          : h3mMap.version === H3mVersion.SOD
          ? "SoD"
          : `HotA v${h3mMap.hotaSubVersion}`;

      const mapTitle = h3mMap.header.title || "Untitled";
      debugLog(`=== Map Info ===`);
      debugLog(`Version: ${mapVersionName}`);
      debugLog(`Title: ${mapTitle}`);
      debugLog(`Size: ${h3mMap.header.size}x${h3mMap.header.size}`);
      debugLog(`Has underground: ${h3mMap.header.hasUnderground}`);
      debugLog(`Total tiles: ${h3mMap.tiles.length}`);

      const { textures, defList } = await loadTerrainTextures(lodReader, archive);

      debugLog(`=== DEF List ===`);
      for (const def of defList) {
        debugLog(`${def.name} (${def.layer}): ${def.frameCount} variants`);
      }

      if (rendererRef.current) {
        rendererRef.current.setMap(h3mMap);
        rendererRef.current.setTextures(textures);
        rendererRef.current.setDefList(defList);
      }

      debugLog(`=== Loading Complete ===`);
    } catch (err) {
      debugLog(`Error loading files: ${err}`);
    }
  }

  return (
    <>
    </>
  );
}
