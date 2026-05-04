export type LodEntry = {
  name: string;
  offset: number;
  size: number;
  fileType: LodFileType | null;
  compressedSize: number;
  compressionMethod: number;
};

export const LodFileType = {
  SPELL: 0x40,
  SPRITE: 0x41,
  CREATURE: 0x42,
  MAP: 0x43,
  MAP_HERO: 0x44,
  TERRAIN: 0x45,
  CURSOR: 0x46,
  INTERFACE: 0x47,
  SPRITE_FRAME: 0x48,
  BATTLE_HERO: 0x49,
} as const;

export type LodFileType =
  (typeof LodFileType)[keyof typeof LodFileType];

export function lodFileTypeFromInt(
  value: number
): (typeof LodFileType)[keyof typeof LodFileType] | null {
  const types = Object.values(LodFileType).filter(
    (v) => typeof v === "number"
  ) as number[];
  return types.includes(value) ? (value as LodFileType) : null;
}

export class LodArchive {
  files: LodEntry[];
  isHota18: boolean;

  constructor(files: LodEntry[], isHota18: boolean = false) {
    this.files = files;
    this.isHota18 = isHota18;
  }
}
