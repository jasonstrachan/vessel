import type { UseDrawingCanvasRuntimeEffectsBridgeOptions } from './useDrawingCanvasRuntimeEffectsBridge';

type KeyboardOptions =
  UseDrawingCanvasRuntimeEffectsBridgeOptions['interactionBridgeOptionsArgs']['keyboardOptions'];

export interface BuildDrawingCanvasRuntimeEffectsKeyboardOptionsArgs {
  refs: Pick<
    KeyboardOptions,
    | 'isSpacePressedRef'
    | 'setShowBrushCursorRef'
    | 'setCursorStyleRef'
    | 'mousePositionRef'
    | 'isMouseDownRef'
    | 'panRef'
    | 'canvasRef'
    | 'viewTransformRef'
  >;
  state: Pick<
    KeyboardOptions,
    | 'defaultCursorStyle'
    | 'toolStateMachine'
    | 'drawingHandlers'
    | 'brushEngine'
    | 'layers'
    | 'activeLayerId'
    | 'tools'
    | 'isColorCyclePlaybackActive'
    | 'stateMachine'
    | 'canvasShapeEditor'
    | 'colorAdjustActive'
    | 'crop'
    | 'floatingPaste'
    | 'previousTool'
  >;
  actions: Pick<
    KeyboardOptions,
    | 'setIsSpacePressed'
    | 'pauseAnimationForPan'
    | 'resumeAnimationAfterPan'
    | 'switchTool'
    | 'undo'
    | 'redo'
    | 'wrappedStartAnimation'
    | 'setNeedsRedraw'
    | 'cancelActiveOperations'
    | 'interactionDispatch'
    | 'commitCanvasShape'
    | 'cancelCanvasShapeEdit'
    | 'applyColorAdjust'
    | 'commitCrop'
    | 'finalizeActiveShape'
    | 'commitFloatingPaste'
    | 'draw'
    | 'cancelColorAdjust'
    | 'cancelCrop'
  >;
  render: Pick<KeyboardOptions, 'compositeCanvasDirtyRef' | 'rebuildStaticComposite'>;
}

export const buildDrawingCanvasRuntimeEffectsKeyboardOptions = ({
  refs,
  state,
  actions,
  render,
}: BuildDrawingCanvasRuntimeEffectsKeyboardOptionsArgs): KeyboardOptions => ({
  ...refs,
  ...state,
  ...actions,
  ...render,
});
