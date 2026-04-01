export type CcFlowVelocityState = {
  smoothedPxPerMs: number;
};

const CC_FLOW_INPUT_MAX_PX_PER_MS = 4;
const CC_FLOW_RISE_ALPHA = 0.32;
const CC_FLOW_FALL_ALPHA = 0.14;
const CC_FLOW_JITTER_DEADBAND_PX_PER_MS = 0.035;
const CC_FLOW_SIGNAL_DEADZONE_PX_PER_MS = 0.12;
const CC_FLOW_SIGNAL_RANGE_PX_PER_MS = 1.1;
const CC_FLOW_SIGNAL_CURVE = 1.65;
export const CC_FLOW_SIGNAL_MAX_PX_PER_MS = 1.4;

const CC_FLOW_SPEED_DEADZONE_PX_PER_MS = 0.03;
const CC_FLOW_SPEED_CURVE = 1.1;
export const CC_FLOW_SPEED_MAX_MULTIPLIER = 4.5;

const clampCcFlowVelocity = (value?: number): number => {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return 0;
  }
  return Math.max(0, Math.min(CC_FLOW_INPUT_MAX_PX_PER_MS, numericValue));
};

export const resolveCcFlowVelocitySignal = (
  flowState: CcFlowVelocityState,
  rawVelocityPxPerMs?: number
): number => {
  const clampedRawVelocity = clampCcFlowVelocity(rawVelocityPxPerMs);
  const previousSmoothedVelocity = clampCcFlowVelocity(flowState.smoothedPxPerMs);
  const delta = clampedRawVelocity - previousSmoothedVelocity;

  if (Math.abs(delta) <= CC_FLOW_JITTER_DEADBAND_PX_PER_MS) {
    flowState.smoothedPxPerMs = previousSmoothedVelocity;
  } else {
    const alpha = delta > 0 ? CC_FLOW_RISE_ALPHA : CC_FLOW_FALL_ALPHA;
    flowState.smoothedPxPerMs = previousSmoothedVelocity + delta * alpha;
  }

  const smoothedVelocity = clampCcFlowVelocity(flowState.smoothedPxPerMs);
  if (smoothedVelocity <= CC_FLOW_SIGNAL_DEADZONE_PX_PER_MS) {
    return 0;
  }

  const normalizedVelocity = Math.max(
    0,
    Math.min(1, (smoothedVelocity - CC_FLOW_SIGNAL_DEADZONE_PX_PER_MS) / CC_FLOW_SIGNAL_RANGE_PX_PER_MS)
  );
  const curvedVelocity = Math.pow(normalizedVelocity, CC_FLOW_SIGNAL_CURVE);
  return curvedVelocity * CC_FLOW_SIGNAL_MAX_PX_PER_MS;
};

export const resolveCcFlowSpeedMultiplier = (speedSamplePxPerMs?: number): number => {
  const safeSpeed = Number(speedSamplePxPerMs);
  if (!Number.isFinite(safeSpeed) || safeSpeed <= CC_FLOW_SPEED_DEADZONE_PX_PER_MS) {
    return 1;
  }

  const normalized = Math.max(
    0,
    Math.min(
      1,
      (safeSpeed - CC_FLOW_SPEED_DEADZONE_PX_PER_MS)
        / Math.max(1e-6, CC_FLOW_SIGNAL_MAX_PX_PER_MS - CC_FLOW_SPEED_DEADZONE_PX_PER_MS)
    )
  );
  const strength = Math.pow(normalized, CC_FLOW_SPEED_CURVE);
  return 1 + strength * (CC_FLOW_SPEED_MAX_MULTIPLIER - 1);
};
