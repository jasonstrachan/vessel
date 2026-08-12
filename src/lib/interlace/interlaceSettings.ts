import type { InterlaceGroupSettings, LayerGroup } from '@/types';

export const DEFAULT_INTERLACE_SETTINGS: InterlaceGroupSettings = {
  cellSize: 10,
  dominance: 0.92,
  patternPreset: 'classic',
  motionMode: 'fixed',
  direction: 'right',
  travelCycles: 1,
  loopDurationSeconds: 10,
  seed: 0x51e22a,
};

const finiteInRange = (
  value: unknown,
  fallback: number,
  min: number,
  max: number,
): number => {
  const numeric = typeof value === 'number' ? value : Number.NaN;
  return Number.isFinite(numeric) ? Math.max(min, Math.min(max, numeric)) : fallback;
};

export const sanitizeInterlaceSettings = (
  settings?: Partial<InterlaceGroupSettings> | null,
): InterlaceGroupSettings => {
  const unsafePatternPreset = settings?.patternPreset as string | undefined;
  const patternPreset = unsafePatternPreset === 'wave-field'
    || unsafePatternPreset === 'interference'
    || unsafePatternPreset === 'cascade'
    ? 'sierra-travel'
    : unsafePatternPreset === 'ripple'
      || unsafePatternPreset === 'counterflow'
      || unsafePatternPreset === 'hypnotic'
      || unsafePatternPreset === 'sierra-travel'
      ? unsafePatternPreset
      : 'classic';

  return {
    cellSize: Math.round(finiteInRange(settings?.cellSize, DEFAULT_INTERLACE_SETTINGS.cellSize, 2, 128)),
    dominance: finiteInRange(settings?.dominance, DEFAULT_INTERLACE_SETTINGS.dominance, 0.5, 1),
    patternPreset,
    motionMode: settings?.motionMode === 'travel' ? 'travel' : 'fixed',
    direction: settings?.direction === 'left' ? 'left' : 'right',
    travelCycles: Math.max(
      1,
      Math.round(finiteInRange(settings?.travelCycles, DEFAULT_INTERLACE_SETTINGS.travelCycles, 1, 16)),
    ),
    loopDurationSeconds: finiteInRange(
      settings?.loopDurationSeconds,
      DEFAULT_INTERLACE_SETTINGS.loopDurationSeconds,
      0.25,
      3600,
    ),
    seed: Number.isFinite(settings?.seed) ? (settings?.seed as number) >>> 0 : DEFAULT_INTERLACE_SETTINGS.seed,
  };
};

export const isInterlaceGroup = (
  group: LayerGroup | null | undefined,
): group is LayerGroup & { kind: 'interlace'; interlace: InterlaceGroupSettings } => (
  group?.kind === 'interlace' && Boolean(group.interlace)
);
