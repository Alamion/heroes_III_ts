import { ungzip } from "pako";
import { BinaryReader } from "../utils/BinaryReader";
import { H3mMap, H3mVersion, h3mVersionFromInt } from "./H3mTypes";
import type { H3mHeader, H3mTile, H3mDef, H3mObject } from "./H3mTypes";
import {debugError, debugLog} from "../utils/logs.ts";

export class H3mReader extends BinaryReader {
  private debugParser = true;

  constructor(gzippedData: Uint8Array) {
    let data: Uint8Array;
    try {
      data = ungzip(gzippedData);
    } catch (err) {
      debugError("Failed to ungzip H3M file:", err);
      throw new Error("Invalid H3M file: not gzip compressed");
    }
    super(data);
  }

  read(): H3mMap {
    if (this.debugParser) debugLog(`[H3M] Starting parse at position 0`);

    const version = this.readInt();
    if (this.debugParser) debugLog(`[H3M] After version read, position: ${this.position}`);

    const h3mVersion = h3mVersionFromInt(version);
    if (!h3mVersion) {
      throw new Error(`Unknown H3M version: ${version}`);
    }

    let hotaSubVersion = 0;
    if (h3mVersion === H3mVersion.HOTA) {
      hotaSubVersion = this.readInt();
    }

    debugLog(`H3M: version=${h3mVersion}, hotaSubVersion=${hotaSubVersion}`);

    const header = this.readHeader(h3mVersion, hotaSubVersion);
    if (this.debugParser) debugLog(`[H3M] After header, position: ${this.position}`);
    debugLog(`Header: size=${header.size}, underground=${header.hasUnderground}`);

    const tiles = this.readTerrain(header);
    if (this.debugParser) debugLog(`[H3M] After reading ${tiles.length} tiles, position: ${this.position}`);
    debugLog(`Tiles: ${tiles.length}, terrain types: ${[...new Set(tiles.map((t) => t.terrain))].sort()}`);

    const defs = this.readDefs();
    debugLog(`Defs: ${defs.length}`);

    const objects = this.readObjects(defs);
    debugLog(`Objects: ${objects.length}`);

    return new H3mMap(h3mVersion, hotaSubVersion, header, tiles, defs, objects);
  }

  private readHeader(version: H3mVersion, hotaSubVersion: number): H3mHeader {
    if (this.debugParser) debugLog(`[H3M] readHeader start, position: ${this.position}`);

    if (version === H3mVersion.HOTA) {
      this.skipHotaHeaderFields(hotaSubVersion);
    }

    if (this.debugParser) debugLog(`[H3M] after hotahdr, position: ${this.position}`);
    this.readByte();
    const size = this.readInt();
    const hasUnderground = this.readBool();
    this.readPascalString();
    this.readPascalString();
    this.readByte();

    if (version !== H3mVersion.ROE) {
      this.readByte();
    }

    if (this.debugParser) debugLog(`[H3M] before skipPlayerInfo, position: ${this.position}`);
    this.skipPlayerInfo(version, hotaSubVersion);
    if (this.debugParser) debugLog(`[H3M] after skipPlayerInfo, position: ${this.position}`);
    this.skipVictoryLossConditions();
    this.skipTeamInfo();
    this.skipAllowedHeroes(version);
    this.skipDisposedHeroes(version);
    this.skipMapOptions(version, hotaSubVersion);
    this.skipHotaScripts(version, hotaSubVersion);
    this.skipAllowedArtifacts(version);
    this.skipAllowedSpellsAbilities(version);
    this.skipRumors();
    this.skipPredefinedHeroes(version, hotaSubVersion);

    return { size, hasUnderground };
  }

  private skipHotaHeaderFields(hotaSubVersion: number): void {
    if (hotaSubVersion >= 8) this.skip(12);
    if (hotaSubVersion >= 1) this.skip(2);
    if (hotaSubVersion >= 2) this.skip(4);
    if (hotaSubVersion >= 5) this.skip(5);
    if (hotaSubVersion >= 7) this.skip(1);
    if (hotaSubVersion >= 8) this.skip(1);
    if (hotaSubVersion >= 9) this.skip(4);
  }

  private skipPlayerInfo(version: H3mVersion, _hotaSubVersion: number): void {
    for (let i = 0; i < 8; i++) {
      const canHumanPlay = this.readBool();
      const canPCPlay = this.readBool();

      if (!canHumanPlay && !canPCPlay) {
        const bytesToSkip = version === H3mVersion.HOTA ? 13
          : version === H3mVersion.SOD ? 13
          : version === H3mVersion.AB ? 12
          : 6;
        this.skip(bytesToSkip);
        continue;
      }

      this.skip(1);

      if (version === H3mVersion.SOD || version === H3mVersion.HOTA) {
        this.readBool();
      }

      if (version === H3mVersion.HOTA) {
        this.skip(2);
      } else {
        this.skip(1);
        if (version !== H3mVersion.ROE) {
          this.skip(1);
        }
      }

      this.readBool();
      const hasMainTown = this.readBool();
      if (hasMainTown) {
        if (version !== H3mVersion.ROE) {
          this.skip(2);
        }
        this.skip(3);
      }

      this.readBool();
      const heroId = this.readByte();
      if (heroId !== 0xff) {
        this.skip(1);
        this.readPascalString();
      }

      if (version !== H3mVersion.ROE) {
        this.skip(1);
        const heroCount = this.readInt();
        for (let k = 0; k < heroCount; k++) {
          this.skip(1);
          this.readPascalString();
        }
      }
    }
  }

  private skipVictoryLossConditions(): void {
    const victoryCondition = this.readByte();
    if (victoryCondition !== 0xff) {
      this.skip(2);
    }

    switch (victoryCondition) {
      case 0:
        this.skip(1);
        if (this.peekByte() !== undefined && this.peekByte()! < 10) this.skip(1);
        break;
      case 1:
        this.skip(1);
        if (this.peekByte() !== undefined && this.peekByte()! < 10) this.skip(1);
        this.skip(4);
        break;
      case 2:
      case 3:
        this.skip(5);
        break;
      case 4:
      case 5:
      case 6:
      case 7:
        this.skip(3);
        break;
      case 10:
      case 12:
        this.skip(4);
        break;
    }

    const lossCondition = this.readByte();
    switch (lossCondition) {
      case 0:
      case 1:
        this.skip(3);
        break;
      case 2:
        this.skip(2);
        break;
    }
  }

  private skipTeamInfo(): void {
    const teamsCount = this.readByte();
    if (teamsCount > 0) {
      this.skip(8);
    }
  }

  private skipAllowedHeroes(version: H3mVersion): void {
    if (version === H3mVersion.HOTA) {
      const heroesCount = this.readInt();
      this.skip(Math.ceil(heroesCount / 8));
    } else {
      const bytesCount = version === H3mVersion.ROE ? 16 : 20;
      this.skip(bytesCount);
    }

    if (version !== H3mVersion.ROE) {
      const placeholderCount = this.readInt();
      this.skip(placeholderCount);
    }
  }

  private skipDisposedHeroes(version: H3mVersion): void {
    if (version === H3mVersion.SOD || version === H3mVersion.HOTA) {
      const heroesCount = this.readByte();
      for (let i = 0; i < heroesCount; i++) {
        this.skip(1);
        this.skip(1);
        this.readPascalString();
        this.skip(1);
      }
    }
    this.skip(31);
  }

  private skipMapOptions(version: H3mVersion, hotaSubVersion: number): void {
    if (version !== H3mVersion.HOTA) return;
    if (hotaSubVersion >= 0) this.skip(4);
    if (hotaSubVersion >= 1) {
      const combinedArtCount = this.readInt();
      this.skip(Math.ceil(combinedArtCount / 8));
    }
    if (hotaSubVersion >= 3) this.skip(4);
    if (hotaSubVersion >= 5) this.skip(8);
  }

  private skipHotaScripts(version: H3mVersion, hotaSubVersion: number): void {
    if (version !== H3mVersion.HOTA || hotaSubVersion < 9) return;
    const eventsSystemActive = this.readBool();
    if (!eventsSystemActive) return;
    this.skip(20);
    const variablesCount = this.readInt();
    this.skip(variablesCount * 20);
    for (let i = 0; i < 5; i++) {
      const mappingSize = this.readInt();
      this.skip(mappingSize * 4);
    }
  }

  private skipAllowedArtifacts(version: H3mVersion): void {
    if (version === H3mVersion.ROE) return;
    if (version === H3mVersion.HOTA) {
      const artifactsCount = this.readInt();
      this.skip(Math.ceil(artifactsCount / 8));
    } else {
      const bytesCount = version === H3mVersion.AB ? 17 : 18;
      this.skip(bytesCount);
    }
  }

  private skipAllowedSpellsAbilities(version: H3mVersion): void {
    if (version === H3mVersion.SOD || version === H3mVersion.HOTA) {
      this.skip(9);
      this.skip(4);
    }
  }

  private skipRumors(): void {
    const rumorsCount = this.readInt();
    for (let i = 0; i < rumorsCount; i++) {
      this.readPascalString();
      this.readPascalString();
    }
  }

  private skipPredefinedHeroes(version: H3mVersion, hotaSubVersion: number): void {
    if (version !== H3mVersion.SOD && version !== H3mVersion.HOTA) return;

    const heroesCount = version === H3mVersion.HOTA ? this.readInt() : 156;

    for (let i = 0; i < heroesCount; i++) {
      if (!this.readBool()) continue;
      if (this.readBool()) this.skip(4);
      if (this.readBool()) {
        const skillsCount = this.readInt();
        this.skip(skillsCount * 2);
      }
      this.skipArtifacts();
      if (this.readBool()) this.readPascalString();
      this.skip(1);
      if (this.readBool()) this.skip(9);
      if (this.readBool()) this.skip(4);
    }

    if (version === H3mVersion.HOTA && hotaSubVersion >= 5) {
      this.skip(heroesCount * 6);
    }
  }

  private skipArtifacts(): void {
    if (this.peekByte() === undefined) return;
    const slotCount = 17;
    for (let i = 0; i < slotCount; i++) {
      this.skip(this.peekByte()! < 128 ? 1 : 2);
    }
    if (this.peekByte() !== undefined) {
      this.skip(this.peekByte()! < 128 ? 1 : 2);
    }
    const artsCount = this.readShort();
    this.skip(artsCount * (this.peekByte()! < 128 ? 1 : 2));
  }

  private readTerrain(header: H3mHeader): H3mTile[] {
    const undergroundMultiplier = header.hasUnderground ? 2 : 1;
    const size = header.size * header.size * undergroundMultiplier;
    const tiles: H3mTile[] = [];

    debugLog(`[readTerrain] reading tiles, size=${size}, hasUnderground=${header.hasUnderground}`);

    for (let i = 0; i < size; i++) {
      tiles.push(this.readTile());
    }

    debugLog(`[readTerrain] First 3 terrains: ${tiles.slice(0, 3).map((t) => t.terrain)}`);
    debugLog(`[readTerrain] At position after tiles: ${this.position}`);

    return tiles;
  }

  private readTile(): H3mTile {
    const terrain = this.readByte();
    const terrainIndex = this.readByte();
    const river = this.readByte();
    const riverIndex = this.readByte();
    const road = this.readByte();
    const roadIndex = this.readByte();
    const mirrorConfig = this.readByte();
    const coast = (mirrorConfig & 0x40) !== 0;

    return { terrain, terrainIndex, river, riverIndex, road, roadIndex, mirrorConfig, coast };
  }

  private readDefs(): H3mDef[] {
    const defsCount = this.readInt();
    debugLog(`[readDefs] defsCount = ${defsCount}, position = ${this.position}`);
    const defs: H3mDef[] = [];

    for (let i = 0; i < defsCount; i++) {
      const spriteName = this.readPascalString();
      const passableCells: [number, number] = [this.readInt(), this.readShort()];
      const activeCells: [number, number] = [this.readInt(), this.readShort()];
      this.readShort() // terrainType
      this.readShort() // terrainGroup
      const objectId = this.readInt();
      const objectClassSubId = this.readInt();
      this.readByte() // objectsGroup
      const placementOrder = this.readByte();
      this.readBytes(16) // placeholder

      defs.push({ spriteName, passableCells, activeCells, placementOrder, objectId, objectClassSubId });
    }

    debugLog(`[readDefs] total entries=${defs.length}, position now=${this.position}`);

    return defs;
  }

  private readObjects(defs: H3mDef[]): H3mObject[] {
    const rawCount = this.readInt();
    const objectsCount = rawCount - 1;
    debugLog(`[readObjects] raw count = ${rawCount}, objectsCount = ${objectsCount}, position = ${this.position}`);
    const objects: H3mObject[] = [];

    let hasInvalidIndex = false;

    for (let objectIndex = 0; objectIndex <= objectsCount; objectIndex++) {
      const x = this.readByte();
      const y = this.readByte();
      const z = this.readByte();
      const index = this.readInt();

      const isSpecialMarker = x === 255 || y === 255;
      
      if (isSpecialMarker) {
        this.skip(5);
        continue;
      }

      if (index < 0 || index >= defs.length) {
        debugError(`Invalid def index ${index} at object ${objectIndex}, defs have ${defs.length} entries, stopping`);
        hasInvalidIndex = true;
        break;
      }

      const def = defs[index];
      this.readObjectData(def.objectId, def.objectClassSubId);

      objects.push({ x, y, z, def, objectType: def.objectId });
    }

    debugLog(`[readObjects] parsed ${objects.length} objects${hasInvalidIndex ? ' (stopped early)' : ''}, position now=${this.position}`);
    return objects;
  }

  private readObjectData(_objectId: number, _objectClassSubId: number): number {
    const startPos = this.position;
    this.skip(5);
    return this.position - startPos;
  }
}
