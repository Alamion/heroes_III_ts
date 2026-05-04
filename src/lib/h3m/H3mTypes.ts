export const H3mVersion = {
  ROE: 0x0e,
  AB: 0x15,
  SOD: 0x1c,
  HOTA: 0x20,
} as const;

export type H3mVersion = (typeof H3mVersion)[keyof typeof H3mVersion];

export function h3mVersionFromInt(value: number): H3mVersion | null {
  const versions = Object.values(H3mVersion).filter(
    (v) => typeof v === "number"
  ) as number[];
  return versions.includes(value) ? (value as H3mVersion) : null;
}

export type H3mHeader = {
  size: number;
  hasUnderground: boolean;
  title?: string;
  description?: string;
};

export type H3mTile = {
  terrain: number;
  terrainIndex: number;
  river: number;
  riverIndex: number;
  road: number;
  roadIndex: number;
  mirrorConfig: number;
  coast: boolean;
};

export type H3mDef = {
  spriteName: string;
  passableCells: [number, number];
  activeCells: [number, number];
  placementOrder: number;
  objectId: number;
  objectClassSubId: number;
};

export type H3mObject = {
  x: number;
  y: number;
  z: number;
  def: H3mDef;
  objectType: number;
};

export class H3mMap {
  version: H3mVersion;
  hotaSubVersion: number;
  header: H3mHeader;
  tiles: H3mTile[];
  defs: H3mDef[];
  objects: H3mObject[];

  constructor(
    version: H3mVersion,
    hotaSubVersion: number,
    header: H3mHeader,
    tiles: H3mTile[],
    defs: H3mDef[],
    objects: H3mObject[]
  ) {
    this.version = version;
    this.hotaSubVersion = hotaSubVersion;
    this.header = header;
    this.tiles = tiles;
    this.defs = defs;
    this.objects = objects;
  }
}
