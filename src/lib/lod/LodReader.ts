import { unzlibSync } from "fflate";
import { BinaryReader } from "../utils/BinaryReader";
import { LodArchive, lodFileTypeFromInt } from "./LodArchive";
import type { LodEntry } from "./LodArchive";
import {debugError, debugLog} from "../utils/logs.ts";

const LOD_MAGIC = [0x4c, 0x4f, 0x44, 0x00, 0xc8, 0x00, 0x00, 0x00];

export class LodReader extends BinaryReader {
  constructor(data: Uint8Array) {
    super(data);
  }

  read(): LodArchive {
    const magic = this.readBytes(8);
    if (!this.arrayEquals(magic, LOD_MAGIC)) {
      throw new Error("Invalid LOD magic header");
    }

    const filesCount = this.readInt();
    const key = this.readBytes(4);
    const isHota18 = key[0] === 135;

    debugLog(`LOD: ${filesCount} files, isHota18=${isHota18}`);

    if (isHota18) {
      this.skip(64);
      const files: LodEntry[] = [];
      for (let i = 0; i < filesCount; i++) {
        files.push(this.readHota18Entry(key));
      }
      return new LodArchive(files, true);
    } else {
      this.skip(76);
      const files: LodEntry[] = [];
      for (let i = 0; i < filesCount; i++) {
        files.push(this.readEntry());
      }
      return new LodArchive(files, false);
    }
  }

  readFileContent(entry: LodEntry): Uint8Array {
    this.seek(entry.offset);

    if (entry.compressedSize === 0 || entry.compressionMethod === 0) {
      return this.readBytes(entry.size);
    }

    if (entry.compressedSize >= entry.size) {
      return this.readBytes(entry.size);
    }

    const raw = this.readBytes(entry.compressedSize);

    switch (entry.compressionMethod) {
      case 2:
        return this.decompressLzma(raw);
      case 3:
        return this.decompressZlib(raw);
      default:
        return raw;
    }
  }

  readFileContentPartial(entry: LodEntry, limit: number): Uint8Array {
    this.seek(entry.offset);

    if (entry.compressedSize === 0 || entry.compressionMethod === 0) {
      return this.readBytes(Math.min(entry.size, limit));
    }

    if (entry.compressedSize >= entry.size) {
      return this.readBytes(Math.min(entry.size, limit));
    }

    const raw = this.readBytes(entry.compressedSize);

    switch (entry.compressionMethod) {
      case 2:
        return this.decompressLzma(raw).slice(0, limit);
      case 3:
        return this.decompressZlib(raw).slice(0, limit);
      default:
        return raw.slice(0, Math.min(raw.length, limit));
    }
  }

  private decompressZlib(data: Uint8Array): Uint8Array {
    debugLog(`zlib decompress: input size=${data.length}`);
    try {
      const result = unzlibSync(data);
      debugLog(`zlib success: output size=${result.length}`);
      return result;
    } catch (err) {
      debugError("zlib decompression error:", err);
      throw err;
    }
  }

  private decompressLzma(data: Uint8Array): Uint8Array {
    debugLog("LZMA decompression not fully implemented, returning raw data");
    return data;
  }

  private readEntry(): LodEntry {
    const name = this.readString(16);
    const offset = this.readInt();
    const size = this.readInt();
    const fileTypeInt = this.readInt();
    const compressedSize = this.readInt();

    return {
      name,
      offset,
      size,
      fileType: lodFileTypeFromInt(fileTypeInt),
      compressedSize,
      compressionMethod: 3,
    };
  }

  private readHota18Entry(key: Uint8Array): LodEntry {
    this.readBytes(16);
    const encrypted = this.readBytes(16);

    const decrypted = new Uint8Array(16);
    for (let i = 0; i < 16; i++) {
      decrypted[i] = encrypted[i] ^ key[i % 4];
    }

    const offset = this.readLittleEndianInt(decrypted, 0);
    const size = this.readLittleEndianInt(decrypted, 4);
    const compressedSize = this.readLittleEndianInt(decrypted, 8);
    const compressionMethod = encrypted[12] & 0xff;

    const hexName = Array.from(encrypted.subarray(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");

    return {
      name: hexName,
      offset,
      size,
      fileType: null,
      compressedSize,
      compressionMethod,
    };
  }
}
