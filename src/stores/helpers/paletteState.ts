import type { StoreApi } from 'zustand';
import type { PaletteState } from '@/types';

type AppState = import('../useAppStore').AppState;

type StoreSet = StoreApi<AppState>['setState'];
type StoreGet = StoreApi<AppState>['getState'];

export const updateToolsWithPalette = (
  palette: PaletteState,
  tools: AppState['tools'],
  options: { syncColorCycleGradient?: boolean } = {},
): AppState['tools'] => {
  const activeColorCycleGradient = options.syncColorCycleGradient
    ? palette.colorCycleGradients?.find(
        (gradient) => gradient.id === palette.activeColorCycleGradientId,
      )
    : undefined;
  return {
    ...tools,
    ...(activeColorCycleGradient ? { ccGradientSource: 'manual' as const } : {}),
    brushSettings: {
      ...tools.brushSettings,
      color: palette.foregroundColor,
      ...(activeColorCycleGradient
        ? {
            colorCycleGradient: activeColorCycleGradient.stops.map((stop) => ({ ...stop })),
            colorCycleGradientVersion:
              (tools.brushSettings.colorCycleGradientVersion ?? 0) + 1,
            colorCycleGradientSeamProfile: activeColorCycleGradient.seamProfile,
            colorCycleGradientIsRuntimePalette: activeColorCycleGradient.isRuntimePalette === true,
            ccGradientSource: 'manual' as const,
            colorCycleUseForegroundGradient: false,
            autoSampleGradient: false,
            autoSampleGradientRealtime: false,
          }
        : {}),
    },
    eraserSettings:
      tools.currentTool === 'eraser'
        ? { ...tools.eraserSettings, color: palette.foregroundColor }
        : tools.eraserSettings,
  };
};

export interface ApplyPaletteOptions {
  paletteDirty?: boolean;
  syncColorCycleGradient?: boolean;
}

export const applyPaletteSnapshot = (
  set: StoreSet,
  _get: StoreGet,
  palette: PaletteState,
  options: ApplyPaletteOptions = {}
): void => {
  set((state) => {
    const targetDirty =
      options.paletteDirty !== undefined ? options.paletteDirty : state.paletteDirty;
    const nextTools = updateToolsWithPalette(palette, state.tools, {
      syncColorCycleGradient: options.syncColorCycleGradient,
    });

    const result: Partial<AppState> = {
      palette,
      paletteDirty: targetDirty,
      tools: nextTools,
    };

    if (state.project) {
      result.project = {
        ...state.project,
        palette,
      };
    }

    return result;
  });
};
