import { describe, it, expect } from "vitest";
import { LodReader } from "../src/lib/lod/LodReader";
import { DefReader } from "../src/lib/def/DefReader";
import { readTestFile, TEST_FILES } from "./test-utils";

describe("LodReader", () => {
  it("should parse H3sprite.lod header correctly", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    expect(archive.files).toHaveLength(4013);
    expect(archive.isHota18).toBe(false);
  });

  it("should identify DEF sprite files", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    const defFiles = archive.files.filter((f) =>
      f.name.toLowerCase().endsWith(".def")
    );

    expect(defFiles.length).toBeGreaterThan(0);
    expect(defFiles.length).toBe(2565);
  });

  it("should have correct file entry structure", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    const firstFile = archive.files[0];

    expect(firstFile).toHaveProperty("name");
    expect(firstFile).toHaveProperty("offset");
    expect(firstFile).toHaveProperty("size");
    expect(firstFile).toHaveProperty("compressedSize");
    expect(firstFile).toHaveProperty("compressionMethod");
  });

  it("should correctly identify zlib compression", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    const compressedFiles = archive.files.filter(
      (f) => f.compressionMethod === 3
    );

    expect(compressedFiles.length).toBe(4013);
  });

  it("should read file entries with valid offsets", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    for (const file of archive.files) {
      expect(file.offset).toBeGreaterThan(0);
      expect(file.size).toBeGreaterThan(0);
    }
  });

  it("should handle standard LOD format (not HoTA 1.8)", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    expect(archive.isHota18).toBe(false);

    const sampleDef = archive.files.find((f) => f.name === "AB01_.def");
    expect(sampleDef).toBeDefined();
    expect(sampleDef?.name).toBe("AB01_.def");
  });

  it("should read and decompress DEF file content", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    const sampleDef = archive.files.find((f) => f.name === "AB01_.def");
    expect(sampleDef).toBeDefined();

    const content = reader.readFileContent(sampleDef!);
    expect(content.length).toBeGreaterThan(0);
    expect(content.length).toBe(sampleDef!.size);
  });

  it("should decompress multiple DEF files without errors", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    const defFiles = archive.files.filter(
      (f) => f.name.toLowerCase().endsWith(".def")
    );

    let errors: string[] = [];
    for (let i = 0; i < Math.min(50, defFiles.length); i++) {
      try {
        const content = reader.readFileContent(defFiles[i]);
        if (content.length === 0 || content.length !== defFiles[i].size) {
          errors.push(`${defFiles[i].name}: size mismatch`);
        }
      } catch (err) {
        errors.push(`${defFiles[i].name}: ${err}`);
      }
    }

    expect(errors).toHaveLength(0);
  });

  it("should parse DEF sprite after decompression", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const reader = new LodReader(data);
    const archive = reader.read();

    const sampleDef = archive.files.find((f) => f.name === "AB01_.def");
    expect(sampleDef).toBeDefined();

    const content = reader.readFileContent(sampleDef!);
    const defReader = new DefReader(content);
    const sprite = defReader.read();

    expect(sprite.groups.length).toBeGreaterThan(0);
    expect(sprite.palette.length).toBe(256 * 3);
  });
});
