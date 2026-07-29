import {
  getOrCreateWorldState,
  getWorldAdminSummary,
  listWorldAdminEntities,
  rebuildWorldState
} from "../src/world-state.js";
import {
  checkpointPlayerShip,
  getPlayerNavigationState,
  listZoneShipPeers,
  overridePlayerNavigation,
  startPlayerNavigation
} from "../src/navigation-state.js";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/state") {
        return json(await getOrCreateWorldState(env.WORLD_DB));
      }
      if (request.method === "GET" && url.pathname === "/summary") {
        return json(await getWorldAdminSummary(env.WORLD_DB));
      }
      if (request.method === "GET" && url.pathname === "/entities") {
        return json(await listWorldAdminEntities(env.WORLD_DB, {
          entityType: url.searchParams.get("entity_type"),
          sectorId: url.searchParams.get("sector_id"),
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit")
        }));
      }
      if (request.method === "POST" && url.pathname === "/rebuild") {
        const body = await request.json();
        return json(await rebuildWorldState(env.WORLD_DB, {
          expectedRevision: body.expected_revision
        }));
      }
      if (request.method === "GET" && url.pathname === "/navigation") {
        return json(await getPlayerNavigationState(
          env.WORLD_DB,
          navigationContext(
            url.searchParams.get("character_id"),
            url.searchParams.get("spatial_mode")
          )
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/start") {
        const body = await request.json();
        return json(await startPlayerNavigation(
          env.WORLD_DB,
          navigationContext(body.character_id, body.spatial_mode),
          body
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/override") {
        const body = await request.json();
        return json(await overridePlayerNavigation(
          env.WORLD_DB,
          navigationContext(body.character_id, body.spatial_mode),
          body
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/checkpoint") {
        const body = await request.json();
        return json(await checkpointPlayerShip(
          env.WORLD_DB,
          navigationContext(body.character_id, body.spatial_mode),
          body
        ));
      }
      if (request.method === "GET" && url.pathname === "/zone-ships") {
        return json(await listZoneShipPeers(
          env.WORLD_DB,
          url.searchParams.get("zone_id"),
          { excludedCharacterId: url.searchParams.get("excluded_character_id") }
        ));
      }
      return json({ error: "Not found." }, 404);
    } catch (error) {
      return json({
        error: error?.message || "Unexpected error.",
        code: error?.code || "INTERNAL_ERROR"
      }, Number(error?.status) || 500);
    }
  }
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}

function navigationContext(value, spatialMode = null) {
  const characterId = String(value || "test-pilot");
  return {
    characterId,
    displayName: characterId,
    shipUid: `ship-${characterId}-ship_01-001`,
    shipDefinitionId: "ship_01",
    spatialMode
  };
}
