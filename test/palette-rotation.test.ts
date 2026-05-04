import { describe, it, expect } from "vitest";
import { LodReader } from "../src/lib/lod/LodReader";
import { DefReader } from "../src/lib/def/DefReader";
import { readTestFile, TEST_FILES } from "./test-utils";

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

function rotatePalette(
  palette: number[][],
  startIndex: number,
  endIndex: number,
  reverse: boolean = false
): number[][] {
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

function createFrameData(
  frame: { width: number; height: number; data: Uint8Array },
  palette: number[][],
  defName: string,
  rotations: number[][]
): number[][][] {
  const frames: number[][][] = [];
  let workingPalette = palette;

  const animSteps = 8;

  for (let step = 0; step < animSteps; step++) {
    const imageData: number[][] = [];
    for (let i = 0; i < frame.data.length; i++) {
      const paletteIndex = frame.data[i];
      if (paletteIndex < workingPalette.length) {
        imageData.push([...workingPalette[paletteIndex]]);
      } else {
        imageData.push([0, 0, 0]);
      }
    }
    frames.push(imageData);

    for (const [start, end] of rotations) {
      workingPalette = rotatePalette(workingPalette, start, end, true);
    }
  }

  return frames;
}

function hasWhitePixels(frameData: number[][], threshold: number = 250): number {
  let whiteCount = 0;
  for (const pixel of frameData) {
    if (pixel[0] >= threshold && pixel[1] >= threshold && pixel[2] >= threshold) {
      whiteCount++;
    }
  }
  return whiteCount;
}

function analyzeWhitePixels(
  frame: { width: number; height: number; data: Uint8Array },
  palette: number[][],
  threshold: number = 250
): { whiteIndices: number[], whiteCount: number, totalNonTransparent: number } {
  const whiteIndices = new Set<number>();
  let whiteCount = 0;
  let totalNonTransparent = 0;

  for (let i = 0; i < frame.data.length; i++) {
    const paletteIndex = frame.data[i];
    if (paletteIndex === 0) continue; // skip transparent
    
    totalNonTransparent++;
    const color = palette[paletteIndex];
    if (color && color[0] >= threshold && color[1] >= threshold && color[2] >= threshold) {
      whiteIndices.add(paletteIndex);
      whiteCount++;
    }
  }

  return { 
    whiteIndices: Array.from(whiteIndices).sort((a, b) => a - b), 
    whiteCount, 
    totalNonTransparent 
  };
}

function countNonTransparentPixels(frameData: number[][]): number {
  return frameData.length;
}

const PALETTE_ROTATIONS: Record<string, number[][]> = {
  WATRTL: [[228, 240], [242, 254]],
  CLRRVR: [[183, 195], [195, 200]],
  LAVATL: [[246, 254]],
  MUDRVR: [[183, 189], [240, 246]],
  LAVRVR: [[240, 248]],
};

describe("Palette Rotation Animation", () => {
  it("should not produce white pixels in WATRTL animation frames", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const entry = archive.files.find(
      (f) => f.name.toUpperCase() === "WATRTL.DEF"
    );
    expect(entry).toBeDefined();

    const defData = lodReader.readFileContent(entry!);
    const defReader = new DefReader(defData);
    const sprite = defReader.read();

    const palette = parsePalette(sprite.palette);
    const rotations = PALETTE_ROTATIONS["WATRTL"];
    const group = sprite.groups[0];
    const frame = group.frames[0];

    const frames = createFrameData(frame, palette, "WATRTL", rotations);

    for (let i = 0; i < frames.length; i++) {
      const whiteCount = hasWhitePixels(frames[i]);
      const totalPixels = countNonTransparentPixels(frames[i]);
      const whitePercentage = (whiteCount / totalPixels) * 100;

      expect(whitePercentage).toBeLessThan(5);
    }
  });

  it("should not produce white pixels in CLRRVR animation frames", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const entry = archive.files.find(
      (f) => f.name.toUpperCase() === "CLRRVR.DEF"
    );
    expect(entry).toBeDefined();

    const defData = lodReader.readFileContent(entry!);
    const defReader = new DefReader(defData);
    const sprite = defReader.read();

    const palette = parsePalette(sprite.palette);
    const rotations = PALETTE_ROTATIONS["CLRRVR"];
    const group = sprite.groups[0];
    const frame = group.frames[0];

    const frames = createFrameData(frame, palette, "CLRRVR", rotations);

    for (let i = 0; i < frames.length; i++) {
      const whiteCount = hasWhitePixels(frames[i]);
      const totalPixels = countNonTransparentPixels(frames[i]);
      const whitePercentage = (whiteCount / totalPixels) * 100;

      expect(whitePercentage).toBeLessThan(5);
    }
  });

  it("should have consistent frame count (8 frames) for animated terrains", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const animatedDefs = ["WATRTL", "CLRRVR", "LAVATL"];

    for (const defName of animatedDefs) {
      const entry = archive.files.find(
        (f) => f.name.toUpperCase() === `${defName}.DEF`
      );
      if (!entry) continue;

      const defData = lodReader.readFileContent(entry);
      const defReader = new DefReader(defData);
      const sprite = defReader.read();

      const palette = parsePalette(sprite.palette);
      const rotations = PALETTE_ROTATIONS[defName];
      const group = sprite.groups[0];
      const frame = group.frames[0];

      const frames = createFrameData(frame, palette, defName, rotations);

      expect(frames.length).toBe(8);

      const frame0Data = JSON.stringify(frames[0]);
      const frame7Data = JSON.stringify(frames[7]);
    }
  });

  it("should return to original palette after full animation cycle", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const entry = archive.files.find(
      (f) => f.name.toUpperCase() === "WATRTL.DEF"
    );
    expect(entry).toBeDefined();

    const defData = lodReader.readFileContent(entry!);
    const defReader = new DefReader(defData);
    const sprite = defReader.read();

    const originalPalette = parsePalette(sprite.palette);
    const rotations = PALETTE_ROTATIONS["WATRTL"];

    let currentPalette = originalPalette.map((c) => [...c]);
    let cycleLength = 0;
    const maxCycles = 100;

    do {
      for (const [start, end] of rotations) {
        currentPalette = rotatePalette(currentPalette, start, end, true);
      }
      cycleLength++;
    } while (JSON.stringify(currentPalette) !== JSON.stringify(originalPalette) && cycleLength < maxCycles);

    console.log(`WATRTL cycle length with reverse: ${cycleLength}`);

    const animSteps = cycleLength;
    const group = sprite.groups[0];
    const frame = group.frames[0];

    const frames: number[][][] = [];
    let workingPalette = originalPalette.map((c) => [...c]);
    for (let step = 0; step < animSteps; step++) {
      const imageData: number[][] = [];
      for (let i = 0; i < frame.data.length; i++) {
        const paletteIndex = frame.data[i];
        if (paletteIndex < workingPalette.length) {
          imageData.push([...workingPalette[paletteIndex]]);
        } else {
          imageData.push([0, 0, 0]);
        }
      }
      frames.push(imageData);

      for (const [start, end] of rotations) {
        workingPalette = rotatePalette(workingPalette, start, end, true);
      }
    }

    expect(cycleLength).toBeLessThan(maxCycles);
    expect(frames.length).toBe(cycleLength);
  });

  it("should find cycle length for each animated terrain", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const animatedDefs = ["WATRTL", "CLRRVR", "LAVATL", "MUDRVR", "LAVRVR"];

    for (const defName of animatedDefs) {
      const entry = archive.files.find(
        (f) => f.name.toUpperCase() === `${defName}.DEF`
      );
      if (!entry) continue;

      const defData = lodReader.readFileContent(entry);
      const defReader = new DefReader(defData);
      const sprite = defReader.read();

      const originalPalette = parsePalette(sprite.palette);
      const rotations = PALETTE_ROTATIONS[defName];

      let currentPalette = originalPalette.map((c) => [...c]);
      let cycleLength = 0;

      do {
        for (const [start, end] of rotations) {
          currentPalette = rotatePalette(currentPalette, start, end, true);
        }
        cycleLength++;
      } while (JSON.stringify(currentPalette) !== JSON.stringify(originalPalette) && cycleLength < 100);

      console.log(`${defName} cycle length with reverse: ${cycleLength}`);
    }
  });

  it("should not double-rotate palette (simulating the fix)", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const entry = archive.files.find(
      (f) => f.name.toUpperCase() === "WATRTL.DEF"
    );
    expect(entry).toBeDefined();

    const defData = lodReader.readFileContent(entry!);
    const defReader = new DefReader(defData);
    const sprite = defReader.read();

    const originalPalette = parsePalette(sprite.palette);
    const rotations = PALETTE_ROTATIONS["WATRTL"];
    const group = sprite.groups[0];
    const frame = group.frames[0];

    const frames: number[][][] = [];
    let rotatedPalette = originalPalette.map((c) => [...c]);

    const animSteps = 8;
    for (let step = 0; step < animSteps; step++) {
      const imageData: number[][] = [];
      for (let i = 0; i < frame.data.length; i++) {
        const paletteIndex = frame.data[i];
        if (paletteIndex < rotatedPalette.length) {
          imageData.push([...rotatedPalette[paletteIndex]]);
        } else {
          imageData.push([0, 0, 0]);
        }
      }
      frames.push(imageData);

      for (const [start, end] of rotations) {
        rotatedPalette = rotatePalette(rotatedPalette, start, end, true);
      }
    }

    const frame0Data = frames[0];
    const frame7Data = frames[7];

    const paletteAtStep0 = JSON.stringify(originalPalette);
    const paletteAfterAllSteps = JSON.stringify(rotatedPalette);
    
    expect(paletteAtStep0).not.toBe(paletteAfterAllSteps);

    const firstFrame = frames[0];
    const whiteCount = hasWhitePixels(firstFrame);
    const totalPixels = countNonTransparentPixels(firstFrame);
    const whitePercentage = (whiteCount / totalPixels) * 100;
    
    expect(whitePercentage).toBeLessThan(5);
  });

  it("should diagnose which palette indices cause white pixels in WATRTL", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const entry = archive.files.find(
      (f) => f.name.toUpperCase() === "WATRTL.DEF"
    );
    expect(entry).toBeDefined();

    const defData = lodReader.readFileContent(entry!);
    const defReader = new DefReader(defData);
    const sprite = defReader.read();

    const originalPalette = parsePalette(sprite.palette);
    const group = sprite.groups[0];
    const frame = group.frames[0];

    console.log("\n=== WATRTL Original Palette Analysis ===");
    console.log("Palette indices in frame data:", new Set(frame.data).size, "unique indices");
    
    const indexCounts = new Map<number, number>();
    for (const idx of frame.data) {
      indexCounts.set(idx, (indexCounts.get(idx) || 0) + 1);
    }
    
    const sortedIndices = Array.from(indexCounts.entries())
      .filter(([idx]) => idx !== 0)
      .sort((a, b) => b[1] - a[1]);
    
    console.log("Top 20 most used palette indices and their colors:");
    for (const [idx, count] of sortedIndices.slice(0, 20)) {
      const color = originalPalette[idx];
      console.log(`  index=${idx.toString().padStart(3)} count=${count.toString().padStart(5)} color=[${color[0]}, ${color[1]}, ${color[2]}]`);
    }

    console.log("\n=== Testing with adjusted range [228, 240] ===");
    const adjustedRotations = [[228, 240], [242, 254]];
    let adjustedPalette = originalPalette.map((c) => [...c]);
    
    for (let step = 0; step < 8; step++) {
      const analysis = analyzeWhitePixels(frame, adjustedPalette);
      console.log(`Adjusted step ${step}: white=${analysis.whiteCount}/${analysis.totalNonTransparent} (${((analysis.whiteCount / analysis.totalNonTransparent) * 100).toFixed(1)}%)`);
      if (analysis.whiteIndices.length > 0) {
        console.log("  White at indices:", analysis.whiteIndices.slice(0, 5));
      }

      for (const [start, end] of adjustedRotations) {
        adjustedPalette = rotatePalette(adjustedPalette, start, end, true);
      }
    }

    console.log("\n=== Testing forward rotation (like Kotlin) ===");
    const rotations = PALETTE_ROTATIONS["WATRTL"];
    let forwardPalette = originalPalette.map((c) => [...c]);
    
    for (let step = 0; step < 8; step++) {
      const analysis = analyzeWhitePixels(frame, forwardPalette);
      console.log(`Forward step ${step}: white=${analysis.whiteCount}/${analysis.totalNonTransparent} (${((analysis.whiteCount / analysis.totalNonTransparent) * 100).toFixed(1)}%)`);
      if (analysis.whiteIndices.length > 0) {
        console.log("  White at indices:", analysis.whiteIndices.slice(0, 5));
        for (const idx of analysis.whiteIndices.slice(0, 2)) {
          console.log(`    index ${idx} color:`, forwardPalette[idx]);
        }
      }

      for (const [start, end] of rotations) {
        forwardPalette = rotatePalette(forwardPalette, start, end, false);
      }
    }

    console.log("\n=== Testing backward rotation (current) ===");
    let backwardPalette = originalPalette.map((c) => [...c]);
    
    for (let step = 0; step < 8; step++) {
      const analysis = analyzeWhitePixels(frame, backwardPalette);
      console.log(`Backward step ${step}: white=${analysis.whiteCount}/${analysis.totalNonTransparent} (${((analysis.whiteCount / analysis.totalNonTransparent) * 100).toFixed(1)}%)`);
      if (analysis.whiteIndices.length > 0) {
        console.log("  White at indices:", analysis.whiteIndices.slice(0, 5));
        for (const idx of analysis.whiteIndices.slice(0, 2)) {
          console.log(`    index ${idx} color:`, backwardPalette[idx]);
        }
      }

      for (const [start, end] of rotations) {
        backwardPalette = rotatePalette(backwardPalette, start, end, true);
      }
    }
  });

  it("should diagnose CLRRVR white pixel issue", () => {
    const data = readTestFile(TEST_FILES.LOD);
    const lodReader = new LodReader(data);
    const archive = lodReader.read();

    const entry = archive.files.find(
      (f) => f.name.toUpperCase() === "CLRRVR.DEF"
    );
    expect(entry).toBeDefined();

    const defData = lodReader.readFileContent(entry!);
    const defReader = new DefReader(defData);
    const sprite = defReader.read();

    const originalPalette = parsePalette(sprite.palette);
    const group = sprite.groups[0];
    const frame = group.frames[0];

    console.log("\n=== CLRRVR Palette Analysis ===");
    const rotations = PALETTE_ROTATIONS["CLRRVR"];
    console.log("Rotation ranges:", rotations);

    console.log("\nRange 1 [183-195]:");
    for (let i = 183; i <= 195; i++) {
      console.log(`  index ${i}:`, originalPalette[i]);
    }
    console.log("\nRange 2 [195-201]:");
    for (let i = 195; i <= 201; i++) {
      console.log(`  index ${i}:`, originalPalette[i]);
    }

    let rotatedPalette = originalPalette.map((c) => [...c]);
    for (let step = 0; step < 8; step++) {
      const analysis = analyzeWhitePixels(frame, rotatedPalette);
      console.log(`\nStep ${step}: white=${analysis.whiteCount}/${analysis.totalNonTransparent} (${((analysis.whiteCount / analysis.totalNonTransparent) * 100).toFixed(1)}%)`);
      if (analysis.whiteIndices.length > 0) {
        console.log("  White at indices:", analysis.whiteIndices.slice(0, 5));
        for (const idx of analysis.whiteIndices.slice(0, 2)) {
          console.log(`    index ${idx} color:`, rotatedPalette[idx]);
        }
      }

      for (const [start, end] of rotations) {
        rotatedPalette = rotatePalette(rotatedPalette, start, end, true);
      }
    }
  });
});