import assert from "node:assert/strict";
import { chromium } from "playwright";
import { installFirebaseAuthMock } from "../non-product-test-and-sample/_pw-firebase-auth-mock.mjs";

const baseUrl = process.env.BETA_VOID_STATIC_URL || "http://127.0.0.1:4173";
const now = Date.now();
const ship = {
  ship_uid: "ship-admin-pilot-ship_01-001",
  owner_character_id: "admin-pilot",
  display_name: "Admin Pilot",
  ship_definition_id: "ship_01",
  spatial_mode: "FIELD",
  sector_id: "SEC-001",
  chunk_id: "31:31:31",
  phase: "cruising",
  route_type: "standard",
  contract_id: "route-admin-001",
  position: { x: 12_601_000, y: 12_600_000, z: 12_622_000 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  speed: 4_500,
  desired_speed: 10_000,
  revision: 4,
  checkpoint_at: now - 5_000,
  updated_at: now
};
const movement = {
  contract_id: "route-admin-001",
  client_action_id: "NAV-admin-001",
  route_type: "standard",
  status: "ACTIVE",
  owner_character_id: "admin-pilot",
  ship_uid: ship.ship_uid,
  display_name: ship.display_name,
  ship_definition_id: ship.ship_definition_id,
  from_position: { x: 12_600_000, y: 12_600_000, z: 12_600_000 },
  target: { x: 12_800_000, y: 12_600_000, z: 12_900_000 },
  resolved_position: ship.position,
  resolved_speed: ship.speed,
  resolved_phase: "cruising",
  issued_at: now - 10_000,
  flight_at: now - 8_000,
  arrive_at: now + 20_000,
  canceled_at: null,
  settled_at: null
};

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
page.on("console", (message) => {
  if (message.type() === "error") errors.push(message.text());
});

try {
  await installFirebaseAuthMock(page, {
    user: {
      uid: "admin-user",
      displayName: "Admin",
      email: "infira.2025@gmail.com"
    }
  });
  await page.route("https://beta-void-api.infira-2025.workers.dev/v1/**", (route) => {
    const url = new URL(route.request().url());
    const respond = (payload) => route.fulfill({
      contentType: "application/json",
      body: JSON.stringify({ ok: true, ...payload })
    });
    if (url.pathname === "/v1/admin/session") {
      return respond({
        admin: {
          uid: "admin-user",
          email: "infira.2025@gmail.com",
          name: "Admin"
        }
      });
    }
    if (url.pathname === "/v1/admin/world/summary") {
      return respond({
        summary: {
          world: {
            world_id: "primary",
            seed: "admin-seed",
            data_source_key: "v3.2-current-data",
            revision: 2,
            generated_at: now
          },
          counts: {
            resource_nodes: 33,
            buildings: 31,
            beta_voids: 10,
            world_storages: 31
          },
          navigation: {
            ships: 1,
            field_ships: 1,
            active_movements: 1
          },
          sectors: [{
            sector_id: "SEC-001",
            name: "Sector 1",
            counts: { resource_node: 3, building: 3, beta_void: 1 }
          }]
        }
      });
    }
    if (url.pathname === "/v1/admin/navigation/ships") {
      return respond({ ships: [ship] });
    }
    if (url.pathname === "/v1/admin/navigation/history") {
      return respond({ movements: [movement] });
    }
    if (url.pathname === "/v1/admin/world/entities") {
      return respond({ entities: [], next_cursor: "" });
    }
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ ok: false, error: "NOT_FOUND" })
    });
  });

  await page.goto(`${baseUrl}/admin/`, { waitUntil: "domcontentloaded" });
  await page.waitForFunction(() => (
    document.querySelectorAll("#shipRows tr").length === 1
    && document.querySelectorAll("#historyRows tr").length === 1
  ), null, { timeout: 20_000 });

  assert.match(await page.locator("#shipRows").innerText(), /12,601,000/);
  assert.match(await page.locator("#historyRows").innerText(), /ACTIVE/);
  await page.locator("#shipRows tr").click();
  await page.waitForFunction(() => (
    document.querySelector("#dialogJson")?.textContent?.includes("recent_movements")
  ));
  assert.equal(errors.length, 0, errors.join("\n"));
  console.log("admin navigation dashboard check passed");
} finally {
  await browser.close();
}
