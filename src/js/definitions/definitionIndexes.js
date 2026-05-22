import { BUILDING_DEFINITIONS, BUILDING_IDS } from "./buildingDefinitions.js";
import { ITEM_DEFINITIONS, ITEM_IDS } from "./itemDefinitions.js";
import { RESOURCE_DEFINITIONS, RESOURCE_IDS } from "./resourceDefinitions.js";
import { SECTOR_DEFINITIONS, SECTOR_IDS } from "./sectorDefinitions.js";

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

export function getItemDefinition(itemId) {
  return ITEM_DEFINITIONS[itemId] || null;
}

export function getResourceDefinition(resourceId) {
  return RESOURCE_DEFINITIONS[resourceId] || null;
}

export function getBuildingDefinition(buildingId) {
  return BUILDING_DEFINITIONS[buildingId] || null;
}

export function getSectorDefinition(sectorId) {
  return SECTOR_DEFINITIONS[sectorId] || null;
}

export function validateDefinitionCatalog() {
  const errors = [];

  for (const itemId of ITEM_IDS) {
    const item = ITEM_DEFINITIONS[itemId];
    if (item.item_id !== itemId) errors.push(`Item key mismatch: ${itemId}`);
  }

  for (const resourceId of RESOURCE_IDS) {
    const resource = RESOURCE_DEFINITIONS[resourceId];
    if (resource.resource_id !== resourceId) errors.push(`Resource key mismatch: ${resourceId}`);
    if (!ITEM_DEFINITIONS[resource.produces_item_id]) {
      errors.push(`Resource ${resourceId} references missing item ${resource.produces_item_id}`);
    }
  }

  for (const buildingId of BUILDING_IDS) {
    const building = BUILDING_DEFINITIONS[buildingId];
    if (building.building_id !== buildingId) errors.push(`Building key mismatch: ${buildingId}`);
  }

  for (const sectorId of SECTOR_IDS) {
    const sector = SECTOR_DEFINITIONS[sectorId];
    if (sector.sector_id !== sectorId) errors.push(`Sector key mismatch: ${sectorId}`);
    if (!sector.theme_music_id) errors.push(`Sector ${sectorId} is missing theme_music_id`);

    for (const resourceId of Object.keys(sector.resource_weights || {})) {
      if (!RESOURCE_DEFINITIONS[resourceId]) {
        errors.push(`Sector ${sectorId} references missing resource ${resourceId}`);
      }
    }

    for (const entry of sector.initial_buildings || []) {
      if (!BUILDING_DEFINITIONS[entry.building_id]) {
        errors.push(`Sector ${sectorId} references missing building ${entry.building_id}`);
      }
    }

    for (const entry of sector.initial_resource_facilities || []) {
      if (!BUILDING_DEFINITIONS[entry.building_id]) {
        errors.push(`Sector ${sectorId} references missing resource facility ${entry.building_id}`);
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors
  };
}
