import { BUILDING_DEFINITIONS, BUILDING_IDS } from "./definitions/buildingDefinitions.js";
import { ITEM_DEFINITIONS, ITEM_IDS } from "./definitions/itemDefinitions.js";
import { RESOURCE_DEFINITIONS, RESOURCE_IDS } from "./definitions/resourceDefinitions.js";
import { SECTOR_DEFINITIONS, SECTOR_IDS } from "./definitions/sectorDefinitions.js";

export const WORLD_CONFIG = {
  dbName: "void-zero-world",
  dbVersion: 6,
  renderScale: 0.01,
  sectorSize: {
    x: 400000,
    y: 400000,
    z: 400000
  },
  chunkSize: {
    x: 400000,
    y: 400000,
    z: 400000
  },
  chunkGrid: {
    x: 10,
    y: 10,
    z: 10
  },
  renderChunkRadius: 2,
  resourceCheckInterval: 86400000,
  placementMargin: 800,
  resourceMinDistance: 1200,
  buildingMinDistance: 1600,
  buildingResourceMinDistance: 800
};

export {
  BUILDING_DEFINITIONS,
  BUILDING_IDS,
  ITEM_DEFINITIONS,
  ITEM_IDS,
  RESOURCE_DEFINITIONS,
  RESOURCE_IDS,
  SECTOR_DEFINITIONS,
  SECTOR_IDS
};

export const SECTOR_TEMPLATES = SECTOR_IDS.map((sectorId) => SECTOR_DEFINITIONS[sectorId]);
export const INITIAL_RESOURCE_TYPES = RESOURCE_IDS;
