import {
  getOrCreateWorldState,
  getWorldAdminSummary,
  listWorldAdminEntities,
  processBetaVoidEntity,
  rebuildWorldState
} from "../src/world-state.js";
import {
  dockPlayerShip,
  enterPlayerBetaSpace,
  exitPlayerBetaSpace,
  getPlayerCommandResult,
  getPlayerNavigationState,
  listNavigationAdminHistory,
  listNavigationAdminShips,
  listZoneShipPeers,
  observeSpaceShips,
  overridePlayerNavigation,
  resumePlayerManualNavigation,
  startPlayerNavigation,
  undockPlayerShip
} from "../src/navigation-state.js";
import { reconcileResourceLifecycle } from "../src/resource-lifecycle.js";
import { getOrCreatePlayerState } from "../src/player-state.js";
import { tradeAtStation } from "../src/economy-state.js";
import {
  getActiveGathering,
  settleGathering,
  startGathering,
  stopGathering
} from "../src/gathering-state.js";

const TEST_WORLD_ENTROPY_SECRET = "beta-void-authority-test-secret";

export { PresenceShard } from "../src/presence-shard.js";

export default {
  async fetch(request, env) {
    try {
      const url = new URL(request.url);
      if (request.method === "GET" && url.pathname === "/state") {
        return json(await getOrCreateWorldState(
          env.WORLD_DB,
          testNow(url.searchParams.get("server_now")),
          TEST_WORLD_ENTROPY_SECRET
        ));
      }
      if (request.method === "GET" && url.pathname === "/summary") {
        return json(await getWorldAdminSummary(env.WORLD_DB, TEST_WORLD_ENTROPY_SECRET));
      }
      if (request.method === "GET" && url.pathname === "/entities") {
        return json(await listWorldAdminEntities(env.WORLD_DB, {
          entityType: url.searchParams.get("entity_type"),
          sectorId: url.searchParams.get("sector_id"),
          cursor: url.searchParams.get("cursor"),
          limit: url.searchParams.get("limit")
        }, TEST_WORLD_ENTROPY_SECRET));
      }
      if (request.method === "POST" && url.pathname === "/rebuild") {
        const body = await request.json();
        return json(await rebuildWorldState(env.WORLD_DB, {
          expectedRevision: body.expected_revision
        }, TEST_WORLD_ENTROPY_SECRET));
      }
      if (request.method === "POST" && url.pathname === "/beta-process") {
        const body = await request.json();
        return json(await processBetaVoidEntity(env.WORLD_DB, {
          betaVoidId: body.beta_void_id,
          expectedGeneration: body.expected_generation,
          clientActionId: body.client_action_id,
          actorCharacterId: navigationContext(body.character_id).characterId,
          actorShipUid: navigationContext(body.character_id).shipUid,
          issuedAt: body.issued_at,
          expiresAt: body.expires_at
        }, testNow(body.server_now), TEST_WORLD_ENTROPY_SECRET));
      }
      if (request.method === "POST" && url.pathname === "/reconcile") {
        const body = await request.json();
        return json(await reconcileResourceLifecycle(
          env.WORLD_DB,
          testNow(body.server_now),
          TEST_WORLD_ENTROPY_SECRET
        ));
      }
      if (request.method === "GET" && url.pathname === "/navigation") {
        return json(await getPlayerNavigationState(
          env.WORLD_DB,
          navigationContext(url.searchParams.get("character_id")),
          testNow(url.searchParams.get("server_now"))
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/start") {
        const body = await request.json();
        return json(await startPlayerNavigation(
          env.WORLD_DB,
          navigationContext(body.character_id, body.spatial_mode),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/player/bootstrap") {
        const body = await request.json();
        const identity = playerIdentity(body.character_id);
        return json(await getOrCreatePlayerState(
          env.WORLD_DB,
          identity.auth,
          identity.profile
        ));
      }
      if (request.method === "POST" && url.pathname === "/economy/trade") {
        const body = await request.json();
        const identity = playerIdentity(body.character_id);
        const state = await getOrCreatePlayerState(
          env.WORLD_DB,
          identity.auth,
          identity.profile
        );
        return json(await tradeAtStation(
          env.WORLD_DB,
          navigationContext(body.character_id, null, state),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "GET" && url.pathname === "/economy/gathering/active") {
        return json(await getActiveGathering(
          env.WORLD_DB,
          navigationContext(url.searchParams.get("character_id")),
          testNow(url.searchParams.get("server_now"))
        ));
      }
      if (request.method === "POST" && url.pathname === "/economy/gathering/start") {
        const body = await request.json();
        const identity = playerIdentity(body.character_id);
        const state = await getOrCreatePlayerState(env.WORLD_DB, identity.auth, identity.profile);
        return json(await startGathering(
          env.WORLD_DB,
          navigationContext(body.character_id, null, state),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/economy/gathering/stop") {
        const body = await request.json();
        const identity = playerIdentity(body.character_id);
        const state = await getOrCreatePlayerState(env.WORLD_DB, identity.auth, identity.profile);
        return json(await stopGathering(
          env.WORLD_DB,
          navigationContext(body.character_id, null, state),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/economy/gathering/settle") {
        const body = await request.json();
        const identity = playerIdentity(body.character_id);
        const state = await getOrCreatePlayerState(env.WORLD_DB, identity.auth, identity.profile);
        return json(await settleGathering(
          env.WORLD_DB,
          navigationContext(body.character_id, null, state),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/override") {
        const body = await request.json();
        return json(await overridePlayerNavigation(
          env.WORLD_DB,
          navigationContext(body.character_id, body.spatial_mode),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/manual-resume") {
        const body = await request.json();
        return json(await resumePlayerManualNavigation(
          env.WORLD_DB,
          navigationContext(body.character_id, body.spatial_mode),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/dock") {
        const body = await request.json();
        return json(await dockPlayerShip(
          env.WORLD_DB,
          navigationContext(body.character_id),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/undock") {
        const body = await request.json();
        return json(await undockPlayerShip(
          env.WORLD_DB,
          navigationContext(body.character_id),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/beta-enter") {
        const body = await request.json();
        return json(await enterPlayerBetaSpace(
          env.WORLD_DB,
          navigationContext(body.character_id),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "POST" && url.pathname === "/navigation/beta-exit") {
        const body = await request.json();
        return json(await exitPlayerBetaSpace(
          env.WORLD_DB,
          navigationContext(body.character_id),
          body,
          testNow(body.server_now)
        ));
      }
      if (request.method === "GET" && url.pathname === "/navigation/command-result") {
        return json(await getPlayerCommandResult(
          env.WORLD_DB,
          navigationContext(url.searchParams.get("character_id")),
          url.searchParams.get("client_action_id")
        ));
      }
      if (request.method === "POST" && url.pathname === "/test/move-entity") {
        const body = await request.json();
        return json(await moveWorldEntity(env.WORLD_DB, body));
      }
      if (request.method === "GET" && url.pathname === "/zone-ships") {
        return json(await listZoneShipPeers(
          env.WORLD_DB,
          url.searchParams.get("zone_id"),
          {
            excludedCharacterId: url.searchParams.get("excluded_character_id"),
            now: testNow(url.searchParams.get("server_now"))
          }
        ));
      }
      if (request.method === "GET" && url.pathname === "/observe-space") {
        return json(await observeSpaceShips(env.WORLD_DB, {
          zoneId: url.searchParams.get("zone_id"),
          characterId: url.searchParams.get("character_id"),
          shipUid: url.searchParams.get("ship_uid"),
          excludedCharacterId: url.searchParams.get("excluded_character_id"),
          limit: url.searchParams.get("limit"),
          now: testNow(url.searchParams.get("server_now"))
        }));
      }
      if (request.method === "GET" && url.pathname === "/navigation/admin-ships") {
        return json(await listNavigationAdminShips(
          env.WORLD_DB,
          testNow(url.searchParams.get("server_now"))
        ));
      }
      if (request.method === "GET" && url.pathname === "/navigation/history") {
        return json(await listNavigationAdminHistory(env.WORLD_DB, {
          shipUid: url.searchParams.get("ship_uid"),
          ownerCharacterId: url.searchParams.get("owner_character_id"),
          routeType: url.searchParams.get("route_type"),
          status: url.searchParams.get("status"),
          limit: url.searchParams.get("limit")
        }));
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

function navigationContext(value, spatialMode = null, playerState = null) {
  const characterId = String(value || "test-pilot");
  const identity = playerIdentity(characterId);
  return {
    firebaseUid: identity.auth.uid,
    profile: identity.profile,
    characterId,
    displayName: characterId,
    shipUid: playerState?.assets?.profile?.active_ship_uid
      || `ship-${characterId}-ship_01-001`,
    shipDefinitionId: playerState?.assets?.profile?.selected_ship_id || "ship_01",
    spatialMode,
    worldEntropySecret: TEST_WORLD_ENTROPY_SECRET
  };
}

function playerIdentity(value) {
  const characterId = String(value || "test-pilot");
  const firebaseUid = `firebase-${characterId}`;
  return {
    auth: { uid: firebaseUid },
    profile: {
      firebase_uid: firebaseUid,
      character_id: characterId,
      display_name: characterId,
      created_at: 1,
      updated_at: 1
    }
  };
}

function testNow(value) {
  const now = Number(value);
  return Number.isFinite(now) && now > 0 ? now : Date.now();
}

async function moveWorldEntity(db, body) {
  const entityType = String(body?.entity_type || "");
  const entityId = String(body?.entity_id || "");
  const row = await db.prepare(`
    SELECT state_json, revision
    FROM world_entities
    WHERE world_id = 'primary' AND entity_type = ? AND entity_id = ?
  `).bind(entityType, entityId).first();
  if (!row) throw new Error("Test entity not found.");
  const state = JSON.parse(row.state_json);
  state.position = body.position;
  if (body.variant_generation != null) state.variant_generation = body.variant_generation;
  const result = await db.prepare(`
    UPDATE world_entities
    SET state_json = ?, revision = revision + 1, updated_at = ?
    WHERE world_id = 'primary' AND entity_type = ? AND entity_id = ? AND revision = ?
  `).bind(
    JSON.stringify(state),
    Date.now(),
    entityType,
    entityId,
    Number(row.revision)
  ).run();
  return { changed: Number(result?.meta?.changes || result?.changes) === 1, state };
}
