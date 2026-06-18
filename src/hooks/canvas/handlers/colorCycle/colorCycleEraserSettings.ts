import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { BrushShape } from '@/types';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { sanitizeEraserTipSettings } from '@/stores/helpers/eraserSettings';

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
}: {
  state: AppState;
  resamplerBrushData?: CustomBrushStrokeData;
}): ColorCycleEraserSettings => {
  const settings = state.tools.eraserSettings;
  const sanitized = sanitizeEraserTipSettings(settings);
  const brushSize = state.tools.brushSettings.size ?? state.globalBrushSize ?? 1;
  const size =
    settings.linkSizeToBrush === false
      ? settings.size ?? brushSize
      : brushSize;

  const pressureRange = resolveBrushPressureRange(settings);
  return {
    size,
    pressureEnabled: !!pressureRange.enabled,
    minPressure: pressureRange.minPercent,
    maxPressure: pressureRange.maxPercent,
    brushShape: sanitized.brushShape ?? BrushShape.SQUARE,
  };
};

export const createColorCycleBrushEraserSettingsGetter = ({
  getState,
  getResamplerBrushData,
}: {
  getState: () => AppState;
  getResamplerBrushData: () => CustomBrushStrokeData | undefined;
}): (() => ColorCycleEraserSettings) => () =>
  getColorCycleBrushEraserSettings({
    state: getState(),
    resamplerBrushData: getResamplerBrushData(),
  });
