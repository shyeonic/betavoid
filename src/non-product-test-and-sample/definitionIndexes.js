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
    if (!item.label_key) errors.push(`Item ${itemId} is missing label_key`);
    if (!item.description_key) errors.push(`Item ${itemId} is missing description_key`);
  }

  for (const resourceId of RESOURCE_IDS) {
    const resource = RESOURCE_DEFINITIONS[resourceId];
    if (resource.resource_id !== resourceId) errors.push(`Resource key mismatch: ${resourceId}`);
    if (!resource.label_key) errors.push(`Resource ${resourceId} is missing label_key`);
    if (!resource.description_key) errors.push(`Resource ${resourceId} is missing description_key`);
    if (!ITEM_DEFINITIONS[resource.produces_item_id]) {
      errors.push(`Resource ${resourceId} references missing item ${resource.produces_item_id}`);
    }
  }

  for (const buildingId of BUILDING_IDS) {
    const building = BUILDING_DEFINITIONS[buildingId];
    if (building.building_id !== buildingId) errors.push(`Building key mismatch: ${buildingId}`);
    if (!building.label_key) errors.push(`Building ${buildingId} is missing label_key`);
    if (!building.description_key) errors.push(`Building ${buildingId} is missing description_key`);
    if (!["EX", "L", "M", "S"].includes(building.size)) {
      errors.push(`Building ${buildingId} has invalid size ${building.size}`);
    }
    if (!building.size_key) errors.push(`Building ${buildingId} is missing size_key`);
    if (!building.category) errors.push(`Building ${buildingId} is missing category`);
    if (!building.category_key) errors.push(`Building ${buildingId} is missing category_key`);
    validateBuildingProductionProfile(building, errors);
  }

  for (const sectorId of SECTOR_IDS) {
    const sector = SECTOR_DEFINITIONS[sectorId];
    if (sector.sector_id !== sectorId) errors.push(`Sector key mismatch: ${sectorId}`);
    if (!sector.label_key) errors.push(`Sector ${sectorId} is missing label_key`);
    if (!sector.theme_key) errors.push(`Sector ${sectorId} is missing theme_key`);
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

function validateBuildingProductionProfile(building, errors) {
  const profile = building.production_profile;
  if (!profile) return;

  const validKinds = new Set(["SELF", "RESOURCE_EXTRACTOR", "FACTORY"]);
  if (!validKinds.has(profile.kind)) {
    errors.push(`Building ${building.building_id} has invalid production_profile.kind ${profile.kind}`);
    return;
  }

  if (!profile.output_sink) {
    errors.push(`Building ${building.building_id} production_profile is missing output_sink`);
  }

  if (profile.kind === "SELF") {
    if (profile.recipe_id) {
      errors.push(`Building ${building.building_id} SELF production_profile must not define recipe_id`);
    }
    if (!Array.isArray(profile.outputs) || profile.outputs.length === 0) {
      errors.push(`Building ${building.building_id} SELF production_profile requires outputs`);
    }
    return;
  }

  if (profile.kind === "RESOURCE_EXTRACTOR") {
    if (profile.recipe_id) {
      errors.push(`Building ${building.building_id} RESOURCE_EXTRACTOR production_profile must not define recipe_id`);
    }
    if (building.placement_rule?.type !== "resource_node") {
      errors.push(`Building ${building.building_id} RESOURCE_EXTRACTOR requires resource_node placement_rule`);
    }
    if (profile.source?.type !== "attached_resource_node") {
      errors.push(`Building ${building.building_id} RESOURCE_EXTRACTOR requires attached_resource_node source`);
    }
    return;
  }

  if (!profile.recipe_id) {
    errors.push(`Building ${building.building_id} FACTORY production_profile requires recipe_id`);
  }
}
