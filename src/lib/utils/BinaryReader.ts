export class BinaryReader {
  protected data: Uint8Array;
  protected position = 0;

  constructor(data: Uint8Array) {
    this.data = data;
  }

  protected readBytes(length: number): Uint8Array {
    const result = this.data.slice(this.position, this.position + length);
    this.position += length;
    return result;
  }

  protected readByte(): number {
    return this.data[this.position++] & 0xff;
  }

  protected readInt(): number {
    const bytes = this.readBytes(4);
    return this.readLittleEndianInt(bytes, 0);
  }

  protected readShort(): number {
    const bytes = this.readBytes(2);
    return bytes[0] | (bytes[1] << 8);
  }

  protected readBool(): boolean {
    return this.readByte() !== 0;
  }

  protected readString(length: number): string {
    const bytes = this.readBytes(length);
    let result = "";
    for (let i = 0; i < length; i++) {
      if (bytes[i] === 0) break;
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }

  protected readPascalString(): string {
    const length = this.readInt();
    if (length <= 0 || length > 10000) {
      return "";
    }
    const bytes = this.readBytes(length);
    let result = "";
    for (let i = 0; i < bytes.length; i++) {
      result += String.fromCharCode(bytes[i]);
    }
    return result;
  }

  protected skip(bytes: number): void {
    this.position += bytes;
  }

  protected seek(position: number): void {
    this.position = position;
  }

  protected peekByte(): number | undefined {
    if (this.position >= this.data.length) return undefined;
    return this.data[this.position];
  }

  protected readLittleEndianInt(data: Uint8Array, offset: number): number {
    return (
      data[offset] |
      (data[offset + 1] << 8) |
      (data[offset + 2] << 16) |
      (data[offset + 3] << 24)
    );
  }

  protected arrayEquals(a: Uint8Array, b: number[]): boolean {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) return false;
    }
    return true;
  }
}
