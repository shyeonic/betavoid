import assert from "node:assert/strict";
import { chromium } from "playwright";

const baseUrl = process.env.BETA_VOID_TEST_BASE_URL || "http://127.0.0.1:4173";
const generatedAt = Date.now();
const bootstrapResponse = {
  ok: true,
  world: {
    world_id: "primary",
    seed: "server-test-seed",
    data_source_key: "beta-void-world-v1",
    revision: 1,
    generated_at: generatedAt,
    created_at: generatedAt,
    updated_at: generatedAt
  },
  server_time: generatedAt
};

const firebaseAppModule = `
  export function initializeApp(config) {
    return { config };
  }
`;

const firebaseAuthModule = `
  export const browserLocalPersistence = {};
  const user = {
    uid: "online-bootstrap-test-user",
    displayName: "Bootstrap Pilot",
    email: "bootstrap@example.com",
    photoURL: null,
    isAnonymous: false,
    providerData: [{ providerId: "google.com" }],
    async getIdToken() { return "test-firebase-token"; }
  };
  export function getAuth() { return { currentUser: user }; }
  export class GoogleAuthProvider {
    setCustomParameters() {}
  }
  export async function setPersistence() {}
  export async function signInWithPopup() { return { user }; }
  export async function signOut() {}
  export function onAuthStateChanged(auth, next) {
    queueMicrotask(() => next(user));
    return () => {};
  }
`;

const browser = await chromium.launch({ headless: true });

try {
  const first = await loadWorldInFreshContext({ preserveSetting: true });
  const second = await loadWorldInFreshContext();

  assert.equal(first.apiAuthorization, "Bearer test-firebase-token");
  assert.equal(first.meta.server_world_id, "primary");
  assert.equal(first.meta.server_data_source_key, "beta-void-world-v1");
  assert.equal(first.meta.server_revision, 1);
  assert.equal(first.meta.seed, "server-test-seed");
  assert.equal(first.meta.generated_at, generatedAt);
  assert.equal(first.settingPreserved, true);
  assert.equal(first.regenerateButtonExists, false);
  assert.deepEqual(first.layout, second.layout);
  assert.deepEqual(first.meta, second.meta);
  console.log("online world bootstrap browser test passed");
} finally {
  await browser.close();
}

async function loadWorldInFreshContext({ preserveSetting = false } = {}) {
  const context = await browser.newContext();
  let apiAuthorization = null;

  await context.route("https://www.gstatic.com/firebasejs/*/firebase-app.js", async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: firebaseAppModule });
  });
  await context.route("https://www.gstatic.com/firebasejs/*/firebase-auth.js", async (route) => {
    await route.fulfill({ contentType: "text/javascript", body: firebaseAuthModule });
  });
  await context.route("https://beta-void-api.infira-2025.workers.dev/v1/world/bootstrap", async (route) => {
    apiAuthorization = route.request().headers().authorization || null;
    await route.fulfill({
      contentType: "application/json",
      body: JSON.stringify(bootstrapResponse)
    });
  });

  const page = await context.newPage();
  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => Boolean(window.__betaVoidGame), null, { timeout: 30_000 });

  const result = await page.evaluate(async ({ preserveSetting }) => {
    const manager = window.__betaVoidGame.worldDataManager;
    const snapshot = await manager.loadOrCreateWorld();

    if (preserveSetting) {
      await manager.putStoreValue("settings", {
        key: "onlineBootstrapTest",
        value: "preserve"
      });
      await manager.resetWorld();
    }

    const setting = preserveSetting
      ? await manager.getStoreValue("settings", "onlineBootstrapTest")
      : null;
    const current = await manager.getWorldSnapshot();
    const simplifyPosition = (record, idKey) => ({
      id: record[idKey],
      position: record.position || record.global_position || null,
      sectorId: record.sector_id || null
    });

    return {
      meta: {
        seed: current.meta.seed,
        generated_at: current.meta.generated_at,
        server_world_id: current.meta.server_world_id,
        server_data_source_key: current.meta.server_data_source_key,
        server_revision: current.meta.server_revision
      },
      layout: {
        sectors: current.sectors.map((sector) => simplifyPosition(sector, "sector_id")),
        resources: current.resourceNodes.map((node) => simplifyPosition(node, "resource_instance_id")),
        buildings: current.buildings.map((building) => simplifyPosition(building, "building_instance_id")),
        betaVoids: current.betaVoids.map((betaVoid) => simplifyPosition(betaVoid, "id"))
      },
      settingPreserved: !preserveSetting || setting?.value === "preserve",
      regenerateButtonExists: Boolean(document.querySelector("#worldRegenerateButton")),
      initialCounts: {
        sectors: snapshot.sectors.length,
        resources: snapshot.resourceNodes.length
      }
    };
  }, { preserveSetting });

  await context.close();
  return { ...result, apiAuthorization };
}
