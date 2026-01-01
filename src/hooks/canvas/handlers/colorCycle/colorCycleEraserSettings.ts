import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { BrushShape } from '@/types';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { getColorCycleBrushFlags } from '@/hooks/canvas/utils/colorCycleBrushFlags';
import { resolveActiveCustomBrushData } from '@/hooks/canvas/utils/customBrushData';

export type ColorCycleEraserSettings = {
  size: number;
  pressureEnabled: boolean;
  minPressure: number;
  maxPressure: number;
  brushShape: BrushShape;
  customStamp?: CustomBrushStrokeData;
};

export const getColorCycleBrushEraserSettings = ({
  state,
  resamplerBrushData,
}: {
  state: AppState;
  resamplerBrushData?: CustomBrushStrokeData;
}): ColorCycleEraserSettings => {
  const settings = state.tools.brushSettings;
  const flags = getColorCycleBrushFlags(settings);
  let customStamp = resolveActiveCustomBrushData(state);
  if (!customStamp && resamplerBrushData) {
    customStamp = resamplerBrushData;
  }
  const brushShape =
    settings.brushShape ??
    state.tools.lastRegularBrushShape ??
    BrushShape.ROUND;

  const pressureRange = resolveBrushPressureRange(settings);
  const baseSettings = {
    size: settings.size ?? state.globalBrushSize ?? 1,
    pressureEnabled: flags.isAny ? true : !!pressureRange.enabled,
    minPressure: pressureRange.minPercent,
    maxPressure: pressureRange.maxPercent,
    brushShape
  };

  if (customStamp) {
    return { ...baseSettings, customStamp };
  }

  return baseSettings;
};
