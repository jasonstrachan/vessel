// Tuned to be intentionally obvious at normal/high drawing speed.
export const VELOCITY_SPACING_MAX_SCALE = 4.2;
export const VELOCITY_SPACING_DEADZONE_PX_PER_MS = 0.06;
export const VELOCITY_SPACING_RANGE_PX_PER_MS = 0.85;
export const VELOCITY_SPACING_CURVE = 1.15;

type ResolveVelocitySpacingScaleArgs = {
  enabled?: boolean;
  speedPxPerMs?: number;
};

const resolveVelocitySpacingStrength = ({
  enabled,
  speedPxPerMs,
}: ResolveVelocitySpacingScaleArgs): number => {
  if (!enabled) {
    return 0;
  }

  const speed = Number(speedPxPerMs);
  const safeSpeed = Number.isFinite(speed) ? Math.max(0, Math.min(4, speed)) : 0;
  const normalizedLinear = Math.max(
    0,
    Math.min(1, (safeSpeed - VELOCITY_SPACING_DEADZONE_PX_PER_MS) / VELOCITY_SPACING_RANGE_PX_PER_MS)
  );
  return Math.pow(normalizedLinear, VELOCITY_SPACING_CURVE);
};

/**
 * Returns a deterministic spacing multiplier from pointer speed.
 * Keeps low-speed behavior close to baseline and increases spacing at higher speeds.
 */
export const resolveVelocitySpacingScale = ({
  enabled,
  speedPxPerMs,
}: ResolveVelocitySpacingScaleArgs): number => {
  const strength = resolveVelocitySpacingStrength({ enabled, speedPxPerMs });
  return 1 + strength * (VELOCITY_SPACING_MAX_SCALE - 1);
};

type ResolveVelocitySpacingValueArgs = {
  baseSpacing: number;
  baseSize: number;
  enabled?: boolean;
  speedPxPerMs?: number;
};

/**
 * Shared spacing resolver used by both stamp placement and dash gating.
 * Keeping one formula prevents drift between "where stamps land" and dash phase math.
 */
export const resolveVelocityAdjustedSpacing = ({
  baseSpacing,
  baseSize,
  enabled,
  speedPxPerMs,
}: ResolveVelocitySpacingValueArgs): number => {
  const safeBaseSpacing = Number.isFinite(baseSpacing) ? Math.max(0, baseSpacing) : 0;
  const safeBaseSize = Number.isFinite(baseSize) ? Math.max(1, baseSize) : 1;
  const velocityScale = resolveVelocitySpacingScale({ enabled, speedPxPerMs });
  const velocityStrength = resolveVelocitySpacingStrength({ enabled, speedPxPerMs });
  const additiveBoost = safeBaseSize * 0.07 * velocityStrength;
  return safeBaseSpacing * velocityScale + additiveBoost;
};

export { resolveVelocitySpacingStrength };
