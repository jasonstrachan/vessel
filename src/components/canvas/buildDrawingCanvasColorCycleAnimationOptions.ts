import type { UseDrawingCanvasColorCycleAnimationBridgeOptions } from './useDrawingCanvasColorCycleAnimationBridge';

interface BuildDrawingCanvasColorCycleAnimationOptionsArgs {
  controls: Pick<
    UseDrawingCanvasColorCycleAnimationBridgeOptions,
    | 'startContinuousColorCycleAnimation'
    | 'stopContinuousColorCycleAnimation'
    | 'showFeedback'
    | 'setFeedbackCallback'
  >;
  layerState: Pick<
    UseDrawingCanvasColorCycleAnimationBridgeOptions,
    'activeLayerId' | 'layers' | 'suspendedForNonCCActiveLayerRef'
  >;
  viewportState: Pick<
    UseDrawingCanvasColorCycleAnimationBridgeOptions,
    'wrapperRef' | 'setCanvasViewport'
  >;
  runtimeState: Omit<
    UseDrawingCanvasColorCycleAnimationBridgeOptions,
    keyof BuildDrawingCanvasColorCycleAnimationOptionsArgs['controls'] |
      keyof BuildDrawingCanvasColorCycleAnimationOptionsArgs['layerState'] |
      keyof BuildDrawingCanvasColorCycleAnimationOptionsArgs['viewportState']
  >;
}

export const buildDrawingCanvasColorCycleAnimationOptions = ({
  controls,
  layerState,
  viewportState,
  runtimeState,
}: BuildDrawingCanvasColorCycleAnimationOptionsArgs): UseDrawingCanvasColorCycleAnimationBridgeOptions => ({
  ...controls,
  ...layerState,
  ...viewportState,
  ...runtimeState,
});
