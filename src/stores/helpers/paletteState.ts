import type { StoreApi } from 'zustand';
import type { PaletteState } from '@/types';

type AppState = import('../useAppStore').AppState;

type StoreSet = StoreApi<AppState>['setState'];
type StoreGet = StoreApi<AppState>['getState'];

export const updateToolsWithPalette = (
  palette: PaletteState,
  tools: AppState['tools']
): AppState['tools'] => {
  return {
    ...tools,
    brushSettings: {
      ...tools.brushSettings,
      color: palette.foregroundColor,
    },
    eraserSettings:
      tools.currentTool === 'eraser'
        ? { ...tools.eraserSettings, color: palette.foregroundColor }
        : tools.eraserSettings,
  };
};

export interface ApplyPaletteOptions {
  paletteDirty?: boolean;
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
    const nextTools = updateToolsWithPalette(palette, state.tools);

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
