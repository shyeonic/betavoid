import assert from "node:assert/strict";
import {
  createDeactivationMovementPlan,
  createHyperdriveMovementPlan,
  createStandardMovementPlan,
  deriveMovementState
} from "../js/navigationKinematics.js";

const physics = {
  maxSpeed: 100,
  minSpeed: -20,
  accelerationRate: 24,
  decelerationRate: 32,
  arrivalRadius: 10,
  deactivationCoastDuration: 5,
  pitchRate: 2,
  yawRate: 2,
  hyperdrive: {
    cooldownDuration: 8,
    warpEntryDuration: 1,
    warpExitDuration: 1,
    warpMinFlightDuration: 2,
    warpFlightSpeed: 4000
  }
};
const rotation = { x: 0, y: 0, z: 0, w: 1 };
const issuedAt = 1_000_000;

const standard = createStandardMovementPlan({
  position: { x: 0, y: 0, z: 0 },
  rotation,
  speed: 50,
  target: { x: 0, y: 0, z: 1000 },
  physics,
  issuedAt
});
assert.equal(standard.stopDuration, 50 / 32);
assert.equal(deriveMovementState(standard, standard.arriveAt).phase, "arrived");
assert.deepEqual(
  deriveMovementState(standard, standard.arriveAt).position,
  standard.target
);

const hyperdrive = createHyperdriveMovementPlan({
  position: { x: 0, y: 0, z: 0 },
  rotation,
  speed: 0,
  target: { x: 0, y: 0, z: 20_000 },
  physics,
  issuedAt
});
assert.equal(
  deriveMovementState(hyperdrive, hyperdrive.flightAt - 1).phase,
  "cooldown"
);
assert.equal(
  deriveMovementState(hyperdrive, hyperdrive.flightAt).phase,
  "warping"
);

const deactivation = createDeactivationMovementPlan({
  position: { x: 10, y: 20, z: 30 },
  rotation,
  speed: 80,
  desiredSpeed: 80,
  physics,
  issuedAt
});
const stopped = deriveMovementState(deactivation, deactivation.arriveAt);
assert.equal(stopped.speed, 0);
assert.equal(stopped.phase, "arrived");
assert.ok(stopped.position.z > 30);

console.log("navigation kinematics check passed");
