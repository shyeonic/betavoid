import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFirebaseAuthMock } from "./_pw-firebase-auth-mock.mjs";
import {
  createNavigationResponse,
  withWorldAuthoritySnapshot
} from "./_pw-world-authority-fixture.mjs";

const baseUrl = process.env.BETA_VOID_TEST_BASE_URL || "http://127.0.0.1:4173";
const now = Date.now();
const world = withWorldAuthoritySnapshot({
  world_id: "primary",
  seed: "presence-test-seed",
  data_source_key: "beta-void-world-v1",
  revision: 1,
  generated_at: now,
  created_at: now,
  updated_at: now
});
const users = [
  {
    uid: "presence-user-a",
    characterId: "firebase-presence-user-a",
    displayName: "Presence Alpha",
    email: "alpha@example.test",
    token: "presence.firebase.token-a"
  },
  {
    uid: "presence-user-b",
    characterId: "firebase-presence-user-b",
    displayName: "Presence Beta",
    email: "beta@example.test",
    token: "presence.firebase.token-b"
  }
];

async function run() {
  const hub = new MockPresenceHub();
  const browser = await chromium.launch({ headless: true });
  const sessions = [];

  try {
    for (const user of users) sessions.push(await openSession(browser, hub, user));
    const [alpha, beta] = sessions;

    await Promise.all(sessions.map(({ page }) => page.waitForFunction(() => (
      window.__betaVoidGame?.remotePlayerManager?.getPeerCount() === 1
    ), null, { timeout: 30_000 })));
    await beta.page.waitForFunction((characterId) => {
      const state = window.__betaVoidGame?.remotePlayerManager?.peers?.get(characterId);
      return Boolean(state?.model && state?.root?.visible);
    }, users[0].characterId, { timeout: 30_000 });

    const initial = await beta.page.evaluate((characterId) => (
      window.__betaVoidGame.remotePlayerManager.getPeerSnapshot(characterId)
    ), users[0].characterId);
    assert.equal(initial.shipId, "ship_01");
    assert.equal(initial.visible, true);

    const moved = await alpha.page.evaluate(() => {
      const game = window.__betaVoidGame;
      game.ship.position.x += 40;
      game.updateOnlinePresence({ force: true });
      return game.getPlayerDataPosition();
    });
    await beta.page.waitForFunction(({ characterId, expectedX }) => {
      const state = window.__betaVoidGame?.remotePlayerManager?.getPeerSnapshot(characterId);
      return state?.position && Math.abs(state.position.x - expectedX * 0.01) < 5;
    }, { characterId: users[0].characterId, expectedX: moved.x }, { timeout: 10_000 });

    const poseCountBeforeRoute = hub.messageCounts.pose;
    const routeResult = await alpha.page.evaluate(() => {
      const game = window.__betaVoidGame;
      const target = game.ship.position.clone().add({ x: 400, y: 0, z: 0 });
      game.setTarget({ x: target.x, y: target.y, z: target.z });
      for (let i = 0; i < 5; i += 1) game.updateOnlinePresence();
      return {
        actionId: game.activeNavLogId,
        routeSignature: game.presenceRouteSignature
      };
    });
    assert.ok(routeResult.actionId);
    assert.ok(routeResult.routeSignature);

    await beta.page.waitForFunction((characterId) => Boolean(
      window.__betaVoidGame?.remotePlayerManager?.getPeerSnapshot(characterId)?.route
    ), users[0].characterId, { timeout: 10_000 });
    assert.equal(hub.messageCounts.route, 1);
    assert.equal(hub.messageCounts.pose, poseCountBeforeRoute);

    const routeSnapshot = await beta.page.evaluate((characterId) => (
      window.__betaVoidGame.remotePlayerManager.getPeerSnapshot(characterId)
    ), users[0].characterId);
    assert.equal(routeSnapshot.route.action_id, routeResult.actionId);
    assert.equal(routeSnapshot.route.route_type, "standard");
    assert.equal(hub.protocolChecks, 2);

    await alpha.context.close();
    alpha.closed = true;
    hub.disconnect(users[0].characterId);
    await beta.page.waitForFunction((characterId) => {
      const manager = window.__betaVoidGame?.remotePlayerManager;
      const state = manager?.peers?.get(characterId);
      return manager?.getPeerCount() === 1
        && Boolean(state?.fieldPeer)
        && !state?.presencePeer
        && Boolean(state?.root?.visible);
    }, users[0].characterId, { timeout: 10_000 });
    const persistent = await beta.page.evaluate((characterId) => (
      window.__betaVoidGame.remotePlayerManager.getPeerSnapshot(characterId)
    ), users[0].characterId);
    assert.equal(persistent.visible, true);
    assert.equal(persistent.shipId, "ship_01");
    console.log("online presence two-browser test passed");
  } catch (error) {
    const diagnostics = await Promise.all(sessions.map(async ({ page, user, errors }) => ({
      characterId: user.characterId,
      errors,
      state: await page.evaluate(() => ({
        game: Boolean(window.__betaVoidGame),
        presence: window.__betaVoidGame?.presenceClient?.state || null,
        desiredZone: window.__betaVoidGame?.presenceClient?.desiredZoneId || null,
        peers: window.__betaVoidGame?.remotePlayerManager?.getPeerCount() ?? null
      })).catch(() => null)
    })));
    console.error(JSON.stringify({
      hubClients: [...hub.clients.keys()],
      protocolChecks: hub.protocolChecks,
      messageCounts: hub.messageCounts,
      diagnostics
    }, null, 2));
    throw error;
  } finally {
    await Promise.all(sessions.filter((session) => !session.closed).map(({ context }) => context.close()));
    await browser.close();
  }
}

async function openSession(browser, hub, user) {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await installFirebaseAuthMock(page, {
    user: {
      uid: user.uid,
      displayName: user.displayName,
      email: user.email
    },
    idToken: user.token
  });
  await page.routeWebSocket(
    "wss://beta-void-api.infira-2025.workers.dev/v1/presence/connect**",
    (socket) => hub.connect(user, socket)
  );
  let state = createPlayerState(user);
  let navigation = createNavigationResponse({
    characterId: user.characterId,
    displayName: user.displayName,
    serverTime: now
  });
  await page.route("https://beta-void-api.infira-2025.workers.dev/v1/**", async (route) => {
    const request = route.request();
    assert.equal(request.headers().authorization, `Bearer ${user.token}`);
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
      return respond({ ok: true, state, server_time: Date.now() });
    }
    if (url.pathname === "/v1/navigation/state" && request.method() === "GET") {
      navigation.navigation.server_time = Date.now();
      return respond(navigation);
    }
    if (
      url.pathname === "/v1/navigation/start"
      || url.pathname === "/v1/navigation/checkpoint"
      || url.pathname === "/v1/navigation/manual-override"
    ) {
      navigation = createNavigationResponse({
        characterId: user.characterId,
        displayName: user.displayName,
        position: navigation.navigation.ship.position,
        rotation: navigation.navigation.ship.rotation,
        revision: navigation.navigation.ship.revision + 1,
        serverTime: Date.now()
      });
      return respond(navigation);
    }
    if (url.pathname === "/v1/space/ships" && request.method() === "GET") {
      const other = users.find((candidate) => candidate.characterId !== user.characterId);
      const otherNavigation = createNavigationResponse({
        characterId: other.characterId,
        displayName: other.displayName,
        serverTime: Date.now()
      }).navigation;
      return respond({
        ok: true,
        zone_id: url.searchParams.get("zone_id"),
        server_time: Date.now(),
        peers: [{
          character_id: other.characterId,
          display_name: other.displayName,
          ship_id: "ship_01",
          ship_uid: otherNavigation.ship.ship_uid,
          zone_id: url.searchParams.get("zone_id"),
          updated_at: Date.now(),
          source: "authority",
          pose: {
            seq: otherNavigation.ship.revision,
            ship_id: "ship_01",
            position: otherNavigation.ship.position,
            rotation: otherNavigation.ship.rotation,
            velocity: { x: 0, y: 0, z: 0 },
            speed: 0,
            server_at: Date.now()
          },
          route: null
        }]
      });
    }
    if (url.pathname === "/v1/player/assets" && request.method() === "POST") {
      const body = request.postDataJSON();
      state = {
        ...state,
        assets_revision: state.assets_revision + 1,
        assets: body.assets,
        docking: body.docking,
        updated_at: Date.now()
      };
      return respond({ ok: true, state, server_time: Date.now() });
    }
    return respond({ ok: false, error: "NOT_FOUND" }, 404);
  });
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__betaVoidGame), null, { timeout: 30_000 });
  await page.evaluate(() => window.__betaVoidGame.loadWorld());
  return { context, page, user, errors };
}

function createPlayerState(user) {
  const activeShipUid = `ship-${user.characterId}-ship_01-001`;
  const activeStorageId = `storage-${activeShipUid}-active`;
  const cargoStorageId = `storage-${activeShipUid}-cargo`;
  return {
    character_id: user.characterId,
    schema_version: 1,
    assets_revision: 1,
    ship_revision: 1,
    assets: {
      character_id: user.characterId,
      profile: {
        character_id: user.characterId,
        display_name: user.displayName,
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
          owner_character_id: user.characterId,
          world_object_id: null,
          parent_item_uid: null,
          capacity: null,
          created_at: now,
          updated_at: now
        },
        {
          storage_id: cargoStorageId,
          storage_type: "ship_cargo",
          owner_character_id: user.characterId,
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
          owner_character_id: user.characterId,
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
    ship_state: {
      key: `playerShip:${user.characterId}`,
      ship_id: "PLAYER-SHIP-001",
      player_id: user.characterId,
      position: { x: 0, y: 0, z: 0 },
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      chunk_id: "CHUNK-0-0-0",
      chunk: { x: 0, y: 0, z: 0 },
      sector_id: null,
      speed: 0,
      desiredSpeed: 0,
      created_at: now,
      updated_at: now
    },
    docking: null,
    updated_at: now
  };
}

class MockPresenceHub {
  constructor() {
    this.clients = new Map();
    this.messageCounts = { pose: 0, route: 0 };
    this.protocolChecks = 0;
  }

  connect(user, socket) {
    assert.ok(socket.protocols().includes("beta-void.v1"));
    assert.ok(socket.protocols().includes(`firebase.${user.token}`));
    this.protocolChecks += 1;

    const peer = {
      character_id: user.characterId,
      display_name: user.displayName,
      ship_id: "ship_01",
      zone_id: "test",
      updated_at: Date.now(),
      pose: null,
      route: null
    };
    const existing = [...this.clients.values()].map((client) => structuredClone(client.peer));
    this.clients.set(user.characterId, { socket, peer });
    socket.send(JSON.stringify({
      type: "hello",
      zone_id: "test",
      server_at: Date.now(),
      peers: existing,
      field_peers: []
    }));
    this.broadcast({
      type: "peer_joined",
      server_at: Date.now(),
      peer
    }, user.characterId);

    socket.onMessage((message) => {
      const payload = JSON.parse(String(message));
      const client = this.clients.get(user.characterId);
      if (!client) return;
      if (payload.type === "pose") {
        this.messageCounts.pose += 1;
        client.peer = {
          ...client.peer,
          ship_id: payload.ship_id,
          updated_at: Date.now(),
          pose: { ...payload, server_at: Date.now() },
          route: null
        };
        this.broadcast({
          type: "peer_pose",
          server_at: Date.now(),
          peer: client.peer
        }, user.characterId);
      } else if (payload.type === "route") {
        this.messageCounts.route += 1;
        const departAt = Date.now() + Number(payload.depart_delay_ms || 0);
        client.peer = {
          ...client.peer,
          ship_id: payload.ship_id,
          updated_at: Date.now(),
          route: {
            action_id: payload.action_id,
            route_type: payload.route_type,
            ship_id: payload.ship_id,
            from_position: payload.from_position,
            target: payload.target,
            depart_at: departAt,
            arrive_at: departAt + Number(payload.duration_ms || 0),
            server_at: Date.now()
          }
        };
        this.broadcast({
          type: "peer_route",
          server_at: Date.now(),
          peer: client.peer
        }, user.characterId);
      }
    });
    socket.onClose(() => {
      this.clients.delete(user.characterId);
      this.broadcast({
        type: "peer_left",
        server_at: Date.now(),
        character_id: user.characterId
      }, user.characterId);
    });
  }

  broadcast(payload, excludedCharacterId) {
    const message = JSON.stringify(payload);
    for (const [characterId, client] of this.clients) {
      if (characterId !== excludedCharacterId) client.socket.send(message);
    }
  }

  disconnect(characterId) {
    if (!this.clients.delete(characterId)) return;
    this.broadcast({
      type: "peer_left",
      server_at: Date.now(),
      character_id: characterId
    }, characterId);
  }
}

await run();
