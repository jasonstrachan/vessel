/**
 * Snap a point to the nearest angle increment from an origin.
 *
 * - Keeps radial distance constant (projects point onto the snapped ray)
 * - Default step is 45°, yielding 8-way snapping (0/45/90/...)
 */
export function snapPointToAngle(
  origin: { x: number; y: number },
  point: { x: number; y: number },
  stepDegrees: number = 45
): { x: number; y: number } {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return point;

  const stepRad = (stepDegrees * Math.PI) / 180;
  const angle = Math.atan2(dy, dx);
  const snappedIndex = Math.round(angle / stepRad);
  const snapped = snappedIndex * stepRad;
  return {
    x: origin.x + Math.cos(snapped) * length,
    y: origin.y + Math.sin(snapped) * length,
  };
}

/**
 * Snap an angle (radians) to the nearest increment and return radians.
 */
export function snapAngle(angleRad: number, stepDegrees: number = 45): number {
  const stepRad = (stepDegrees * Math.PI) / 180;
  return Math.round(angleRad / stepRad) * stepRad;
}
