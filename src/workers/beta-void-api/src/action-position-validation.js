export function evaluateActionPositionObservation({
  authoritativePosition,
  observedPosition,
  checkpointAt,
  serverNow,
  maximumCombinedSpeed,
  networkGraceSeconds = 2,
  fixedBuffer = 1
}) {
  const elapsedSeconds = Math.max(
    0,
    (finiteNumber(serverNow) - finiteNumber(checkpointAt, serverNow)) / 1000
  );
  const allowance = Math.max(0, finiteNumber(maximumCombinedSpeed))
    * (elapsedSeconds + Math.max(0, finiteNumber(networkGraceSeconds)))
    + Math.max(0, finiteNumber(fixedBuffer));
  const distance = Math.hypot(
    finiteNumber(observedPosition?.x) - finiteNumber(authoritativePosition?.x),
    finiteNumber(observedPosition?.y) - finiteNumber(authoritativePosition?.y),
    finiteNumber(observedPosition?.z) - finiteNumber(authoritativePosition?.z)
  );
  return {
    valid: distance <= allowance,
    distance,
    allowance,
    elapsedSeconds
  };
}

function finiteNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : Number(fallback) || 0;
}
