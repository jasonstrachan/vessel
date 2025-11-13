import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, BrushEditorState, PolygonGradientState, ToolState } from '@/types';

export const selectBrushSettings = (state: AppState): BrushSettings => state.tools.brushSettings;
export const selectEraserSettings = (state: AppState): BrushSettings => state.tools.eraserSettings;
export const selectPressureSettings = (state: AppState) => state.pressureSettings;
export const selectGlobalBrushSize = (state: AppState) => state.globalBrushSize;
export const selectFillSettings = (state: AppState): ToolState['fillSettings'] =>
  state.tools.fillSettings;
export const selectCurrentTool = (state: AppState) => state.tools.currentTool;
export const selectPreviousTool = (state: AppState) => state.tools.previousTool;
export const selectShapeMode = (state: AppState) => state.tools.shapeMode;
export const selectToolsState = (state: AppState): ToolState => state.tools;
export const selectBrushEditor = (state: AppState): BrushEditorState => state.brushEditor;
export const selectPolygonGradientState = (state: AppState): PolygonGradientState =>
  state.polygonGradientState;
export const selectRecolorSampling = (state: AppState) => state.recolorSampling;
export const selectCustomBrushCaptureAllLayers = (state: AppState) =>
  state.tools.customBrushCapture.sampleAllLayers;
export const selectCustomBrushCaptureMode = (state: AppState) =>
  state.tools.customBrushCapture.mode;
export const selectCustomBrushFreehandPath = (state: AppState) =>
  state.tools.customBrushCapture.freehandPath ?? null;
export const selectBrushPresetMeta = (state: AppState) => ({
  current: state.currentBrushPreset,
  presets: state.brushPresets,
});
export const selectTemporaryCustomBrush = (state: AppState) => state.temporaryCustomBrush;
export const selectBrushEditorStatus = (state: AppState) => state.brushEditor.status;
