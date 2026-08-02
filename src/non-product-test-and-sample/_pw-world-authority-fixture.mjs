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

export function createNavigationResponse({
  characterId,
  displayName = "Playwright Pilot",
  shipDefinitionId = "ship_01",
  shipUid = `ship-${characterId}-${shipDefinitionId}-001`,
  position = null,
  rotation = { x: 0, y: 0, z: 0, w: 1 },
  speed = 0,
  desiredSpeed = 0,
  revision = 1,
  serverTime = Date.now(),
  activeContract = null
}) {
  const bounds = WORLD_TEMPLATE.sectors[0].global_bounds;
  const spawn = position || {
    x: (bounds.min.x + bounds.max.x) / 2,
    y: (bounds.min.y + bounds.max.y) / 2,
    z: (bounds.min.z + bounds.max.z) / 2
  };
  return {
    ok: true,
    navigation: {
      character_id: characterId,
      ship: {
        ship_uid: shipUid,
        world_id: "primary",
        owner_character_id: characterId,
        display_name: displayName,
        ship_definition_id: shipDefinitionId,
        spatial_mode: "FIELD",
        position: spawn,
        rotation,
        speed,
        desired_speed: desiredSpeed,
        sector_id: WORLD_TEMPLATE.sectors[0].sector_id,
        chunk_id: "31:31:31",
        phase: activeContract ? "cruising" : "manual",
        revision,
        checkpoint_at: serverTime,
        updated_at: serverTime
      },
      active_contract: activeContract,
      server_time: serverTime
    }
  };
}
