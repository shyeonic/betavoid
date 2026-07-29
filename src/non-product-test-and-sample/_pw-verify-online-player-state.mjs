import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFirebaseAuthMock } from "./_pw-firebase-auth-mock.mjs";
import {
  createNavigationResponse,
  withWorldAuthoritySnapshot
} from "./_pw-world-authority-fixture.mjs";

const baseUrl = process.env.BETA_VOID_TEST_BASE_URL || "http://127.0.0.1:4173";
const now = Date.now();
const characterId = "firebase-playwright-google-user";
const activeShipUid = `ship-${characterId}-ship_01-001`;
const activeStorageId = `storage-${activeShipUid}-active`;
const cargoStorageId = `storage-${activeShipUid}-cargo`;
const world = withWorldAuthoritySnapshot({
  world_id: "primary",
  seed: "player-state-test-seed",
  data_source_key: "beta-void-world-v1",
  revision: 1,
  generated_at: now,
  created_at: now,
  updated_at: now
});
let serverState = {
  character_id: characterId,
  schema_version: 1,
  assets_revision: 1,
  ship_revision: 0,
  assets: {
    character_id: characterId,
    profile: {
      character_id: characterId,
      display_name: "Playwright Pilot",
      portrait_id: "portrait_01",
      sic: 0,
      playtime_sec: 0,
      skill_nodes: {},
      achievements: {},
      blueprint_ids: [],
      active_ship_uid: activeShipUid,
      selected_ship_id: "ship_01",
      created_at: now,
      updated_at: now
    },
    storageLocations: [
      {
        storage_id: activeStorageId,
        storage_type: "active_ship",
        owner_character_id: characterId,
        world_object_id: null,
        parent_item_uid: null,
        capacity: null,
        created_at: now,
        updated_at: now
      },
      {
        storage_id: cargoStorageId,
        storage_type: "ship_cargo",
        owner_character_id: characterId,
        world_object_id: null,
        parent_item_uid: activeShipUid,
        capacity: 1000,
        created_at: now,
        updated_at: now
      }
    ],
    quantityItems: [],
    uniqueItems: [
      {
        item_uid: activeShipUid,
        item_id: "ship_01",
        kind: "ship",
        owner_character_id: characterId,
        storage_id: activeStorageId,
        parent_item_uid: null,
        seed: null,
        fixed_options: {},
        created_at: now,
        updated_at: now
      }
    ],
    slotAssignments: []
  },
  ship_state: null,
  docking: null,
  updated_at: now
};
let navigationResponse = createNavigationResponse({
  characterId,
  shipUid: activeShipUid,
  serverTime: now
});

const browser = await chromium.launch({ headless: true });

try {
  await mutateFirstSession();
  const restored = await loadSecondSession();

  assert.equal(serverState.assets_revision, 2);
  assert.equal(navigationResponse.navigation.ship.revision, 2);
  assert.equal(serverState.assets.profile.display_name, "Server Pilot");
  assert.equal(restored.displayName, "Server Pilot");
  assert.equal(restored.oreQuantity, 7);
  assert.deepEqual(restored.position, { x: 12345, y: 23456, z: 34567 });
  console.log("online player state browser test passed");
} finally {
  await browser.close();
}

async function mutateFirstSession() {
  const { context, page } = await openSession();
  const result = await page.evaluate(async ({ characterId, cargoStorageId }) => {
    const manager = window.__betaVoidGame.worldDataManager;
    await manager.loadOrCreateWorld();
    const initialAssets = await manager.loadOrCreatePlayerAssets(characterId);
    await manager.runPlayerAssetMutation(characterId, () => ({
      quantityItemsToPut: [
        manager.createQuantityItemEntry({
          storageId: cargoStorageId,
          itemId: "RSS_001",
          quantity: 7
        })
      ]
    }), { reason: "mining" });

    const shipState = manager.createDefaultPlayerShipState(Date.now(), manager.snapshot.sectors, characterId);
    shipState.position = { x: 12345, y: 23456, z: 34567 };
    await manager.savePlayerShipState(shipState);
    await manager.putCharacterProfile({
      ...initialAssets.profile,
      display_name: "Server Pilot"
    });
    return true;
  }, { characterId, cargoStorageId });
  assert.equal(result, true);
  await context.close();
}

async function loadSecondSession() {
  const { context, page } = await openSession();
  const result = await page.evaluate(async ({ characterId }) => {
    const manager = window.__betaVoidGame.worldDataManager;
    await manager.loadOrCreateWorld();
    const assets = await manager.loadOrCreatePlayerAssets(characterId);
    const shipState = await manager.loadOrCreatePlayerShipState(characterId);
    return {
      displayName: assets.profile.display_name,
      oreQuantity: assets.quantityItems.find((item) => item.item_id === "RSS_001")?.quantity || 0,
      position: shipState.position
    };
  }, { characterId });
  await context.close();
  return result;
}

async function openSession() {
  const context = await browser.newContext();
  const page = await context.newPage();
  await installFirebaseAuthMock(page);
  await page.route("https://beta-void-api.infira-2025.workers.dev/v1/**", handleApiRoute);
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__betaVoidGame), null, { timeout: 30_000 });
  return { context, page };
}

async function handleApiRoute(route) {
  const request = route.request();
  assert.equal(request.headers().authorization, "Bearer playwright.firebase.id-token");
  const url = new URL(request.url());
  const respond = (payload, status = 200) => route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(payload)
  });

  if (url.pathname === "/v1/world/bootstrap") {
    return respond({ ok: true, world, server_time: Date.now() });
  }
  if (url.pathname === "/v1/player/state" && request.method() === "GET") {
    return respond({ ok: true, state: serverState, server_time: Date.now() });
  }
  if (url.pathname === "/v1/navigation/state" && request.method() === "GET") {
    navigationResponse.navigation.server_time = Date.now();
    return respond(navigationResponse);
  }
  if (url.pathname === "/v1/player/assets" && request.method() === "POST") {
    const body = request.postDataJSON();
    if (body.expected_revision !== serverState.assets_revision) {
      return respond({ ok: false, error: "PLAYER_STATE_CONFLICT", message: "conflict" }, 409);
    }
    serverState = {
      ...serverState,
      assets_revision: serverState.assets_revision + 1,
      assets: body.assets,
      docking: body.docking,
      updated_at: Date.now()
    };
    return respond({ ok: true, state: serverState, server_time: Date.now() });
  }
  if (url.pathname === "/v1/navigation/checkpoint" && request.method() === "POST") {
    const body = request.postDataJSON();
    if (body.expected_revision !== navigationResponse.navigation.ship.revision) {
      return respond({
        ok: false,
        error: "MOVEMENT_REVISION_CONFLICT",
        message: "conflict"
      }, 409);
    }
    const updatedAt = Date.now();
    navigationResponse = createNavigationResponse({
      characterId,
      shipUid: activeShipUid,
      position: body.ship.position,
      rotation: body.ship.rotation,
      revision: navigationResponse.navigation.ship.revision + 1,
      serverTime: updatedAt
    });
    navigationResponse.navigation.ship.speed = body.ship.speed;
    navigationResponse.navigation.ship.desired_speed = body.ship.desired_speed;
    return respond({
      ...navigationResponse,
      navigation: {
        ...navigationResponse.navigation,
        server_time: updatedAt
      }
    });
  }
  if (url.pathname === "/v1/space/ships" && request.method() === "GET") {
    return respond({
      ok: true,
      zone_id: url.searchParams.get("zone_id"),
      server_time: Date.now(),
      peers: []
    });
  }
  if (url.pathname === "/v1/navigation/manual-override" && request.method() === "POST") {
    return respond({
      ...navigationResponse,
      navigation: {
        ...navigationResponse.navigation,
        active_contract: null,
        server_time: Date.now()
      }
    });
  }
  if (url.pathname === "/v1/navigation/start" && request.method() === "POST") {
    return respond({
      ok: false,
      error: "TEST_NAVIGATION_UNEXPECTED",
      message: "unexpected navigation start"
    }, 400);
  }
  if (url.pathname === "/v1/player/ship-state" && request.method() === "POST") {
    return respond({
      ok: false,
      error: "LEGACY_SHIP_STATE_FORBIDDEN",
      message: "legacy ship state must not be used"
    }, 400);
  }
  if (url.pathname === "/v1/profile" && request.method() === "POST") {
    const body = request.postDataJSON();
    const updatedAt = Date.now();
    serverState = {
      ...serverState,
      assets: {
        ...serverState.assets,
        profile: {
          ...serverState.assets.profile,
          display_name: body.displayName,
          updated_at: updatedAt
        }
      },
      updated_at: updatedAt
    };
    return respond({
      ok: true,
      profile: {
        firebase_uid: "playwright-google-user",
        character_id: characterId,
        display_name: body.displayName,
        is_anonymous: false,
        created_at: now,
        updated_at: updatedAt
      }
    });
  }
  return respond({ ok: false, error: "NOT_FOUND" }, 404);
}
