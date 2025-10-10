import { FillParams, ShapeFillParamKey } from './types';
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
  variance: {
    key: 'variance',
    min: 0,
    max: 1,
    default: 0.3,
    scale: 0.01,
  },
  seed: {
    key: 'seed',
    min: 0,
    max: Number.MAX_SAFE_INTEGER,
    default: 0,
    scale: 1,
    mode: 'wrap',
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
