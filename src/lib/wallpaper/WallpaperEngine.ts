import {DEBUG_MODE} from "../utils/logs.ts";

export interface WallpaperProperties {
  lodfile?: string;
  hotalodfile?: string;
  mapfile?: string;
  [key: string]: unknown;
}

export type PropertyListener = (properties: WallpaperProperties) => void;

export function isWallpaperEngine(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  return (window as unknown as { wallpaperPropertyListener?: unknown }).wallpaperPropertyListener !== undefined;
}

export async function readFileFromPath(filePath: string): Promise<Uint8Array> {
  if (!filePath) {
    throw new Error("File path is empty");
  }

  const isWE = isWallpaperEngine();

  if (DEBUG_MODE) {
    console.log(`[WallpaperEngine] readFileFromPath: ${filePath}, isWE: ${isWE}`);
  }

  const response = await fetch(filePath);
  if (!response.ok) {
    throw new Error(`Failed to load file: ${response.statusText}`);
  }
  const buffer = await response.arrayBuffer();
  return new Uint8Array(buffer);
}

export function getDevFilePaths(): {
  lodPath: string;
  hotaLodPath: string | null;
  mapPath: string;
} {
  return {
    lodPath: "/dev-assets/H3sprite.lod",
    hotaLodPath: null, // Set to "/dev-assets/HotA.lod" if available
    mapPath: "/dev-assets/[HotA] The Devil Is in the Detail.h3m",
  };
}

export function resolveFilePath(path: string | undefined): string | null {
  if (!path) {
    return null;
  }

  if (path.startsWith("file:///")) {
    return path;
  }

  return `file:///${path.replace(/\\/g, "/")}`;
}

export function initWallpaperEngine(onPropertiesChange: PropertyListener): void {
  if (typeof window === "undefined") {
    return;
  }

  const we = window as unknown as {
    wallpaperPropertyListener?: {
      applyUserProperties: (properties: WallpaperProperties) => void;
    };
  };

  if (we.wallpaperPropertyListener) {
    const original = we.wallpaperPropertyListener.applyUserProperties;
    we.wallpaperPropertyListener.applyUserProperties = (properties: WallpaperProperties) => {
      original(properties);
      onPropertiesChange(properties);
    };
  }
}
