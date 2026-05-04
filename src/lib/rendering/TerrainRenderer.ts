import * as PIXI from "pixi.js";
import type { H3mMap, H3mTile } from "../h3m/H3mTypes";
import { getTerrainColor, getTerrainName, getRiverName, getRoadName } from "../terrain/TerrainTypes";

import { debugLog } from "../utils/logs.ts";

const TILE_SIZE = 48;
const FRAME_TIME = 225;
const MAP_GAP = 2;
const MAX_ANIMATION_TIME = 60000;

interface AnimatedSprite {
  sprite: PIXI.Sprite;
  textures: PIXI.Texture[];
  variantKey: string;
  layerType: "terrain" | "river" | "road";
}

export interface TerrainTextureSet {
  terrain: PIXI.Texture[];
  river: PIXI.Texture[];
  road: PIXI.Texture[];
}

export interface DefInfo {
  name: string;
  layer: "terrain" | "river" | "road";
  frameCount: number;
}

export class TerrainRenderer {
  private app: PIXI.Application;
  private map: H3mMap | null = null;
  private terrainTextures: Map<string, TerrainTextureSet> = new Map();
  private defList: DefInfo[] = [];
  private terrainContainer: PIXI.Container;
  private riverContainer: PIXI.Container;
  private roadContainer: PIXI.Container;
  private debugContainer: PIXI.Container;
  private animationTime = 0;
  private animatedSprites: AnimatedSprite[] = [];

  constructor() {
    this.app = new PIXI.Application({
      width: window.innerWidth,
      height: window.innerHeight,
      backgroundColor: 0x1099bb,
      antialias: true,
    });

    this.terrainContainer = new PIXI.Container();
    this.riverContainer = new PIXI.Container();
    this.roadContainer = new PIXI.Container();
    this.debugContainer = new PIXI.Container();

    this.app.stage.addChild(this.terrainContainer);
    this.app.stage.addChild(this.riverContainer);
    this.app.stage.addChild(this.roadContainer);
    this.app.stage.addChild(this.debugContainer);

    document.body.appendChild(this.app.view as HTMLCanvasElement);
    debugLog(`[TerrainRenderer] Created and appended canvas to document`);
  }

  getCanvas(): HTMLCanvasElement {
    return this.app.view as HTMLCanvasElement;
  }

  setMap(map: H3mMap): void {
    this.map = map;
    this.render();
  }

  setTextures(textures: Map<string, TerrainTextureSet>): void {
    this.terrainTextures = textures;
    debugLog(`[TerrainRenderer] Received ${textures.size} texture sets:`,textures);
    this.render();
  }

  setDefList(defList: DefInfo[]): void {
    this.defList = defList;
    this.renderDebugView();
  }

  private update = (delta: number): void => {
    this.animationTime += delta * (1000 / 60);
    if (this.animationTime >= MAX_ANIMATION_TIME) {
      this.animationTime = 0;
    }

    for (const anim of this.animatedSprites) {
      if (anim.textures.length > 1) {
        const frame = Math.floor(this.animationTime / FRAME_TIME) % anim.textures.length;
        anim.sprite.texture = anim.textures[frame];
      }
    }
  };

  start(): void {
    this.app.ticker.add(this.update);
  }

  private getKey(defName: string, index: number): string {
    return `${defName}${index.toString().padStart(2, "0")}`;
  }

  private render(): void {
    if (!this.map) {
      debugLog(`[TerrainRenderer] render: no map yet`);
      return;
    }

    this.terrainContainer.removeChildren();
    this.riverContainer.removeChildren();
    this.roadContainer.removeChildren();
    this.animatedSprites = [];

    const mapSize = this.map.header.size;
    const hasUnderground = this.map.header.hasUnderground;

    const mapWidth = mapSize * TILE_SIZE;
    const mapHeight = mapSize * TILE_SIZE;

    const upperWorldX = 0;
    const gapSize = MAP_GAP * TILE_SIZE;

    this.app.renderer.resize(mapWidth * 2 + gapSize * 3, mapHeight * 2 + gapSize * 2);

    const upperOffset = 0;
    const lowerOffset = hasUnderground ? mapSize * mapSize : -1;

    for (let y = 0; y < mapSize; y++) {
      for (let x = 0; x < mapSize; x++) {
        const upperIndex = upperOffset + mapSize * y + x;
        const upperTile = this.map.tiles[upperIndex];

        const screenX = upperWorldX + x * TILE_SIZE;
        const screenY = y * TILE_SIZE;

        this.renderTileLayer(upperTile, screenX, screenY, this.terrainContainer);
        this.renderTileLayer(upperTile, screenX, screenY, this.riverContainer, "river");
        this.renderTileLayer(upperTile, screenX, screenY, this.roadContainer, "road");

        if (hasUnderground) {
          const lowerIndex = lowerOffset + mapSize * y + x;
          const lowerTile = this.map.tiles[lowerIndex];

          const lowerScreenX = upperWorldX + mapSize * TILE_SIZE + gapSize + x * TILE_SIZE;
          const lowerScreenY = y * TILE_SIZE;

          this.renderTileLayer(lowerTile, lowerScreenX, lowerScreenY, this.terrainContainer);
          this.renderTileLayer(lowerTile, lowerScreenX, lowerScreenY, this.riverContainer, "river");
          this.renderTileLayer(lowerTile, lowerScreenX, lowerScreenY, this.roadContainer, "road");
        }
      }
    }

    debugLog(
      `[TerrainRenderer] Rendered ${mapSize}x${mapSize} upper${hasUnderground ? " + underground" : ""}`
    );

    this.renderDebugView();
  }

  private renderTileLayer(
    tile: H3mTile,
    screenX: number,
    screenY: number,
    container: PIXI.Container,
    layer: "terrain" | "river" | "road" = "terrain"
  ): void {
    let defName: string;
    let index: number;
    let mirrorOffset: number;

    switch (layer) {
      case "river":
        if (!tile.river) return;
        defName = getRiverName(tile.river);
        index = tile.riverIndex;
        mirrorOffset = 2;
        break;
      case "road":
        if (!tile.road) return;
        defName = getRoadName(tile.road);
        index = tile.roadIndex;
        mirrorOffset = 4;
        break;
      default:
        defName = getTerrainName(tile.terrain);
        index = tile.terrainIndex;
        mirrorOffset = 0;
    }

    const key = this.getKey(defName, index);
    const textureSet = this.terrainTextures.get(key);

    let textures: PIXI.Texture[] | undefined;
    if (layer === "river") {
      textures = textureSet?.river;
    } else if (layer === "road") {
      textures = textureSet?.road;
    } else {
      textures = textureSet?.terrain;
    }

    const sprite = new PIXI.Sprite();

    if (screenX == 0) debugLog(`X: ${screenX/32} Y: ${screenY/32} Def: ${defName} Index: ${index} textureSet: ${key}`);

    if (textures && textures.length > 0) {
      sprite.texture = textures[0];

      if (textures.length > 1) {
        this.animatedSprites.push({
          sprite,
          textures,
          variantKey: key,
          layerType: layer,
        });
      }
    } else if (layer === "terrain") {
      const color = parseInt(getTerrainColor(tile.terrain).slice(1), 16);
      const graphics = new PIXI.Graphics();
      graphics.beginFill(color);
      graphics.drawRect(0, 0, TILE_SIZE, TILE_SIZE);
      graphics.endFill();
      sprite.texture = this.app.renderer.generateTexture(graphics);
    } else {
      return;
    }

    sprite.anchor.set(0.5);
    const flipX = (tile.mirrorConfig & (1 << mirrorOffset)) ? -1 : 1;
    const flipY = (tile.mirrorConfig & (1 << (mirrorOffset + 1))) ? -1 : 1;
    sprite.scale.set(TILE_SIZE / Math.max(sprite.texture.width) * flipX, TILE_SIZE / Math.max(sprite.texture.height) * flipY);

    sprite.x = screenX + TILE_SIZE / 2;
    sprite.y = screenY + TILE_SIZE / 2;

    container.addChild(sprite);
  }

  private renderDebugView(): void {
    this.debugContainer.removeChildren();

    if (this.defList.length === 0) return;

    const startY = (this.map!.header.size * TILE_SIZE) + (MAP_GAP * 2 * TILE_SIZE);
    let currentY = startY;
    const tileGap = TILE_SIZE / 2;

    const titleStyle = new PIXI.TextStyle({
      fontFamily: "monospace",
      fontSize: 14,
      fill: "#ffffff",
    });

    const defTitle = new PIXI.Text("=== DEF Texture Atlas ===", titleStyle);
    defTitle.x = 10;
    defTitle.y = currentY;
    this.debugContainer.addChild(defTitle);
    currentY += 24;

    const MAX_PER_ROW = 40;

    for (const def of this.defList) {
      const labelStyle = new PIXI.TextStyle({
        fontFamily: "monospace",
        fontSize: 12,
        fill: "#ffff00",
      });

      const label = new PIXI.Text(`${def.name} (${def.layer}): ${def.frameCount} variants`, labelStyle);
      label.x = 10;
      label.y = currentY;
      this.debugContainer.addChild(label);
      currentY += 18;

      const allKeys: string[] = [];
      for (let i = 0; i < def.frameCount; i++) {
        allKeys.push(`${def.name.toLowerCase()}${i.toString().padStart(2, "0")}`);
      }

      let textureX = 10;
      let rowCount = 0;

      for (const key of allKeys) {
        const textureSet = this.terrainTextures.get(key);
        let textures: PIXI.Texture[] | undefined;

        if (def.layer === "terrain") {
          textures = textureSet?.terrain;
        } else if (def.layer === "river") {
          textures = textureSet?.river;
        } else {
          textures = textureSet?.road;
        }

        if (textures && textures.length > 0) {
          const sprite = new PIXI.Sprite(textures[0]);
          sprite.x = textureX;
          sprite.y = currentY;
          sprite.scale.set(TILE_SIZE / Math.max(textures[0].width, textures[0].height));
          this.debugContainer.addChild(sprite);

          if (textures.length > 1) {
            this.animatedSprites.push({
              sprite,
              textures,
              variantKey: key,
              layerType: def.layer as "terrain" | "river" | "road",
            });
          }

          textureX += TILE_SIZE + TILE_SIZE/16;
          rowCount++;

          if (rowCount >= MAX_PER_ROW) {
            textureX = 10;
            currentY += TILE_SIZE + TILE_SIZE/16;
            rowCount = 0;
          }
        }
      }

      currentY += TILE_SIZE + tileGap;
    }

    this.app.renderer.resize(
      Math.max(window.innerWidth, (this.map!.header.size * TILE_SIZE) * 2 + MAP_GAP * 2 * TILE_SIZE),
      Math.max(window.innerHeight, currentY + 100)
    );
  }

  destroy(): void {
    this.app.ticker.remove(this.update);
    this.app.destroy(true, { children: true, texture: true });
  }
}
