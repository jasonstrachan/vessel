import type { AppState } from '@/stores/useAppStore';

export const syncStrokeStartPalette = ({
  currentState,
  currentTool,
  isColorCycleBrush,
}: {
  currentState: AppState;
  currentTool: AppState['tools']['currentTool'];
  isColorCycleBrush: boolean;
}): void => {
  if (currentState.palette.activeSlot !== 'foreground') {
    return;
  }

  const paletteColor = currentState.palette.foregroundColor;
  const isAutoSampleBrush =
    currentTool === 'brush' &&
    currentState.tools.brushSettings.autoSampleColor &&
    !isColorCycleBrush &&
    currentState.tools.brushSettings.brushShape !== 'resampler';

  if (isAutoSampleBrush) {
    const sampledColor = currentState.tools.brushSettings.color;
    if (sampledColor && sampledColor !== paletteColor) {
      currentState.setPaletteColor('foreground', sampledColor);
    }
    return;
  }

  if (currentTool === 'brush') {
    if (currentState.tools.brushSettings.color !== paletteColor) {
      currentState.setBrushSettings({ color: paletteColor });
    }
    return;
  }

  if (currentTool === 'eraser') {
    if (currentState.tools.eraserSettings.color !== paletteColor) {
      currentState.setEraserSettings({ color: paletteColor });
    }
  }
};
