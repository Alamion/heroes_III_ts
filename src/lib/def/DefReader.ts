import { BinaryReader } from "../utils/BinaryReader";
import type { DefSprite, DefFrame, DefGroup } from "./DefTypes";

const MAX_DIMENSION = 4096;
const MAX_GROUPS = 256;
const MAX_FRAMES_PER_GROUP = 10000;

export class DefReader extends BinaryReader {
  read(): DefSprite {
    const type = this.readInt();
    const fullWidth = this.readInt();
    const fullHeight = this.readInt();
    const groupsCount = this.readInt();

    if (groupsCount < 0 || groupsCount > MAX_GROUPS) {
      throw new Error(`Invalid groupsCount: ${groupsCount}`);
    }

    const palette = this.readBytes(256 * 3);

    const groupHeaders: GroupHeader[] = [];
    for (let i = 0; i < groupsCount; i++) {
      groupHeaders.push(this.readGroupHeader());
    }

    const groups: DefGroup[] = groupHeaders.map((header) =>
      this.readGroupFrames(header)
    );

    return { type, fullWidth, fullHeight, palette, groups };
  }

  private readGroupHeader(): GroupHeader {
    const groupType = this.readInt();
    const framesCount = this.readInt();

    if (framesCount < 0 || framesCount > MAX_FRAMES_PER_GROUP) {
      throw new Error(`Invalid framesCount: ${framesCount}`);
    }

    this.readBytes(8);

    const filenames: string[] = [];
    for (let i = 0; i < framesCount; i++) {
      filenames.push(this.readString(13));
    }

    const framesOffsets: number[] = [];
    for (let i = 0; i < framesCount; i++) {
      framesOffsets.push(this.readInt());
    }

    return { groupType, filenames, framesOffsets };
  }

  private readGroupFrames(header: GroupHeader): DefGroup {
    const frames: DefFrame[] = header.framesOffsets.map((offset, i) => {
      this.seek(offset);
      return this.readFrame(header.filenames[i]);
    });

    return {
      groupType: header.groupType,
      filenames: header.filenames,
      frames,
    };
  }

  private readFrame(frameName: string): DefFrame {
    this.readInt();
    const compression = this.readInt();
    const fullWidth = this.readInt();
    const fullHeight = this.readInt();
    let width = this.readInt();
    let height = this.readInt();
    let x = this.readInt();
    let y = this.readInt();

    let dataOffset = this.position;

    if (compression === 1 && width > fullWidth && height > fullHeight) {
      width = fullWidth;
      height = fullHeight;
      x = 0;
      y = 0;
      dataOffset = this.position - 16;
    }

    if (
      width < 0 ||
      width > MAX_DIMENSION ||
      height < 0 ||
      height > MAX_DIMENSION
    ) {
      throw new Error(`Invalid frame dimensions: ${width}x${height}`);
    }

    this.seek(dataOffset);

    const data = this.decompressFrame(compression, width, height, dataOffset);

    return {
      frameName,
      width,
      height,
      fullWidth,
      fullHeight,
      x,
      y,
      data,
    };
  }

  private decompressFrame(
    compression: number,
    width: number,
    height: number,
    dataOffset: number
  ): Uint8Array {
    switch (compression) {
      case 0:
        return this.decompressType0(width * height);
      case 1:
        return this.decompressType1(width, height, dataOffset);
      case 2:
        return this.decompressType2(width, height, dataOffset);
      case 3:
        return this.decompressType3(width, height, dataOffset);
      default:
        return this.decompressType0(width * height);
    }
  }

  private decompressType0(size: number): Uint8Array {
    return this.readBytes(size);
  }

  private decompressType1(
    width: number,
    height: number,
    dataOffset: number
  ): Uint8Array {
    const offsets: number[] = [];
    for (let i = 0; i < height; i++) {
      offsets.push(this.readInt());
    }

    const output: number[] = [];
    for (let row = 0; row < height; row++) {
      this.seek(dataOffset + offsets[row]);
      let left = width;
      while (left > 0) {
        const index = this.readByte();
        let length = this.readByte() + 1;
        if (index === 0xff) {
          for (let i = 0; i < length; i++) {
            output.push(this.readByte());
          }
        } else {
          for (let i = 0; i < length; i++) {
            output.push(index);
          }
        }
        left -= length;
      }
    }

    return new Uint8Array(output);
  }

  private decompressType2(
    width: number,
    height: number,
    dataOffset: number
  ): Uint8Array {
    const firstOffset = this.readShort();
    this.seek(dataOffset + firstOffset);

    const output: number[] = [];
    for (let i = 0; i < height; i++) {
      this.decodePackedRLELine(output, width);
    }

    return new Uint8Array(output);
  }

  private decompressType3(
    width: number,
    height: number,
    dataOffset: number
  ): Uint8Array {
    const blocksPerLine = Math.floor(width / 32);
    const output: number[] = [];

    for (let i = 0; i < height; i++) {
      this.seek(dataOffset + i * 2 * blocksPerLine);
      const lineOffset = this.readShort();
      this.seek(dataOffset + lineOffset);
      this.decodePackedRLELine(output, width);
    }

    return new Uint8Array(output);
  }

  private decodePackedRLELine(output: number[], lineWidth: number): void {
    let left = lineWidth;
    while (left > 0) {
      const code = this.readByte();
      const index = code >> 5;
      const length = (code & 0x1f) + 1;
      if (index === 7) {
        for (let i = 0; i < length; i++) {
          output.push(this.readByte());
        }
      } else {
        for (let i = 0; i < length; i++) {
          output.push(index);
        }
      }
      left -= length;
    }
  }
}

interface GroupHeader {
  groupType: number;
  filenames: string[];
  framesOffsets: number[];
}
