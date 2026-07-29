const ALIGN_ANGLE_THRESHOLD = 0.00447;
const EPSILON = 1e-9;

export function createStandardMovementPlan({
  position,
  rotation,
  speed = 0,
  target,
  physics,
  issuedAt
}) {
  const startPosition = normalizeVector(position);
  const startHeading = quaternionForward(rotation);
  const targetPosition = normalizeVector(target);
  const initialSpeed = finiteNumber(speed);
  const stopRate = initialSpeed > 0
    ? positiveNumber(physics.decelerationRate)
    : initialSpeed < 0
      ? positiveNumber(physics.accelerationRate)
      : 0;
  const stopDuration = stopRate > 0 ? Math.abs(initialSpeed) / stopRate : 0;
  const stopSign = initialSpeed > 0 ? 1 : -1;
  const stopDistance = stopDuration > 0
    ? initialSpeed * stopDuration
      - stopSign * 0.5 * stopRate * stopDuration * stopDuration
    : 0;
  const fromPosition = addScaled(startPosition, startHeading, stopDistance);
  const targetDelta = subtract(targetPosition, fromPosition);
  const targetDirection = normalizeDirection(targetDelta, startHeading);
  const angle = Math.acos(clamp(dot(startHeading, targetDirection), -1, 1));
  const alignRate = Math.min(
    positiveNumber(physics.pitchRate),
    positiveNumber(physics.yawRate)
  );
  const alignDuration = angle > ALIGN_ANGLE_THRESHOLD && alignRate > 0
    ? Math.log(angle / ALIGN_ANGLE_THRESHOLD) / alignRate
    : 0;
  const effectiveDistance = Math.max(
    0,
    length(targetDelta) - nonNegativeNumber(physics.arrivalRadius)
  );
  const peakSpeed = computeAutopilotPeakSpeed(effectiveDistance, physics);
  const flightDuration = computeStandardFlightDuration(effectiveDistance, peakSpeed, physics);
  const stopStartAt = integerTimestamp(issuedAt);
  const alignStartAt = stopStartAt + Math.round(stopDuration * 1000);
  const flightAt = stopStartAt + Math.round((stopDuration + alignDuration) * 1000);

  return {
    routeType: "standard",
    startPosition,
    startHeading,
    startSpeed: initialSpeed,
    fromPosition,
    target: targetPosition,
    heading: targetDirection,
    stopStartAt,
    alignStartAt,
    flightAt,
    arriveAt: flightAt + Math.round(flightDuration * 1000),
    stopDuration,
    alignDuration,
    flightDuration,
    peakSpeed,
    desiredSpeed: 0,
    coastDuration: 0,
    physics: normalizePhysics(physics)
  };
}

export function createHyperdriveMovementPlan({
  position,
  rotation,
  speed = 0,
  target,
  physics,
  issuedAt
}) {
  const startPosition = normalizeVector(position);
  const startHeading = quaternionForward(rotation);
  const targetPosition = normalizeVector(target);
  const initialSpeed = finiteNumber(speed);
  const stopRate = initialSpeed > 0
    ? positiveNumber(physics.decelerationRate)
    : initialSpeed < 0
      ? positiveNumber(physics.accelerationRate)
      : 0;
  const stopDuration = stopRate > 0 ? Math.abs(initialSpeed) / stopRate : 0;
  const stopSign = initialSpeed >= 0 ? 1 : -1;
  const stopDistance = stopDuration > 0
    ? initialSpeed * stopDuration
      - stopSign * 0.5 * stopRate * stopDuration * stopDuration
    : 0;
  const fromPosition = addScaled(startPosition, startHeading, stopDistance);
  const targetDelta = subtract(targetPosition, fromPosition);
  const targetDirection = normalizeDirection(targetDelta, startHeading);
  const angle = Math.acos(clamp(dot(startHeading, targetDirection), -1, 1));
  const alignRate = Math.min(
    positiveNumber(physics.pitchRate),
    positiveNumber(physics.yawRate)
  );
  const alignDuration = angle > ALIGN_ANGLE_THRESHOLD && alignRate > 0
    ? Math.log(angle / ALIGN_ANGLE_THRESHOLD) / alignRate
    : 0;
  const cooldownDuration = nonNegativeNumber(physics.hyperdrive?.cooldownDuration);
  const warpEntryDuration = nonNegativeNumber(physics.hyperdrive?.warpEntryDuration);
  const warpExitDuration = nonNegativeNumber(physics.hyperdrive?.warpExitDuration);
  const warpMinFlightDuration = nonNegativeNumber(physics.hyperdrive?.warpMinFlightDuration);
  const warpFlightSpeed = positiveNumber(physics.hyperdrive?.warpFlightSpeed);
  const warpCruiseDuration = Math.max(
    warpMinFlightDuration,
    warpFlightSpeed > 0 ? length(targetDelta) / warpFlightSpeed : 0
  );
  const flightDuration = warpEntryDuration + warpCruiseDuration + warpExitDuration;
  const stopStartAt = integerTimestamp(issuedAt);
  const alignStartAt = stopStartAt + Math.round(stopDuration * 1000);
  const cooldownStartAt = alignStartAt + Math.round(alignDuration * 1000);
  const flightAt = cooldownStartAt + Math.round(cooldownDuration * 1000);

  return {
    routeType: "hyperdrive",
    startPosition,
    startHeading,
    startSpeed: initialSpeed,
    fromPosition,
    target: targetPosition,
    heading: targetDirection,
    stopStartAt,
    alignStartAt,
    cooldownStartAt,
    flightAt,
    arriveAt: flightAt + Math.round(flightDuration * 1000),
    stopDuration,
    alignDuration,
    cooldownDuration,
    flightDuration,
    warpEntryDuration,
    warpCruiseDuration,
    warpExitDuration,
    peakSpeed: 0,
    desiredSpeed: 0,
    coastDuration: 0,
    physics: normalizePhysics(physics)
  };
}

export function createDeactivationMovementPlan({
  position,
  rotation,
  speed = 0,
  desiredSpeed = 0,
  physics,
  issuedAt
}) {
  const startPosition = normalizeVector(position);
  const heading = quaternionForward(rotation);
  const initialSpeed = finiteNumber(speed);
  const desired = finiteNumber(desiredSpeed);
  const accelerationRate = positiveNumber(physics.accelerationRate);
  const decelerationRate = positiveNumber(physics.decelerationRate);
  const coastDuration = desired === 0
    ? 0
    : nonNegativeNumber(physics.deactivationCoastDuration);
  const coastEnd = computeDeactivationKinematics({
    initialSpeed,
    desiredSpeed: desired,
    accelerationRate,
    decelerationRate,
    coastDuration,
    elapsed: coastDuration
  });
  const stopRate = coastEnd.speed > 0 ? decelerationRate : accelerationRate;
  const flightDuration = coastEnd.speed === 0
    ? Math.abs(desired - initialSpeed) > 0.001
      ? Math.abs(desired - initialSpeed) / (desired < initialSpeed ? decelerationRate : accelerationRate)
      : 0
    : coastDuration + Math.abs(coastEnd.speed) / stopRate;
  const finalState = computeDeactivationKinematics({
    initialSpeed,
    desiredSpeed: desired,
    accelerationRate,
    decelerationRate,
    coastDuration,
    elapsed: flightDuration
  });
  const flightAt = integerTimestamp(issuedAt);
  const target = addScaled(startPosition, heading, finalState.distance);

  return {
    routeType: "deactivation",
    startPosition,
    startHeading: heading,
    startSpeed: initialSpeed,
    fromPosition: startPosition,
    target,
    heading,
    stopStartAt: flightAt,
    alignStartAt: flightAt,
    flightAt,
    arriveAt: flightAt + Math.round(flightDuration * 1000),
    stopDuration: 0,
    alignDuration: 0,
    flightDuration,
    peakSpeed: initialSpeed,
    desiredSpeed: desired,
    coastDuration,
    physics: normalizePhysics(physics)
  };
}

export function deriveMovementState(contract, now = Date.now()) {
  const at = integerTimestamp(now);
  const routeType = contract.routeType;
  if (at >= contract.arriveAt) {
    return {
      position: normalizeVector(contract.target),
      speed: 0,
      desiredSpeed: 0,
      phase: "arrived",
      logicalStatus: "ARRIVED"
    };
  }

  if (routeType === "deactivation") {
    return deriveDeactivationState(contract, at);
  }

  if (at < contract.alignStartAt) {
    return deriveStoppingState(contract, at);
  }
  if (at < contract.flightAt) {
    return {
      position: normalizeVector(contract.fromPosition),
      speed: 0,
      desiredSpeed: 0,
      phase: routeType === "hyperdrive" && at >= contract.cooldownStartAt
        ? "cooldown"
        : "aligning",
      logicalStatus: "ACTIVE"
    };
  }

  if (routeType === "hyperdrive") {
    const elapsed = Math.max(0, (at - contract.flightAt) / 1000);
    const duration = Math.max(EPSILON, contract.flightDuration);
    const progress = clamp(elapsed / duration, 0, 1);
    return {
      position: lerpVector(contract.fromPosition, contract.target, smoothstep(progress)),
      speed: 0,
      desiredSpeed: 0,
      phase: "warping",
      logicalStatus: "ACTIVE"
    };
  }

  const elapsed = Math.max(0, (at - contract.flightAt) / 1000);
  const position = computeStandardPosition(contract, elapsed);
  const speed = computeStandardSpeed(contract, elapsed);
  const accelTime = contract.peakSpeed / positiveNumber(contract.physics.accelerationRate);
  const decelTime = contract.peakSpeed / positiveNumber(contract.physics.decelerationRate);
  const cruiseTime = Math.max(0, contract.flightDuration - accelTime - decelTime);
  const phase = elapsed <= accelTime
    ? "accelerating"
    : elapsed <= accelTime + cruiseTime
      ? "cruising"
      : "decelerating";
  return {
    position,
    speed,
    desiredSpeed: phase === "decelerating" ? 0 : contract.peakSpeed,
    phase,
    logicalStatus: "ACTIVE"
  };
}

export function computeAutopilotPeakSpeed(distance, physics) {
  const maxSpeed = positiveNumber(physics.maxSpeed);
  const accelerationRate = positiveNumber(physics.accelerationRate);
  const decelerationRate = positiveNumber(physics.decelerationRate);
  if (maxSpeed <= 0 || accelerationRate <= 0 || decelerationRate <= 0) return 0;
  const accelDistance = 0.5 * maxSpeed * maxSpeed / accelerationRate;
  const decelDistance = 0.5 * maxSpeed * maxSpeed / decelerationRate;
  if (distance >= accelDistance + decelDistance) return maxSpeed;
  return Math.max(
    0,
    Math.sqrt(
      2 * distance * accelerationRate * decelerationRate
      / (accelerationRate + decelerationRate)
    )
  );
}

export function computeStandardFlightDuration(effectiveDistance, peakSpeed, physics) {
  if (peakSpeed <= 0 || effectiveDistance <= 0) return 0;
  const accelerationRate = positiveNumber(physics.accelerationRate);
  const decelerationRate = positiveNumber(physics.decelerationRate);
  const accelDistance = 0.5 * peakSpeed * peakSpeed / accelerationRate;
  const decelDistance = 0.5 * peakSpeed * peakSpeed / decelerationRate;
  const cruiseDistance = Math.max(0, effectiveDistance - accelDistance - decelDistance);
  return peakSpeed / accelerationRate
    + (cruiseDistance > 0 ? cruiseDistance / peakSpeed : 0)
    + peakSpeed / decelerationRate;
}

export function computeDeactivationKinematics({
  initialSpeed,
  desiredSpeed,
  accelerationRate,
  decelerationRate,
  coastDuration,
  elapsed
}) {
  let distance = 0;
  let speed = finiteNumber(initialSpeed);
  let time = 0;
  const targetSpeed = finiteNumber(desiredSpeed);
  const acceleration = positiveNumber(accelerationRate);
  const deceleration = positiveNumber(decelerationRate);
  const coast = nonNegativeNumber(coastDuration);
  const elapsedTime = nonNegativeNumber(elapsed);

  if (Math.abs(speed - targetSpeed) > 0.001) {
    const accelerating = targetSpeed > speed;
    const rate = accelerating ? acceleration : deceleration;
    const phaseEnd = rate > 0
      ? Math.min(Math.abs(targetSpeed - speed) / rate, coast, elapsedTime)
      : 0;
    distance += speed * phaseEnd
      + (accelerating ? 1 : -1) * 0.5 * rate * phaseEnd * phaseEnd;
    speed = accelerating
      ? Math.min(speed + rate * phaseEnd, targetSpeed)
      : Math.max(speed - rate * phaseEnd, targetSpeed);
    time = phaseEnd;
  }

  if (time >= elapsedTime || speed === 0) return { distance, speed };

  if (time < coast) {
    const phaseEnd = Math.min(coast, elapsedTime);
    distance += speed * (phaseEnd - time);
    time = phaseEnd;
  }

  if (time >= elapsedTime || speed === 0) return { distance, speed };

  const stopRate = speed > 0 ? deceleration : acceleration;
  const decelTime = stopRate > 0
    ? Math.min(elapsedTime - time, Math.abs(speed) / stopRate)
    : 0;
  distance += speed * decelTime
    + (speed < 0 ? 0.5 : -0.5) * stopRate * decelTime * decelTime;
  speed = speed > 0
    ? Math.max(0, speed - stopRate * decelTime)
    : Math.min(0, speed + stopRate * decelTime);
  return { distance, speed };
}

export function quaternionForward(value) {
  const quaternion = normalizeQuaternion(value);
  const x = 2 * (quaternion.x * quaternion.z + quaternion.w * quaternion.y);
  const y = 2 * (quaternion.y * quaternion.z - quaternion.w * quaternion.x);
  const z = 1 - 2 * (quaternion.x * quaternion.x + quaternion.y * quaternion.y);
  return normalizeDirection({ x, y, z }, { x: 0, y: 0, z: 1 });
}

function deriveStoppingState(contract, at) {
  const elapsed = Math.max(0, (at - contract.stopStartAt) / 1000);
  const duration = Math.max(0, contract.stopDuration);
  const time = Math.min(elapsed, duration);
  const initialSpeed = finiteNumber(contract.startSpeed);
  const rate = initialSpeed > 0
    ? positiveNumber(contract.physics.decelerationRate)
    : positiveNumber(contract.physics.accelerationRate);
  const sign = initialSpeed > 0 ? 1 : -1;
  const distance = duration > 0
    ? initialSpeed * time - sign * 0.5 * rate * time * time
    : 0;
  const speed = initialSpeed > 0
    ? Math.max(0, initialSpeed - rate * time)
    : Math.min(0, initialSpeed + rate * time);
  return {
    position: addScaled(contract.startPosition, contract.startHeading, distance),
    speed,
    desiredSpeed: 0,
    phase: "stopping",
    logicalStatus: "ACTIVE"
  };
}

function deriveDeactivationState(contract, at) {
  const elapsed = Math.max(0, (at - contract.flightAt) / 1000);
  const state = computeDeactivationKinematics({
    initialSpeed: contract.peakSpeed,
    desiredSpeed: contract.desiredSpeed,
    accelerationRate: contract.physics.accelerationRate,
    decelerationRate: contract.physics.decelerationRate,
    coastDuration: contract.coastDuration,
    elapsed: Math.min(elapsed, contract.flightDuration)
  });
  return {
    position: addScaled(contract.fromPosition, contract.heading, state.distance),
    speed: state.speed,
    desiredSpeed: contract.desiredSpeed,
    phase: "deactivation",
    logicalStatus: "ACTIVE"
  };
}

function computeStandardPosition(contract, elapsed) {
  const from = normalizeVector(contract.fromPosition);
  const target = normalizeVector(contract.target);
  const delta = subtract(target, from);
  const totalDistance = length(delta);
  const effectiveDistance = Math.max(
    0,
    totalDistance - nonNegativeNumber(contract.physics.arrivalRadius)
  );
  if (effectiveDistance <= 0) return target;
  const direction = normalizeDirection(delta);
  const accelerationRate = positiveNumber(contract.physics.accelerationRate);
  const decelerationRate = positiveNumber(contract.physics.decelerationRate);
  const peakSpeed = nonNegativeNumber(contract.peakSpeed);
  const accelTime = peakSpeed / accelerationRate;
  const accelDistance = 0.5 * peakSpeed * peakSpeed / accelerationRate;
  const decelDistance = 0.5 * peakSpeed * peakSpeed / decelerationRate;
  const cruiseDistance = Math.max(0, effectiveDistance - accelDistance - decelDistance);
  const cruiseTime = cruiseDistance > 0 ? cruiseDistance / peakSpeed : 0;
  const time = Math.min(elapsed, contract.flightDuration);
  let traveled;
  if (time <= accelTime) {
    traveled = 0.5 * accelerationRate * time * time;
  } else if (time <= accelTime + cruiseTime) {
    traveled = accelDistance + peakSpeed * (time - accelTime);
  } else {
    const decelTime = time - accelTime - cruiseTime;
    traveled = accelDistance + cruiseDistance
      + peakSpeed * decelTime
      - 0.5 * decelerationRate * decelTime * decelTime;
  }
  return addScaled(from, direction, Math.min(traveled, effectiveDistance));
}

function computeStandardSpeed(contract, elapsed) {
  const peakSpeed = nonNegativeNumber(contract.peakSpeed);
  if (peakSpeed <= 0) return 0;
  const accelerationRate = positiveNumber(contract.physics.accelerationRate);
  const decelerationRate = positiveNumber(contract.physics.decelerationRate);
  const accelTime = peakSpeed / accelerationRate;
  const decelTime = peakSpeed / decelerationRate;
  const cruiseTime = Math.max(0, contract.flightDuration - accelTime - decelTime);
  const time = Math.min(elapsed, contract.flightDuration);
  if (time <= accelTime) return accelerationRate * time;
  if (time <= accelTime + cruiseTime) return peakSpeed;
  return Math.max(0, peakSpeed - decelerationRate * (time - accelTime - cruiseTime));
}

function normalizePhysics(value = {}) {
  return {
    maxSpeed: positiveNumber(value.maxSpeed),
    minSpeed: finiteNumber(value.minSpeed),
    accelerationRate: positiveNumber(value.accelerationRate),
    decelerationRate: positiveNumber(value.decelerationRate),
    arrivalRadius: nonNegativeNumber(value.arrivalRadius),
    deactivationCoastDuration: nonNegativeNumber(value.deactivationCoastDuration),
    pitchRate: positiveNumber(value.pitchRate),
    yawRate: positiveNumber(value.yawRate),
    strafeRate: nonNegativeNumber(value.strafeRate),
    verticalRate: nonNegativeNumber(value.verticalRate),
    hyperdrive: {
      cooldownDuration: nonNegativeNumber(value.hyperdrive?.cooldownDuration),
      warpEntryDuration: nonNegativeNumber(value.hyperdrive?.warpEntryDuration),
      warpExitDuration: nonNegativeNumber(value.hyperdrive?.warpExitDuration),
      warpMinFlightDuration: nonNegativeNumber(value.hyperdrive?.warpMinFlightDuration),
      warpFlightSpeed: positiveNumber(value.hyperdrive?.warpFlightSpeed)
    }
  };
}

function normalizeQuaternion(value = {}) {
  const quaternion = {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    z: finiteNumber(value.z),
    w: Number.isFinite(Number(value.w)) ? Number(value.w) : 1
  };
  const magnitude = Math.hypot(
    quaternion.x,
    quaternion.y,
    quaternion.z,
    quaternion.w
  ) || 1;
  return {
    x: quaternion.x / magnitude,
    y: quaternion.y / magnitude,
    z: quaternion.z / magnitude,
    w: quaternion.w / magnitude
  };
}

function normalizeVector(value = {}) {
  return {
    x: finiteNumber(value.x),
    y: finiteNumber(value.y),
    z: finiteNumber(value.z)
  };
}

function normalizeDirection(value = {}, fallback = { x: 0, y: 0, z: 1 }) {
  const vector = normalizeVector(value);
  const magnitude = length(vector);
  if (magnitude <= EPSILON) {
    const fallbackVector = normalizeVector(fallback);
    const fallbackMagnitude = length(fallbackVector);
    if (fallbackMagnitude > EPSILON) {
      return {
        x: fallbackVector.x / fallbackMagnitude,
        y: fallbackVector.y / fallbackMagnitude,
        z: fallbackVector.z / fallbackMagnitude
      };
    }
  }
  return magnitude > EPSILON
    ? { x: vector.x / magnitude, y: vector.y / magnitude, z: vector.z / magnitude }
    : { x: 0, y: 0, z: 1 };
}

function addScaled(position, direction, scale) {
  return {
    x: finiteNumber(position?.x) + finiteNumber(direction?.x) * scale,
    y: finiteNumber(position?.y) + finiteNumber(direction?.y) * scale,
    z: finiteNumber(position?.z) + finiteNumber(direction?.z) * scale
  };
}

function subtract(a, b) {
  return {
    x: finiteNumber(a?.x) - finiteNumber(b?.x),
    y: finiteNumber(a?.y) - finiteNumber(b?.y),
    z: finiteNumber(a?.z) - finiteNumber(b?.z)
  };
}

function lerpVector(a, b, amount) {
  return {
    x: finiteNumber(a?.x) + (finiteNumber(b?.x) - finiteNumber(a?.x)) * amount,
    y: finiteNumber(a?.y) + (finiteNumber(b?.y) - finiteNumber(a?.y)) * amount,
    z: finiteNumber(a?.z) + (finiteNumber(b?.z) - finiteNumber(a?.z)) * amount
  };
}

function length(value) {
  return Math.hypot(
    finiteNumber(value?.x),
    finiteNumber(value?.y),
    finiteNumber(value?.z)
  );
}

function dot(a, b) {
  return finiteNumber(a?.x) * finiteNumber(b?.x)
    + finiteNumber(a?.y) * finiteNumber(b?.y)
    + finiteNumber(a?.z) * finiteNumber(b?.z);
}

function smoothstep(value) {
  return value * value * (3 - 2 * value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function positiveNumber(value) {
  return Math.max(EPSILON, finiteNumber(value));
}

function nonNegativeNumber(value) {
  return Math.max(0, finiteNumber(value));
}

function integerTimestamp(value) {
  const timestamp = Number(value);
  return Number.isFinite(timestamp) ? Math.round(timestamp) : Date.now();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}
