import assert from "node:assert/strict";
import {
  ManualMovementSettlementTracker,
  isManualMovementActive
} from "../js/manualMovementSettlement.js";

const tracker = new ManualMovementSettlementTracker();

for (let index = 0; index < 36_000; index += 1) {
  assert.equal(tracker.observe({ eligible: true, moving: false }), false);
}

assert.equal(isManualMovementActive({
  autopilotPhase: null,
  speed: 10,
  desiredSpeed: 10,
  controlActive: false
}), true);
assert.equal(tracker.observe({ eligible: true, moving: true }), false);
assert.equal(tracker.observe({ eligible: true, moving: true }), false);
assert.equal(tracker.observe({ eligible: true, moving: false }), true);
assert.equal(tracker.observe({ eligible: true, moving: false }), false);

assert.equal(isManualMovementActive({
  autopilotPhase: null,
  speed: 0,
  desiredSpeed: 0,
  controlActive: true
}), true);
assert.equal(isManualMovementActive({
  autopilotPhase: "cruising",
  speed: 100,
  desiredSpeed: 100,
  controlActive: true
}), false);

tracker.observe({ eligible: true, moving: true });
assert.equal(tracker.observe({ eligible: false, moving: false }), false);
assert.equal(tracker.observe({ eligible: true, moving: false }), false);

console.log("manual movement settlement check passed");
