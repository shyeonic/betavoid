import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { evaluateActionPositionObservation } from "../workers/beta-void-api/src/action-position-validation.js";

const anchor = { x: 100, y: 200, z: 300 };
const common = {
  authoritativePosition: anchor,
  checkpointAt: 1_000,
  serverNow: 11_000,
  maximumCombinedSpeed: 50,
  networkGraceSeconds: 2,
  fixedBuffer: 10
};

const reachable = evaluateActionPositionObservation({
  ...common,
  observedPosition: { x: 700, y: 200, z: 300 }
});
assert.equal(reachable.allowance, 610);
assert.equal(reachable.distance, 600);
assert.equal(reachable.valid, true);

const impossible = evaluateActionPositionObservation({
  ...common,
  observedPosition: { x: 711, y: 200, z: 300 }
});
assert.equal(impossible.distance, 611);
assert.equal(impossible.valid, false);

const noElapsedTime = evaluateActionPositionObservation({
  ...common,
  checkpointAt: 11_000,
  observedPosition: { x: 210, y: 200, z: 300 }
});
assert.equal(noElapsedTime.allowance, 110);
assert.equal(noElapsedTime.valid, true);

const gameManagerSource = await readFile(
  new URL("../js/GameManager.js", import.meta.url),
  "utf8"
);
assert.doesNotMatch(gameManagerSource, /new OnlinePresenceClient/);
assert.doesNotMatch(gameManagerSource, /updateManualMovementSettlement/);
assert.doesNotMatch(gameManagerSource, /MANUAL_STOPPED/);
assert.doesNotMatch(gameManagerSource, /betaVoidLifecycleInterval/);
assert.doesNotMatch(gameManagerSource, /updateBetaVoidLifecycle/);
assert.match(gameManagerSource, /async observeOnlineSpace/);
const workerIndexSource = await readFile(
  new URL("../workers/beta-void-api/src/index.js", import.meta.url),
  "utf8"
);
assert.doesNotMatch(workerIndexSource, /\/v1\/navigation\/checkpoint/);
assert.doesNotMatch(workerIndexSource, /\/v1\/player\/ship-state/);

console.log("action position validation check passed");
