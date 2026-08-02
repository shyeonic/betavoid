import assert from "node:assert/strict";
import {
  deriveManualNavigationProjection,
  integrateManualSpeed
} from "../js/manualNavigationProjection.js";

const accelerated = integrateManualSpeed({
  speed: 0,
  desiredSpeed: 100,
  accelerationRate: 20,
  decelerationRate: 40,
  elapsedSeconds: 10
});
assert.equal(accelerated.speed, 100);
assert.equal(accelerated.distance, 750);

const decelerated = integrateManualSpeed({
  speed: 100,
  desiredSpeed: 0,
  accelerationRate: 20,
  decelerationRate: 50,
  elapsedSeconds: 5
});
assert.equal(decelerated.speed, 0);
assert.equal(decelerated.distance, 100);

const projection = deriveManualNavigationProjection({
  position: { x: 10, y: 20, z: 30 },
  rotation: { x: 0, y: 0, z: 0, w: 1 },
  speed: 0,
  desired_speed: 100,
  saved_at: 1_000
}, 11_000, {
  minSpeed: -20,
  maxSpeed: 100,
  accelerationRate: 20,
  decelerationRate: 40
});
assert.deepEqual(projection.position, { x: 10, y: 20, z: 780 });
assert.equal(projection.speed, 100);
assert.equal(projection.saved_at, 11_000);

console.log("manual navigation projection check passed");
