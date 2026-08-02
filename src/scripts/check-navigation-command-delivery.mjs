import assert from "node:assert/strict";
import { WorldDataManager } from "../js/WorldDataManager.js";

function navigationState(revision = 1) {
  const now = Date.now();
  return {
    characterId: "delivery-test",
    ship: {
      shipUid: "ship-delivery-test-ship_01-001",
      worldId: "primary",
      ownerCharacterId: "delivery-test",
      displayName: "Delivery Test",
      shipDefinitionId: "ship_01",
      spatialMode: "FIELD",
      position: { x: 1, y: 2, z: 3 },
      resolvedPosition: null,
      rotation: { x: 0, y: 0, z: 0, w: 1 },
      speed: 0,
      desiredSpeed: 0,
      sectorId: "SEC-001",
      chunkId: "0:0:0",
      phase: "manual",
      revision,
      checkpointAt: now,
      updatedAt: now
    },
    custody: null,
    betaSpaceSession: null,
    activeContract: null,
    serverTime: now
  };
}

function managerWith(api) {
  const manager = Object.create(WorldDataManager.prototype);
  manager.onlineApi = api;
  manager.navigationServerMutationChain = Promise.resolve();
  manager.navigationServerState = navigationState();
  manager.navigationServerReceivedAt = Date.now();
  manager.navigationServerClockOffsetMs = 0;
  manager.onNavigationCommandStatus = null;
  manager.refreshNavigationState = async () => manager.navigationServerState;
  return manager;
}

{
  const order = [];
  const manager = managerWith({});
  manager.refreshNavigationState = async () => {
    order.push("arrival-refresh");
    manager.navigationServerState = navigationState(2);
    return manager.navigationServerState;
  };
  const reconciliation = manager.reconcileNavigationArrival({ delayMs: 0 });
  const followingCommand = manager.queueNavigationServerMutation(async () => {
    order.push("following-command");
    return manager.navigationServerState.ship.revision;
  });
  assert.equal((await reconciliation).ship.revision, 2);
  assert.equal(await followingCommand, 2);
  assert.deepEqual(order, ["arrival-refresh", "following-command"]);
}

{
  let mutationCalls = 0;
  let receiptCalls = 0;
  const accepted = navigationState(2);
  const checkedAt = Date.now() + 2_000;
  const manager = managerWith({
    async getNavigationCommandResult() {
      receiptCalls += 1;
      return { status: "ACCEPTED", navigation: accepted, checkedAt };
    }
  });
  const result = await manager.runNavigationCommand(
    "delivery-accepted",
    { localExpiresAt: Date.now() + 100 },
    async () => {
      mutationCalls += 1;
      const error = new Error("response lost");
      error.status = 0;
      throw error;
    }
  );
  assert.equal(mutationCalls, 1);
  assert.equal(receiptCalls, 1);
  assert.equal(result.ship.revision, 2);
  assert.ok(Math.abs(manager.getEstimatedNavigationServerNow() - checkedAt) < 100);
}

{
  let mutationCalls = 0;
  let receiptCalls = 0;
  const manager = managerWith({
    async getNavigationCommandResult() {
      receiptCalls += 1;
      const error = new Error("not recorded");
      error.code = "MOVEMENT_COMMAND_NOT_FOUND";
      error.status = 404;
      throw error;
    }
  });
  await assert.rejects(
    manager.runNavigationCommand(
      "delivery-expired",
      { localExpiresAt: Date.now() },
      async () => {
        mutationCalls += 1;
        const error = new Error("network unavailable");
        error.status = 0;
        throw error;
      }
    ),
    (error) => error?.code === "MOVEMENT_COMMAND_NOT_CONFIRMED"
  );
  assert.equal(mutationCalls, 1);
  assert.ok(receiptCalls >= 1);
}

{
  let mutationCalls = 0;
  const accepted = navigationState(2);
  accepted.activeContract = {
    clientActionId: "delivery-state-confirmed"
  };
  const manager = managerWith({
    async getNavigationCommandResult() {
      const error = new Error("receipt unavailable");
      error.code = "MOVEMENT_COMMAND_NOT_FOUND";
      error.status = 404;
      throw error;
    }
  });
  manager.refreshNavigationState = async () => {
    manager.navigationServerState = accepted;
    return accepted;
  };
  const result = await manager.runNavigationCommand(
    "delivery-state-confirmed",
    { localExpiresAt: Date.now() },
    async () => {
      mutationCalls += 1;
      const error = new Error("response lost");
      error.status = 0;
      throw error;
    }
  );
  assert.equal(mutationCalls, 1);
  assert.equal(result.activeContract.clientActionId, "delivery-state-confirmed");
}

console.log("navigation command delivery check passed");
