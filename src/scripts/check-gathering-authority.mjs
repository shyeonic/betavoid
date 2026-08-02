import assert from "node:assert/strict";

const baseUrl = String(
  process.env.BETA_VOID_AUTHORITY_TEST_URL || "http://127.0.0.1:8791"
).replace(/\/+$/, "");
const characterId = `gather-check-${Date.now()}`;

async function request(path, { method = "GET", body = null } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(10_000)
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

let world = await request("/state");
world = await request("/rebuild", {
  method: "POST",
  body: { expected_revision: world.revision }
});
const node = world.snapshot.resource_nodes.find((entry) => (
  Number(entry.current_amount) > 10
  && entry.produces_item_id
  && (entry.expiry_time == null || Number(entry.expiry_time) > Date.now())
));
assert.ok(node, "Expected an available resource node.");
const player = await request("/player/bootstrap", {
  method: "POST",
  body: { character_id: characterId }
});
const cargo = player.assets.storageLocations.find((storage) => storage.storage_type === "ship_cargo");
assert.ok(cargo, "Expected ship cargo storage.");
const initial = await request(`/navigation?character_id=${characterId}`);

await request("/test/move-entity", {
  method: "POST",
  body: {
    entity_type: "resource_node",
    entity_id: node.resource_instance_id,
    position: initial.ship.position
  }
});

const startAt = Date.now();
const started = await request("/economy/gathering/start", {
  method: "POST",
  body: {
    character_id: characterId,
    client_action_id: `gather-start-${characterId}`,
    expected_ship_revision: initial.ship.revision,
    expected_assets_revision: player.assets_revision,
    node_id: node.resource_instance_id,
    target_storage_id: cargo.storage_id,
    observed_ship: {
      position: initial.ship.position,
      rotation: initial.ship.rotation,
      speed: 0,
      desired_speed: 0
    },
    ...commandWindow(startAt)
  }
});
assert.equal(started.committed, true);
assert.equal(started.contract.status, "active");
assert.equal(started.navigation.economy_occupancy.type, "GATHERING");
assert.equal(started.navigation.ship.revision, initial.ship.revision + 1);

await assert.rejects(
  request("/navigation/start", {
    method: "POST",
    body: {
      character_id: characterId,
      client_action_id: `move-during-gather-${characterId}`,
      expected_revision: started.navigation.ship.revision,
      route_type: "standard",
      target: {
        x: initial.ship.position.x + 1,
        y: initial.ship.position.y,
        z: initial.ship.position.z
      },
      observed_ship: {
        position: initial.ship.position,
        rotation: initial.ship.rotation,
        speed: 0,
        desired_speed: 0
      },
      ...commandWindow(startAt + 1_000)
    }
  }),
  (error) => error?.code === "SHIP_OCCUPIED"
);

const active = await request(
  `/economy/gathering/active?character_id=${characterId}&server_now=${startAt + 20_000}`
);
assert.equal(active.contract.contract_id, started.contract.contract_id);

const stopAt = startAt + 25_000;
const stopBody = {
  character_id: characterId,
  client_action_id: `gather-stop-${characterId}`,
  contract_id: started.contract.contract_id,
  ...commandWindow(stopAt)
};
const stopped = await request("/economy/gathering/stop", {
  method: "POST",
  body: stopBody
});
assert.equal(stopped.committed, true);
assert.equal(stopped.gathered, 2);
assert.equal(stopped.contract.status, "cancelled");
assert.equal(stopped.state.assets_revision, player.assets_revision + 1);
const gatheredItem = stopped.state.assets.quantityItems.find((item) => (
  item.storage_id === cargo.storage_id && item.item_id === node.produces_item_id
));
assert.equal(gatheredItem.quantity, 2);
assert.equal(stopped.node.current_amount, node.current_amount - 2);

const duplicate = await request("/economy/gathering/stop", {
  method: "POST",
  body: { ...stopBody, server_now: stopAt + 100 }
});
assert.deepEqual(duplicate, stopped);

const inactive = await request(
  `/economy/gathering/active?character_id=${characterId}&server_now=${stopAt + 1}`
);
assert.equal(inactive.contract, null);

console.log("gathering authority check passed");
