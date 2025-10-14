import { ShapeFillParamKey } from './types';
import { clamp, wrap } from './utils/math';

type ParamMode = 'clamp' | 'wrap';

export interface ShapeFillParameterDefinition {
  key: ShapeFillParamKey;
  min: number;
  max: number;
  default: number;
  scale: number;
  mode?: ParamMode;
}

const PARAM_DEFINITIONS: Record<ShapeFillParamKey, ShapeFillParameterDefinition> = {
  spacing: {
    key: 'spacing',
    min: 1,
    max: 200,
    default: 10,
    scale: 0.2,
  },
  rotation: {
    key: 'rotation',
    min: 0,
    max: 180,
    default: 45,
    scale: 0.2,
    mode: 'wrap',
  },
  thickness: {
    key: 'thickness',
    min: 0.2,
    max: 10,
    default: 1,
    scale: 0.05,
  },
  segments: {
    key: 'segments',
    min: 1,
    max: 24,
    default: 5,
    scale: 0.4,
  },
  variance: {
    key: 'variance',
    min: 0,
    max: 1,
    default: 0.3,
    scale: 0.01,
  },
  dashLength: {
    key: 'dashLength',
    min: 2,
    max: 200,
    default: 18,
    scale: 1,
  },
  dashLengthJitter: {
    key: 'dashLengthJitter',
    min: 0,
    max: 1,
    default: 0,
    scale: 0.01,
  },
  dashWeightJitter: {
    key: 'dashWeightJitter',
    min: 0,
    max: 1,
    default: 0.25,
    scale: 0.01,
  },
  scatter: {
    key: 'scatter',
    min: 0,
    max: 120,
    default: 0,
    scale: 0.5,
  },
  nearFalloff: {
    key: 'nearFalloff',
    min: 0.15,
    max: 4,
    default: 1,
    scale: 0.01,
  },
  farFalloff: {
    key: 'farFalloff',
    min: 0.15,
    max: 5,
    default: 1,
    scale: 0.01,
  },
  angleDrift: {
    key: 'angleDrift',
    min: 0,
    max: 90,
    default: 16,
    scale: 0.2,
  },
  angleScale: {
    key: 'angleScale',
    min: 10,
    max: 900,
    default: 420,
    scale: 2,
  },
  sierraDensity: {
    key: 'sierraDensity',
    min: 0,
    max: 1,
    default: 0.45,
    scale: 0.01,
  },
  sierraResolution: {
    key: 'sierraResolution',
    min: 1,
    max: 16,
    default: 4,
    scale: 1,
  },
  seed: {
    key: 'seed',
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    default: 0,
    scale: 1,
    mode: 'wrap',
  },
  flowSeedSpacing: {
    key: 'flowSeedSpacing',
    min: 4,
    max: 200,
    default: 26,
    scale: 0.4,
  },
  flowStepSize: {
    key: 'flowStepSize',
    min: 0.25,
    max: 20,
    default: 2,
    scale: 0.05,
  },
  flowMaxSteps: {
    key: 'flowMaxSteps',
    min: 10,
    max: 600,
    default: 160,
    scale: 2,
  },
  noiseScale: {
    key: 'noiseScale',
    min: 4,
    max: 240,
    default: 48,
    scale: 0.5,
  },
  noiseContrast: {
    key: 'noiseContrast',
    min: 0,
    max: 1,
    default: 0.65,
    scale: 0.01,
  },
  noiseThreshold: {
    key: 'noiseThreshold',
    min: 0,
    max: 1,
    default: 0.5,
    scale: 0.01,
  },
  noiseOctaves: {
    key: 'noiseOctaves',
    min: 1,
    max: 6,
    default: 3,
    scale: 1,
  },
  noiseRandomness: {
    key: 'noiseRandomness',
    min: 0,
    max: 1,
    default: 0.25,
    scale: 0.01,
  },
  delaunayVariation: {
    key: 'delaunayVariation',
    min: 0,
    max: 1.5,
    default: 1,
    scale: 0.01,
  },
};

export function getParameterDefinition(key: ShapeFillParamKey): ShapeFillParameterDefinition {
  const definition = PARAM_DEFINITIONS[key];
  if (!definition) {
    throw new Error(`Missing parameter definition for "${key}"`);
  }
  return definition;
}

export function clampParameterValue(value: number, key: ShapeFillParamKey): number {
  const def = getParameterDefinition(key);
  if (def.mode === 'wrap') {
    return wrap(value, def.min, def.max);
  }
  return clamp(value, def.min, def.max);
}

export function getParameterDefault(key: ShapeFillParamKey): number {
  return getParameterDefinition(key).default;
}
