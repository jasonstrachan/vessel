import { clampPressurePercent } from '@/utils/pressureSettings';

export interface PressureSizingConfig {
  enabled: boolean;
  minPercent: number;
  maxPercent: number;
}

export interface PressureSizingResult {
  enabled: boolean;
  minRadius: number;
  maxRadius: number;
  sample: (pressure: number) => number;
}

const DEADZONE = 0.1;

export const resolvePressureSizing = (
  baseDiameter: number,
  config: PressureSizingConfig
): PressureSizingResult => {
  const radius = Math.max(0.5, baseDiameter / 2);
  if (!config.enabled) {
    return {
      enabled: false,
      minRadius: radius,
      maxRadius: radius,
      sample: () => radius,
    };
  }

  const minPercent = clampPressurePercent(config.minPercent ?? 100);
  const maxInput = clampPressurePercent(config.maxPercent ?? 100);
  const maxPercent = Math.max(minPercent, maxInput);

  const minRadius = Math.max(0.5, (minPercent / 100) * radius);
  const maxRadius = Math.max(minRadius, (maxPercent / 100) * radius);

  const sample = (pressure: number): number => {
    if (!Number.isFinite(pressure)) {
      return maxRadius;
    }
    const clamped = Math.max(0, Math.min(1, pressure));
    if (clamped <= DEADZONE) {
      return minRadius;
    }
    if (clamped >= 1 - DEADZONE) {
      return maxRadius;
    }
    const t = (clamped - DEADZONE) / (1 - 2 * DEADZONE);
    return minRadius + t * (maxRadius - minRadius);
  };

  return {
    enabled: true,
    minRadius,
    maxRadius,
    sample,
  };
};
