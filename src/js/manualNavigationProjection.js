import { quaternionForward } from "./navigationKinematics.js";

export const MANUAL_NAVIGATION_PROJECTION_VERSION = 1;

export function deriveManualNavigationProjection(projection, now, physics) {
  const savedAt = finiteTimestamp(projection?.saved_at);
  const targetAt = Math.max(savedAt, finiteTimestamp(now));
  const elapsedSeconds = Math.max(0, targetAt - savedAt) / 1000;
  const speed = finiteNumber(projection?.speed);
  const desiredSpeed = clamp(
    finiteNumber(projection?.desired_speed, speed),
    finiteNumber(physics?.minSpeed),
    finiteNumber(physics?.maxSpeed)
  );
  const movement = integrateManualSpeed({
    speed,
    desiredSpeed,
    accelerationRate: positiveNumber(physics?.accelerationRate),
    decelerationRate: positiveNumber(physics?.decelerationRate),
    elapsedSeconds
  });
  const heading = quaternionForward(projection?.rotation);
  const position = normalizeVector(projection?.position);

  return {
    ...projection,
    position: {
      x: position.x + heading.x * movement.distance,
      y: position.y + heading.y * movement.distance,
      z: position.z + heading.z * movement.distance
    },
    speed: movement.speed,
    desired_speed: desiredSpeed,
    saved_at: targetAt
  };
}

export function integrateManualSpeed({
  speed,
  desiredSpeed,
  accelerationRate,
  decelerationRate,
  elapsedSeconds
}) {
  const startSpeed = finiteNumber(speed);
  const targetSpeed = finiteNumber(desiredSpeed, startSpeed);
  const duration = Math.max(0, finiteNumber(elapsedSeconds));
  if (duration === 0 || startSpeed === targetSpeed) {
    return { distance: startSpeed * duration, speed: startSpeed };
  }

  const rate = targetSpeed >= startSpeed
    ? positiveNumber(accelerationRate)
    : positiveNumber(decelerationRate);
  if (rate === 0) return { distance: startSpeed * duration, speed: startSpeed };

  const transitionDuration = Math.min(duration, Math.abs(targetSpeed - startSpeed) / rate);
  const direction = targetSpeed > startSpeed ? 1 : -1;
  const reachedSpeed = startSpeed + direction * rate * transitionDuration;
  const distance = (startSpeed + reachedSpeed) * 0.5 * transitionDuration
    + targetSpeed * (duration - transitionDuration);
  return {
    distance,
    speed: transitionDuration < duration ? targetSpeed : reachedSpeed
  };
}

function normalizeVector(value) {
  return {
    x: finiteNumber(value?.x),
    y: finiteNumber(value?.y),
    z: finiteNumber(value?.z)
  };
}

function finiteTimestamp(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function positiveNumber(value) {
  return Math.max(0, finiteNumber(value));
}

function clamp(value, min, max) {
  const lower = Math.min(min, max);
  const upper = Math.max(min, max);
  return Math.min(upper, Math.max(lower, value));
}
