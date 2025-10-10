import { contourFill } from './fillStrategies/contour';
import { hatchFill } from './fillStrategies/hatch';
import { dashesFill } from './fillStrategies/dashes';
import { stippleFill } from './fillStrategies/stipple';
import { getParameterDefault } from './parameters';
import { FillStrategy, ShapeFillId } from './types';

const strategyMap: Record<ShapeFillId, FillStrategy> = {
  hatch: {
    id: 'hatch',
    label: 'Hatch',
    defaults: {
      spacing: getParameterDefault('spacing'),
      rotation: getParameterDefault('rotation'),
      thickness: getParameterDefault('thickness'),
      variance: 0,
      organic: 0.7,
      cross: false,
      seed: 0,
    },
    apply: hatchFill,
    ui: [
      {
        key: 'spacing',
        type: 'number',
        label: 'Spacing',
        min: 1,
        max: 200,
        step: 1,
        default: getParameterDefault('spacing'),
      },
      {
        key: 'rotation',
        type: 'number',
        label: 'Rotation',
        min: 0,
        max: 180,
        step: 1,
        default: getParameterDefault('rotation'),
      },
      {
        key: 'thickness',
        type: 'number',
        label: 'Line Width',
        min: 0.2,
        max: 10,
        step: 0.1,
        default: getParameterDefault('thickness'),
      },
      {
        key: 'organic',
        type: 'number',
        label: 'Organic',
        min: 0,
        max: 1,
        step: 0.05,
        default: 0.7,
      },
      {
        key: 'cross',
        type: 'boolean',
        label: 'Crosshatch',
        default: false,
      },
    ],
  },
  contour: {
    id: 'contour',
    label: 'Contour',
    defaults: {
      spacing: 12,
      rotation: 0,
      thickness: 1,
      variance: 0.2,
      seed: 0,
    },
    apply: contourFill,
    ui: [
      {
        key: 'spacing',
        type: 'number',
        label: 'Spacing',
        min: 2,
        max: 400,
        step: 1,
        default: 12,
      },
      {
        key: 'variance',
        type: 'number',
        label: 'Variance',
        min: 0,
        max: 1,
        step: 0.05,
        default: 0.2,
      },
      {
        key: 'thickness',
        type: 'number',
        label: 'Line Width',
        min: 0.2,
        max: 6,
        step: 0.1,
        default: 1,
      },
    ],
  },
  stipple: {
    id: 'stipple',
    label: 'Stipple',
    defaults: {
      spacing: 12,
      rotation: 0,
      thickness: 1,
      variance: 0.5,
      seed: 0,
    },
    apply: stippleFill,
    ui: [
      {
        key: 'spacing',
        type: 'number',
        label: 'Spacing',
        min: 2,
        max: 200,
        step: 1,
        default: 12,
      },
      {
        key: 'variance',
        type: 'number',
        label: 'Variance',
        min: 0,
        max: 1,
        step: 0.05,
        default: 0.5,
      },
      {
        key: 'thickness',
        type: 'number',
        label: 'Dot Scale',
        min: 0.5,
        max: 5,
        step: 0.1,
        default: 1,
      },
    ],
  },
  dashes: {
    id: 'dashes',
    label: 'Dashes',
    defaults: {
      spacing: 18,
      rotation: 0,
      thickness: 2.2,
      variance: 0.35,
      seed: 0,
    },
    apply: dashesFill,
    ui: [
      {
        key: 'spacing',
        type: 'number',
        label: 'Spacing',
        min: 2,
        max: 200,
        step: 1,
        default: 18,
      },
      {
        key: 'thickness',
        type: 'number',
        label: 'Dash Weight',
        min: 0.2,
        max: 8,
        step: 0.1,
        default: 2.2,
      },
      {
        key: 'variance',
        type: 'number',
        label: 'Jitter',
        min: 0,
        max: 1,
        step: 0.05,
        default: 0.35,
      },
    ],
  },
};

export function getFillStrategy(id: ShapeFillId): FillStrategy {
  const strategy = strategyMap[id];
  if (!strategy) {
    throw new Error(`Unknown shape fill strategy: ${id}`);
  }
  return strategy;
}

export function listFillStrategies(): FillStrategy[] {
  return Object.values(strategyMap);
}
