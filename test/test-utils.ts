import { readFileSync } from "fs";
import { resolve } from "path";

const TEST_DATA_DIR = resolve(__dirname, "../public/dev-assets");

export function readTestFile(filename: string): Uint8Array {
  const filePath = resolve(TEST_DATA_DIR, filename);
  return new Uint8Array(readFileSync(filePath));
}

export const TEST_FILES = {
  LOD: "H3sprite.lod",
  SOD_MAP: "Arrogance.h3m",
  HOTA_MAP: "[HotA] The Devil Is in the Detail.h3m",
} as const;
