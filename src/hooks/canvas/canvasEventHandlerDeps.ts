import type { EventHandlerDependencies, EventHandlerDynamicDeps } from './utils/types';

export type EventHandlerDependenciesInput = Omit<
  EventHandlerDependencies,
  | 'contourLinesStateRef'
  | 'contourLinesDefaultsCacheRef'
  | 'contourLinesFinalizingRef'
  | 'previewSessionIdRef'
  | 'newPreviewSession'
  | 'isCurrentPreviewSession'
  | 'dynamicDepsRef'
  | 'project'
  | 'canvas'
  | 'tools'
  | 'layers'
  | 'activeLayerId'
  | 'selectionStart'
  | 'selectionEnd'
  | 'selectionMask'
  | 'selectionMaskBounds'
  | 'floatingPaste'
> & {
  project: EventHandlerDynamicDeps['project'];
  canvas: EventHandlerDynamicDeps['canvas'];
  tools: EventHandlerDynamicDeps['tools'];
  layers: EventHandlerDynamicDeps['layers'];
  activeLayerId: EventHandlerDynamicDeps['activeLayerId'];
  selectionStart: EventHandlerDynamicDeps['selectionStart'];
  selectionEnd: EventHandlerDynamicDeps['selectionEnd'];
  selectionMask: EventHandlerDynamicDeps['selectionMask'];
  selectionMaskBounds: EventHandlerDynamicDeps['selectionMaskBounds'];
  floatingPaste: EventHandlerDynamicDeps['floatingPaste'];
  isDraggingFloatingPaste: EventHandlerDynamicDeps['isDraggingFloatingPaste'];
  palette: EventHandlerDynamicDeps['palette'];
  polygonGradientState: EventHandlerDynamicDeps['polygonGradientState'];
  recolorSampling: EventHandlerDynamicDeps['recolorSampling'];
  currentBrushPresetId: EventHandlerDynamicDeps['currentBrushPresetId'];
};

export const splitCanvasEventHandlerDeps = (deps: EventHandlerDependenciesInput) => {
  const {
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    selectionMask,
    selectionMaskBounds,
    floatingPaste,
    isDraggingFloatingPaste,
    palette,
    polygonGradientState,
    recolorSampling,
    currentBrushPresetId,
    ...staticDeps
  } = deps;

  const dynamicDeps: EventHandlerDynamicDeps = {
    project,
    canvas,
    tools,
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    selectionMask,
    selectionMaskBounds,
    floatingPaste,
    isDraggingFloatingPaste,
    palette,
    polygonGradientState,
    recolorSampling,
    currentBrushPresetId,
  };

  return {
    staticDeps,
    dynamicDeps,
  };
};
