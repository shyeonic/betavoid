import assert from "node:assert/strict";

const baseUrl = String(
  process.env.BETA_VOID_AUTHORITY_TEST_URL || "http://127.0.0.1:8791"
).replace(/\/+$/, "");
const characterId = `economy-check-${Date.now()}`;

async function request(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) {
    const error = new Error(payload.error || `HTTP ${response.status}`);
    error.status = response.status;
    error.code = payload.code;
    throw error;
  }
  return payload;
}

function commandWindow(now) {
  return { issued_at: now, expires_at: now + 5_000, server_now: now };
}

const world = await request("/state");
const stationStorage = world.snapshot.building_storages.find((storage) => (
  storage.docking_capacity > 0 && Number(storage.public_inventory?.item_001) > 2
));
assert.ok(stationStorage, "Expected a trade station with item_001 stock.");
const station = world.snapshot.buildings.find((building) => (
  building.building_instance_id === stationStorage.world_object_id
));
assert.ok(station, "Expected the trade station building.");

const player = await request("/player/bootstrap", {
  method: "POST",
  body: { character_id: characterId }
});
assert.equal(player.assets_revision, 1);
const initial = await request(`/navigation?character_id=${characterId}`);

await request("/test/move-entity", {
  method: "POST",
  body: {
    entity_type: "building",
    entity_id: station.building_instance_id,
    position: initial.ship.position
  }
});

const dockAt = Date.now();
const docked = await request("/navigation/dock", {
  method: "POST",
  body: {
    character_id: characterId,
    client_action_id: `dock-${characterId}`,
    expected_revision: initial.ship.revision,
    building_id: station.building_instance_id,
    observed_ship: {
      position: initial.ship.position,
      rotation: initial.ship.rotation,
      speed: 0,
      desired_speed: 0
    },
    ...commandWindow(dockAt)
  }
});
assert.equal(docked.ship.spatial_mode, "DOCKED");

const tradeAt = dockAt + 1;
const tradeBody = {
  character_id: characterId,
  client_action_id: `trade-${characterId}`,
  expected_assets_revision: player.assets_revision,
  building_id: station.building_instance_id,
  item_id: "item_001",
  direction: "out",
  amount: 2,
  ...commandWindow(tradeAt)
};
const traded = await request("/economy/trade", { method: "POST", body: tradeBody });
assert.equal(traded.committed, true);
assert.equal(traded.applied, 2);
assert.equal(traded.state.assets_revision, 2);
assert.equal(traded.storage.public_inventory.item_001, stationStorage.public_inventory.item_001 - 2);
const cargo = traded.state.assets.quantityItems.find((item) => item.item_id === "item_001");
assert.equal(cargo.quantity, 2);
assert.equal(traded.occupancy.type, "TRADE");

const duplicate = await request("/economy/trade", {
  method: "POST",
  body: { ...tradeBody, server_now: tradeAt + 100 }
});
assert.deepEqual(duplicate, traded);

await assert.rejects(
  request("/economy/trade", {
    method: "POST",
    body: {
      ...tradeBody,
      client_action_id: `trade-overlap-${characterId}`,
      expected_assets_revision: traded.state.assets_revision,
      ...commandWindow(tradeAt + 500)
    }
  }),
  (error) => error?.code === "SHIP_OCCUPIED"
);

await assert.rejects(
  request("/economy/trade", {
    method: "POST",
    body: {
      ...tradeBody,
      client_action_id: `trade-stale-${characterId}`,
      expected_assets_revision: player.assets_revision,
      amount: 1,
      ...commandWindow(traded.occupancy.busy_until + 1)
    }
  }),
  (error) => error?.code === "PLAYER_STATE_CONFLICT"
);

console.log("economy authority check passed");
