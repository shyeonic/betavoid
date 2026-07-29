const DEFAULT_SPEED_EPSILON = 0.0001;

export class ManualMovementSettlementTracker {
  constructor() {
    this.wasMoving = false;
  }

  observe({ eligible, moving }) {
    if (!eligible) {
      this.reset();
      return false;
    }
    if (moving) {
      this.wasMoving = true;
      return false;
    }
    if (!this.wasMoving) return false;

    this.wasMoving = false;
    return true;
  }

  reset() {
    this.wasMoving = false;
  }
}

export function isManualMovementActive({
  autopilotPhase,
  speed,
  desiredSpeed,
  controlActive,
  speedEpsilon = DEFAULT_SPEED_EPSILON
}) {
  if (autopilotPhase !== null) return false;
  return Math.abs(Number(speed) || 0) > speedEpsilon
    || Math.abs(Number(desiredSpeed) || 0) > speedEpsilon
    || Boolean(controlActive);
}
