import type { BrushSettings } from '@/types';
import type { CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';

export type CustomBrushStoreState = {
  tools: {
    brushSettings: BrushSettings;
  };
  temporaryCustomBrush?: {
    id?: string;
    imageData: ImageData;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
  } | null;
  getCustomBrushById?: (id: string) => {
    id?: string;
    imageData: ImageData;
    width: number;
    height: number;
    naturalWidth?: number;
    naturalHeight?: number;
  } | null;
};

export const resolveActiveCustomBrushData = (
  state: CustomBrushStoreState
): CustomBrushStrokeData | undefined => {
  const settings = state.tools.brushSettings;

  if (settings.currentBrushTip) {
    const brushTip = settings.currentBrushTip;
    return {
      imageData: brushTip.imageData,
      width: brushTip.naturalWidth ?? brushTip.width ?? brushTip.imageData.width,
      height: brushTip.naturalHeight ?? brushTip.height ?? brushTip.imageData.height,
      isColorizable:
        brushTip.isColorizable || settings.useSwatchColor || !!settings.customBrushColorCycle,
      cacheKey: `tip:${brushTip.brushId ?? 'anon'}`
    };
  }

  if (settings.selectedCustomBrush) {
    if (state.temporaryCustomBrush?.id === settings.selectedCustomBrush) {
      const tempBrush = state.temporaryCustomBrush;
      return {
        imageData: tempBrush.imageData,
        width: tempBrush.naturalWidth ?? tempBrush.width,
        height: tempBrush.naturalHeight ?? tempBrush.height,
        isColorizable: settings.useSwatchColor || !!settings.customBrushColorCycle,
        cacheKey: `temp:${tempBrush.id ?? 'anon'}`
      };
    }

    const saved = state.getCustomBrushById?.(settings.selectedCustomBrush ?? '') ?? null;
    if (saved) {
      return {
        imageData: saved.imageData,
        width: saved.naturalWidth ?? saved.width,
        height: saved.naturalHeight ?? saved.height,
        isColorizable: settings.useSwatchColor || !!settings.customBrushColorCycle,
        cacheKey: `project:${saved.id ?? 'anon'}`
      };
    }
  }

  return undefined;
};
