import { contourFill } from './fillStrategies/contour';
import { hatchFill } from './fillStrategies/hatch';
import { dashesFill } from './fillStrategies/dashes';
import { flowFill } from './fillStrategies/flow';
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
    adjustOrder: ['spacing', 'rotation', 'thickness'],
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
    adjustOrder: ['spacing', 'variance', 'thickness'],
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
    adjustOrder: ['spacing', 'variance', 'thickness'],
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
    adjustOrder: ['spacing'],
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
  flow: {
    id: 'flow',
    label: 'Flow',
    defaults: {
      spacing: getParameterDefault('spacing'),
      rotation: 0,
      thickness: 1,
      variance: 0,
      seed: 0,
      flowSeedSpacing: getParameterDefault('flowSeedSpacing'),
      flowStepSize: getParameterDefault('flowStepSize'),
      flowMaxSteps: getParameterDefault('flowMaxSteps'),
      flowFieldStep: 8,
      flowUseOrthogonal: false,
    },
    apply: flowFill,
    adjustOrder: [],
    ui: [
      {
        key: 'flowSeedSpacing',
        type: 'number',
        label: 'Seed spacing (px)',
        min: 4,
        max: 200,
        step: 1,
        default: getParameterDefault('flowSeedSpacing'),
      },
      {
        key: 'flowStepSize',
        type: 'number',
        label: 'Step size (px/iter)',
        min: 0.25,
        max: 20,
        step: 0.25,
        default: getParameterDefault('flowStepSize'),
      },
      {
        key: 'flowMaxSteps',
        type: 'number',
        label: 'Max length',
        min: 10,
        max: 600,
        step: 5,
        default: getParameterDefault('flowMaxSteps'),
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
