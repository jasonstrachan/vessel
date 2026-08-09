import { isCcGradientPreset } from '@/presets/brushPresets';
import { BrushShape } from '@/types';

import type { EventHandlerDynamicDeps } from '../../utils/types';

export const getVisibleCcGradientColorCount = (
  brushSettings: EventHandlerDynamicDeps['tools']['brushSettings'],
): number => {
  if (Number.isFinite(brushSettings.gradientBands)) {
    return Math.max(1, Math.round(brushSettings.gradientBands ?? 1));
  }
  if (Number.isFinite(brushSettings.colors)) {
    return Math.max(1, Math.round(brushSettings.colors ?? 1));
  }
  return 1;
};

export const shouldEnterCcGradientDirectionStage = (
  tools: EventHandlerDynamicDeps['tools'],
  brushPresetId: string | null,
): boolean => (
  tools.currentTool === 'brush' &&
  tools.shapeMode &&
  isCcGradientPreset(brushPresetId) &&
  tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
  tools.brushSettings.colorCycleFillMode === 'linear' &&
  getVisibleCcGradientColorCount(tools.brushSettings) > 1
);
