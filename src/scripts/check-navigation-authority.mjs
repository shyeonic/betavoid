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

function commandWindow(now = Date.now()) {
  return { issued_at: now, expires_at: now + 5_000, server_now: now };
}

function assertVector(actual, expected) {
  assert.ok(Math.abs(actual.x - expected.x) < 0.001);
  assert.ok(Math.abs(actual.y - expected.y) < 0.001);
  assert.ok(Math.abs(actual.z - expected.z) < 0.001);
}

let world = await request("/state");
const initialResourceCount = world.snapshot.resource_nodes.length;
const resourceCheckInterval = Number(world.snapshot.resource_manager.check_interval);
const reconcileAt = Number(world.snapshot.resource_manager.next_check) + resourceCheckInterval * 2;
const reconciliation = await request("/reconcile", {
  method: "POST",
  body: { server_now: reconcileAt }
});
assert.equal(reconciliation.changed, true);
assert.equal(reconciliation.cycles, 3);
const duplicateReconciliation = await request("/reconcile", {
  method: "POST",
  body: { server_now: reconcileAt }
});
assert.equal(duplicateReconciliation.changed, false);
world = await request(`/state?server_now=${reconcileAt}`);
assert.ok(world.snapshot.resource_nodes.length > initialResourceCount);
world = await request("/rebuild", {
  method: "POST",
  body: { expected_revision: world.revision }
});
const dockStorage = world.snapshot.building_storages.find((entry) => entry.docking_capacity > 0);
const dockBuilding = world.snapshot.buildings.find(
  (entry) => entry.building_instance_id === dockStorage.world_object_id
);
const betaVoid = world.snapshot.beta_voids.find((entry) => entry.status === "active");
assert.ok(dockBuilding);
assert.ok(betaVoid);

const initial = await request(`/navigation?character_id=${characterId}`);
assert.equal(initial.character_id, characterId);
assert.equal(initial.ship.spatial_mode, "FIELD");
assert.equal(initial.active_contract, null);

const targetedInitial = await request(
  `/observe-space?character_id=${characterId}&limit=1&server_now=${initial.server_time}`
);
assert.equal(targetedInitial.scope, "ship");
assert.equal(targetedInitial.peers.length, 1);
assert.equal(targetedInitial.peers[0].character_id, characterId);
assertVector(targetedInitial.peers[0].pose.position, initial.ship.position);

const impossibleCharacterId = `impossible-action-${Date.now()}`;
const impossibleInitial = await request(`/navigation?character_id=${impossibleCharacterId}`);
const impossibleNow = impossibleInitial.ship.checkpoint_at + 1_000;
await assert.rejects(
  request("/navigation/start", {
    method: "POST",
    body: {
      character_id: impossibleCharacterId,
      client_action_id: `impossible-${impossibleCharacterId}`,
      expected_revision: impossibleInitial.ship.revision,
      route_type: "standard",
      target: impossibleInitial.ship.position,
      observed_ship: {
        position: {
          x: impossibleInitial.ship.position.x + (
            impossibleInitial.ship.position.x > 0 ? -100_000_000 : 100_000_000
          ),
          y: impossibleInitial.ship.position.y,
          z: impossibleInitial.ship.position.z
        },
        rotation: impossibleInitial.ship.rotation,
        speed: 0,
        desired_speed: 0
      },
      ...commandWindow(impossibleNow)
    }
  }),
  (error) => error?.code === "MANUAL_POSITION_OUT_OF_RANGE"
);

const expiredAt = Date.now();
await assert.rejects(
  request("/navigation/start", {
    method: "POST",
    body: {
      character_id: characterId,
      client_action_id: `expired-${characterId}`,
      expected_revision: initial.ship.revision,
      route_type: "standard",
      target: initial.ship.position,
      observed_ship: {
        position: initial.ship.position,
        rotation: initial.ship.rotation,
        speed: 0,
        desired_speed: 0
      },
      issued_at: expiredAt - 6_000,
      expires_at: expiredAt - 1_000,
      server_now: expiredAt
    }
  }),
  (error) => error?.code === "MOVEMENT_COMMAND_EXPIRED"
);

const arrivalRaceCharacterId = `arrival-race-${Date.now()}`;
const arrivalRaceInitial = await request(
  `/navigation?character_id=${arrivalRaceCharacterId}`
);
const arrivalRaceTarget = {
  ...arrivalRaceInitial.ship.position,
  x: arrivalRaceInitial.ship.position.x + 1_000
};
const arrivalRaceStartAt = Date.now();
const arrivalRaceStarted = await request("/navigation/start", {
  method: "POST",
  body: {
    character_id: arrivalRaceCharacterId,
    client_action_id: `arrival-race-start-${arrivalRaceCharacterId}`,
    expected_revision: arrivalRaceInitial.ship.revision,
    route_type: "standard",
    target: arrivalRaceTarget,
    observed_ship: {
      position: arrivalRaceInitial.ship.position,
      rotation: arrivalRaceInitial.ship.rotation,
      speed: 0,
      desired_speed: 0
    },
    ...commandWindow(arrivalRaceStartAt)
  }
});
const arrivalRaceNextAt = arrivalRaceStarted.active_contract.arrive_at + 1;
const arrivalRaceNextTarget = {
  ...arrivalRaceTarget,
  x: arrivalRaceTarget.x + 1_000
};
const arrivalRaceNext = await request("/navigation/start", {
  method: "POST",
  body: {
    character_id: arrivalRaceCharacterId,
    client_action_id: `arrival-race-next-${arrivalRaceCharacterId}`,
    expected_revision: arrivalRaceStarted.ship.revision,
    route_type: "standard",
    target: arrivalRaceNextTarget,
    observed_ship: {
      position: arrivalRaceTarget,
      rotation: arrivalRaceStarted.ship.rotation,
      speed: 0,
      desired_speed: 0
    },
    ...commandWindow(arrivalRaceNextAt)
  }
});
assert.ok(arrivalRaceNext.active_contract);
assert.equal(arrivalRaceNext.ship.revision, arrivalRaceStarted.ship.revision + 2);
assertVector(arrivalRaceNext.active_contract.start_position, arrivalRaceTarget);
await assert.rejects(
  request("/navigation/start", {
    method: "POST",
    body: {
      character_id: arrivalRaceCharacterId,
      client_action_id: `arrival-race-stale-${arrivalRaceCharacterId}`,
      expected_revision: arrivalRaceStarted.ship.revision,
      route_type: "standard",
      target: arrivalRaceNextTarget,
      observed_ship: {
        position: arrivalRaceTarget,
        rotation: arrivalRaceNext.ship.rotation,
        speed: 0,
        desired_speed: 0
      },
      ...commandWindow(arrivalRaceNextAt + 1)
    }
  }),
  (error) => error?.code === "MOVEMENT_REVISION_CONFLICT"
);

const startAt = Date.now() + 10;
const startBody = {
  character_id: characterId,
  client_action_id: `standard-${characterId}`,
  expected_revision: initial.ship.revision,
  route_type: "standard",
  target: dockBuilding.position,
  observed_ship: {
    position: initial.ship.position,
    rotation: initial.ship.rotation,
    speed: 0,
    desired_speed: 0
  },
  ...commandWindow(startAt)
};
const standard = await request("/navigation/start", { method: "POST", body: startBody });
const duplicate = await request("/navigation/start", { method: "POST", body: startBody });
assert.equal(duplicate.active_contract.contract_id, standard.active_contract.contract_id);

const receipt = await request(
  `/navigation/command-result?character_id=${characterId}&client_action_id=${startBody.client_action_id}`
);
assert.equal(receipt.status, "ACCEPTED");
assert.equal(receipt.navigation.active_contract.contract_id, standard.active_contract.contract_id);
assert.ok(receipt.checked_at >= receipt.recorded_at);

const arrivalNow = standard.active_contract.arrive_at + 1;
const arrivalZone = await request(
  `/zone-ships?zone_id=${dockBuilding.sector_id}&excluded_character_id=someone-else&server_now=${arrivalNow}`
);
const arrivedPeer = arrivalZone.peers.find((peer) => peer.character_id === characterId);
assert.ok(arrivedPeer);
assert.equal(arrivedPeer.route, null);
assertVector(arrivedPeer.pose.position, dockBuilding.position);
const arrived = await request(
  `/navigation?character_id=${characterId}&server_now=${arrivalNow}`
);
assert.equal(arrived.ship.phase, "arrived");
assert.equal(arrived.ship.revision, standard.ship.revision);
assertVector(arrived.ship.position, dockBuilding.position);

const dockNow = arrivalNow + 1;
const docked = await request("/navigation/dock", {
  method: "POST",
  body: {
    character_id: characterId,
    client_action_id: `dock-${characterId}`,
    expected_revision: arrived.ship.revision,
    building_id: dockBuilding.building_instance_id,
    observed_ship: {
      position: arrived.ship.position,
      rotation: arrived.ship.rotation,
      speed: 0,
      desired_speed: 0
    },
    ...commandWindow(dockNow)
  }
});
assert.equal(docked.ship.spatial_mode, "DOCKED");
assert.equal(docked.ship.phase, "arrived");
assert.equal(docked.ship.position, null);
assert.equal(docked.custody.id, dockBuilding.building_instance_id);
const observedDocked = await request(
  `/observe-space?ship_uid=${docked.ship.ship_uid}&limit=1&server_now=${dockNow + 1}`
);
assert.equal(observedDocked.peers[0].spatial_mode, "DOCKED");
assert.equal(observedDocked.peers[0].pose, null);

const movedBuildingPosition = {
  x: dockBuilding.position.x + 777,
  y: dockBuilding.position.y + 888,
  z: dockBuilding.position.z + 999
};
await request("/test/move-entity", {
  method: "POST",
  body: {
    entity_type: "building",
    entity_id: dockBuilding.building_instance_id,
    position: movedBuildingPosition
  }
});
const movedCustody = await request(
  `/navigation?character_id=${characterId}&server_now=${dockNow + 1}`
);
assert.equal(movedCustody.ship.position, null);
assertVector(movedCustody.custody.resolved_position, movedBuildingPosition);

const undockNow = dockNow + 2;
const undocked = await request("/navigation/undock", {
  method: "POST",
  body: {
    character_id: characterId,
    client_action_id: `undock-${characterId}`,
    expected_revision: movedCustody.ship.revision,
    building_id: dockBuilding.building_instance_id,
    ...commandWindow(undockNow)
  }
});
assert.equal(undocked.ship.spatial_mode, "FIELD");
assert.equal(undocked.ship.phase, "manual");
assert.equal(undocked.custody, null);
assertVector(undocked.ship.position, {
  ...movedBuildingPosition,
  z: movedBuildingPosition.z + 10
});

const betaEnterNow = undockNow + 1;
await assert.rejects(
  request("/beta-process", {
    method: "POST",
    body: {
      character_id: characterId,
      beta_void_id: betaVoid.id,
      expected_generation: betaVoid.variant_generation,
      client_action_id: `process-without-session-${characterId}`,
      ...commandWindow(betaEnterNow)
    }
  }),
  (error) => error?.code === "BETA_VOID_SESSION_REQUIRED"
);
const entered = await request("/navigation/beta-enter", {
  method: "POST",
  body: {
    character_id: characterId,
    client_action_id: `beta-enter-${characterId}`,
    expected_revision: undocked.ship.revision,
    beta_void_id: betaVoid.id,
    expected_generation: betaVoid.variant_generation,
    observed_ship: {
      position: undocked.ship.position,
      rotation: undocked.ship.rotation,
      speed: undocked.ship.speed,
      desired_speed: undocked.ship.desired_speed
    },
    ...commandWindow(betaEnterNow)
  }
});
assert.equal(entered.ship.spatial_mode, "BETA_SPACE");
const returnAnchor = entered.beta_space_session.return_anchor;
assertVector(returnAnchor.position, undocked.ship.position);
const processAt = betaEnterNow + 1;
const processBody = {
  character_id: characterId,
  beta_void_id: betaVoid.id,
  expected_generation: betaVoid.variant_generation,
  client_action_id: `process-${characterId}`,
  ...commandWindow(processAt)
};
const processed = await request("/beta-process", { method: "POST", body: processBody });
const duplicateProcess = await request("/beta-process", { method: "POST", body: processBody });
assert.equal(processed.entity.status, "defeated");
assert.deepEqual(duplicateProcess, processed);
const worldAfterProcess = await request(`/state?server_now=${processAt}`);
assert.equal(worldAfterProcess.revision, world.revision + 1);
assert.equal(
  worldAfterProcess.snapshot.beta_voids.find((entry) => entry.id === betaVoid.id)?.status,
  "defeated"
);
const betaSpaceZone = await request(
  `/zone-ships?zone_id=BETA-SPACE&excluded_character_id=someone-else&server_now=${betaEnterNow + 1}`
);
assert.ok(betaSpaceZone.peers.some((peer) => peer.character_id === characterId));

await request("/test/move-entity", {
  method: "POST",
  body: {
    entity_type: "beta_void",
    entity_id: betaVoid.id,
    position: {
      x: betaVoid.position.x + 1_000_000,
      y: betaVoid.position.y + 1_000_000,
      z: betaVoid.position.z + 1_000_000
    },
    variant_generation: betaVoid.variant_generation + 1
  }
});
const expiredZone = await request(
  `/zone-ships?zone_id=${undocked.ship.sector_id}&excluded_character_id=someone-else&server_now=${entered.beta_space_session.expires_at + 1}`
);
assert.ok(expiredZone.peers.some((peer) => peer.character_id === characterId));
const expired = await request(
  `/navigation?character_id=${characterId}&server_now=${entered.beta_space_session.expires_at + 2}`
);
assert.equal(expired.ship.spatial_mode, "FIELD");
assert.equal(expired.beta_space_session, null);
assert.equal(expired.ship.revision, entered.ship.revision);
assertVector(expired.ship.position, returnAnchor.position);

const zone = await request(
  `/zone-ships?zone_id=${expired.ship.sector_id}&excluded_character_id=someone-else&server_now=${entered.beta_space_session.expires_at + 3}`
);
assert.ok(zone.peers.some((peer) => peer.character_id === characterId));

const adminShips = await request(
  `/navigation/admin-ships?server_now=${entered.beta_space_session.expires_at + 4}`
);
const adminShip = adminShips.find((ship) => ship.owner_character_id === characterId);
assert.ok(adminShip);
assert.equal(adminShip.spatial_mode, "FIELD");

const history = await request(
  `/navigation/history?ship_uid=${adminShip.ship_uid}&route_type=standard&limit=10`
);
assert.equal(history.length, 1);
assert.equal(history[0].status, "ARRIVED");

const manualCharacterId = `manual-override-${Date.now()}`;
const manualInitial = await request(`/navigation?character_id=${manualCharacterId}`);
const manualStartAt = Date.now();
const manualStart = await request("/navigation/start", {
  method: "POST",
  body: {
    character_id: manualCharacterId,
    client_action_id: `standard-${manualCharacterId}`,
    expected_revision: manualInitial.ship.revision,
    route_type: "standard",
    target: {
      x: manualInitial.ship.position.x + 100_000,
      y: manualInitial.ship.position.y,
      z: manualInitial.ship.position.z
    },
    observed_ship: {
      position: manualInitial.ship.position,
      rotation: manualInitial.ship.rotation,
      speed: 0,
      desired_speed: 0
    },
    ...commandWindow(manualStartAt)
  }
});
const manualOverride = await request("/navigation/override", {
  method: "POST",
  body: {
    character_id: manualCharacterId,
    client_action_id: `override-${manualCharacterId}`,
    expected_revision: manualStart.ship.revision,
    contract_id: manualStart.active_contract.contract_id,
    desired_speed: 500,
    ...commandWindow(manualStartAt + 100)
  }
});
assert.equal(manualOverride.active_contract, null);
assert.equal(manualOverride.ship.desired_speed, 500);

console.log("navigation authority check passed");
