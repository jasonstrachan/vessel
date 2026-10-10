import type { AppState } from '@/stores/useAppStore';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { BrushShape } from '@/types';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { resolveEraserBrushSettings } from '@/stores/helpers/eraserSettings';

export type ColorCycleEraserSettings = {
  size: number;
  pressureEnabled: boolean;
  minPressure: number;
  maxPressure: number;
  brushShape: BrushShape;
  rotationEnabled?: boolean;
  risographIntensity?: number;
  gridSnapEnabled?: boolean;
  gridSnapSize?: number;
  customStamp?: CustomBrushStrokeData;
};

export const getColorCycleBrushEraserSettings = ({
  state,
}: {
  state: AppState;
  resamplerBrushData?: CustomBrushStrokeData;
}): ColorCycleEraserSettings => {
  const settings = resolveEraserBrushSettings(
    {
      ...state.tools.brushSettings,
      size: state.tools.brushSettings.size ?? state.globalBrushSize ?? 1,
    },
    state.tools.eraserSettings,
  );

  const pressureRange = resolveBrushPressureRange(settings);
  return {
    size: settings.size,
    pressureEnabled: !!pressureRange.enabled,
    minPressure: pressureRange.minPercent,
    maxPressure: pressureRange.maxPercent,
    brushShape: settings.brushShape ?? BrushShape.SQUARE,
    rotationEnabled: !!(settings.rotationEnabled || settings.rotationConfig?.enabled),
    risographIntensity: settings.risographIntensity,
    gridSnapEnabled: settings.gridSnapEnabled,
    gridSnapSize: settings.gridSnapSize,
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
