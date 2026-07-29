import assert from "node:assert/strict";

const baseUrl = String(
  process.env.BETA_VOID_AUTHORITY_TEST_URL || "http://127.0.0.1:8791"
).replace(/\/+$/, "");
const characterId = `authority-check-${Date.now()}`;

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

const initial = await request(`/navigation?character_id=${characterId}`);
assert.equal(initial.character_id, characterId);
assert.equal(initial.ship.spatial_mode, "FIELD");
assert.equal(initial.active_contract, null);

const checkpointAction = `checkpoint-${characterId}`;
const checkpoint = await request("/navigation/checkpoint", {
  method: "POST",
  body: {
    character_id: characterId,
    client_action_id: checkpointAction,
    expected_revision: initial.ship.revision,
    ship: {
      position: initial.ship.position,
      rotation: initial.ship.rotation,
      speed: 0,
      desired_speed: 0
    }
  }
});

const target = {
  ...checkpoint.ship.position,
  z: checkpoint.ship.position.z + 10_000_000
};
const startBody = {
  character_id: characterId,
  client_action_id: `standard-${characterId}`,
  expected_revision: checkpoint.ship.revision,
  route_type: "standard",
  target,
  observed_ship: {
    position: checkpoint.ship.position,
    rotation: checkpoint.ship.rotation,
    speed: 0,
    desired_speed: 0
  }
};
const standard = await request("/navigation/start", {
  method: "POST",
  body: startBody
});
const duplicate = await request("/navigation/start", {
  method: "POST",
  body: startBody
});
assert.equal(
  duplicate.active_contract.contract_id,
  standard.active_contract.contract_id
);
assert.equal(standard.active_contract.route_type, "standard");

const zone = await request(
  `/zone-ships?zone_id=${standard.ship.sector_id}&excluded_character_id=someone-else`
);
const fieldPeer = zone.peers.find((peer) => peer.character_id === characterId);
assert.ok(fieldPeer);
assert.equal(fieldPeer.source, "authority");
assert.equal(fieldPeer.route.authority, true);

const overridden = await request("/navigation/override", {
  method: "POST",
  body: {
    character_id: characterId,
    client_action_id: `override-${characterId}`,
    expected_revision: standard.ship.revision,
    contract_id: standard.active_contract.contract_id
  }
});
assert.equal(overridden.active_contract, null);
assert.equal(overridden.ship.phase, "manual");

const docked = await request(
  `/navigation?character_id=${characterId}&spatial_mode=DOCKED`
);
assert.equal(docked.ship.spatial_mode, "DOCKED");
const dockedZone = await request(
  `/zone-ships?zone_id=${docked.ship.sector_id}&excluded_character_id=someone-else`
);
assert.equal(
  dockedZone.peers.some((peer) => peer.character_id === characterId),
  false
);

const undocked = await request(
  `/navigation?character_id=${characterId}&spatial_mode=FIELD`
);
assert.equal(undocked.ship.spatial_mode, "FIELD");

const adminShips = await request("/navigation/admin-ships");
const adminShip = adminShips.find((ship) => ship.owner_character_id === characterId);
assert.ok(adminShip);
assert.ok(Number.isFinite(adminShip.position.x));
assert.equal(adminShip.spatial_mode, "FIELD");

const history = await request(
  `/navigation/history?ship_uid=${adminShip.ship_uid}&route_type=standard&limit=10`
);
assert.equal(history.length, 1);
assert.equal(history[0].status, "CANCELED");
assert.equal(history[0].ship_uid, adminShip.ship_uid);
assert.ok(Number.isFinite(history[0].resolved_position.z));

console.log("navigation authority check passed");
