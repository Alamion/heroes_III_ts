export const TERRAIN_TYPES = {
  DIRT: { id: 0, name: "dirttl", color: "#3d7c3d", displayName: "Soil/Dirt" },
  SAND: { id: 1, name: "sandtl", color: "#4a8c4a", displayName: "Sand" },
  GRASS: { id: 2, name: "grastl", color: "#5c9c5c", displayName: "Grass" },
  SNOW: { id: 3, name: "snowtl", color: "#6cac6c", displayName: "Snow" },
  SWAMP: { id: 4, name: "swmptl", color: "#8cbc8c", displayName: "Swamp" },
  ROUGH: { id: 5, name: "rougtl", color: "#7c7474", displayName: "Rough/Rocks" },
  SUBTERRANEAN: { id: 6, name: "subbtl", color: "#8c8484", displayName: "Subterranean" },
  LAVA: { id: 7, name: "lavatl", color: "#9c9494", displayName: "Lava" },
  WATER: { id: 8, name: "watrtl", color: "#4c4c4c", displayName: "Water" },
  ROCK: { id: 9, name: "rocktl", color: "#5c5c5c", displayName: "Rock" },
  HIGHLAND: { id: 10, name: "highlnd", color: "#3d3d3d", displayName: "Highland" },
  WASTELAND: { id: 11, name: "wastlnd", color: "#6c6c6c", displayName: "Wasteland" },
} as const;

export type TerrainId = (typeof TERRAIN_TYPES)[keyof typeof TERRAIN_TYPES]["id"];

export const RIVER_TYPES = {
  CLEAR: { id: 0, name: "clrrvr" },
  ICE: { id: 1, name: "icrvr" },
  MUD: { id: 2, name: "mudrvr" },
  LAVA: { id: 3, name: "lavrvr" },
} as const;

export const ROAD_TYPES = {
  DIRT: { id: 1, name: "dirtrd" },
  GRAVEL: { id: 2, name: "gravrd" },
  COBBLE: { id: 3, name: "cobbrd" },
} as const;

export function getTerrainName(id: number): string {
  const entry = Object.entries(TERRAIN_TYPES).find(
    ([, v]) => v.id === id
  );
  return entry ? entry[1].name : "dirttl";
}

export function getTerrainColor(id: number): string {
  const entry = Object.entries(TERRAIN_TYPES).find(
    ([, v]) => v.id === id
  );
  return entry ? entry[1].color : "#000000";
}

export function getRiverName(id: number): string {
  const entry = Object.entries(RIVER_TYPES).find(([, v]) => v.id === id);
  return entry ? entry[1].name : "clrrvr";
}

export function getRoadName(id: number): string {
  const entry = Object.entries(ROAD_TYPES).find(([, v]) => v.id === id);
  return entry ? entry[1].name : "dirtrd";
}
