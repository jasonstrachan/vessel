import type { UseDrawingCanvasRuntimeEffectsBridgeOptions } from './useDrawingCanvasRuntimeEffectsBridge';

type InputHandlersOptions =
  UseDrawingCanvasRuntimeEffectsBridgeOptions['inputBridgeOptionsArgs']['inputHandlersOptions'];

export interface BuildDrawingCanvasRuntimeEffectsInputHandlersOptionsArgs {
  refs: Pick<
    InputHandlersOptions,
    | 'canvasRef'
    | 'wrapperRef'
    | 'overlayCanvasRef'
    | 'compositeCanvasRef'
    | 'isBusyRef'
    | 'isMouseDownRef'
    | 'isSpacePressedRef'
    | 'suppressBootstrapUntilPointerUpRef'
    | 'mousePositionRef'
    | 'isZoomingRef'
    | 'zoomEndTimeoutRef'
    | 'drawAnimationFrameRef'
    | 'pointerMoveThrottled'
    | 'compositeCanvasDirtyRef'
    | 'viewTransformRef'
    | 'drawingAnimationFrameRef'
    | 'previewAnimationFrameRef'
  >;
  state: Pick<
    InputHandlersOptions,
    | 'project'
    | 'canvasZoom'
    | 'selectionMask'
    | 'selectionMaskBounds'
    | 'tools'
    | 'layers'
    | 'activeLayerId'
    | 'selectionStart'
    | 'selectionEnd'
    | 'floatingPaste'
    | 'palette'
    | 'polygonGradientState'
    | 'recolorSampling'
    | 'currentBrushPresetId'
    | 'isDraggingFloatingPaste'
    | 'floatingPasteDragStart'
    | 'floatingPasteOriginalPos'
    | 'interaction'
    | 'stateMachine'
    | 'pan'
    | 'toolStateMachine'
    | 'drawingHandlers'
    | 'brushEngine'
    | 'sampleColorAtPosition'
    | 'sampleColorsAlongLine'
    | 'canvasShapeEditorActive'
    | 'defaultCursorStyle'
    | 'brushShape'
    | 'isColorCyclePlaybackActive'
  >;
  actions: Pick<
    InputHandlersOptions,
    | 'setSelectionBounds'
    | 'clearSelection'
    | 'extractSelectionToFloatingPaste'
    | 'setCurrentTool'
    | 'setCurrentOffscreenCanvas'
    | 'compositeLayersToCanvas'
    | 'updateLayer'
    | 'setActiveColor'
    | 'setBrushSettings'
    | 'updateRecolorSampling'
    | 'stopRecolorSampling'
    | 'setRectangleBrushState'
    | 'setCustomBrushFreehandPath'
    | 'setFloatingPaste'
    | 'updateFloatingPastePosition'
    | 'commitFloatingPaste'
    | 'cancelFloatingPaste'
    | 'setIsDraggingFloatingPaste'
    | 'setCursorStyle'
    | 'setShowBrushCursor'
    | 'setCursorPosition'
    | 'setNeedsRedraw'
    | 'setLayersNeedRecomposition'
    | 'setZoom'
    | 'setPan'
    | 'draw'
  >;
  animation: Pick<
    InputHandlersOptions,
    | 'wrappedStartAnimation'
    | 'pauseAnimationForPan'
    | 'resumeAnimationAfterPan'
    | 'feedback'
  >;
  clipboard: Pick<InputHandlersOptions, 'selectionClipboardRef'>;
}

export const buildDrawingCanvasRuntimeEffectsInputHandlersOptions = ({
  refs,
  state,
  actions,
  animation,
  clipboard,
}: BuildDrawingCanvasRuntimeEffectsInputHandlersOptionsArgs): InputHandlersOptions => ({
  ...refs,
  ...state,
  ...actions,
  ...animation,
  ...clipboard,
});
