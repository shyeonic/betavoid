import { WORLD_TEMPLATE } from "../workers/beta-void-api/src/generated/world-template.js";

export function withWorldAuthoritySnapshot(world) {
  return {
    ...world,
    snapshot: {
      sectors: WORLD_TEMPLATE.sectors,
      resource_nodes: WORLD_TEMPLATE.resourceNodes,
      buildings: WORLD_TEMPLATE.buildings,
      beta_voids: WORLD_TEMPLATE.betaVoids,
      resource_manager: WORLD_TEMPLATE.resourceManager,
      building_storages: WORLD_TEMPLATE.buildingStorages
    }
  };
}
