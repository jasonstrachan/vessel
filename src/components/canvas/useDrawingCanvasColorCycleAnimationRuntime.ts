import { buildDrawingCanvasColorCycleAnimationOptions } from './buildDrawingCanvasColorCycleAnimationOptions';
import {
  useDrawingCanvasColorCycleAnimationBridge,
  type UseDrawingCanvasColorCycleAnimationBridgeOptions,
} from './useDrawingCanvasColorCycleAnimationBridge';

interface UseDrawingCanvasColorCycleAnimationRuntimeOptions {
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
    keyof UseDrawingCanvasColorCycleAnimationRuntimeOptions['controls'] |
      keyof UseDrawingCanvasColorCycleAnimationRuntimeOptions['layerState'] |
      keyof UseDrawingCanvasColorCycleAnimationRuntimeOptions['viewportState']
  >;
}

export const useDrawingCanvasColorCycleAnimationRuntime = ({
  controls,
  layerState,
  viewportState,
  runtimeState,
}: UseDrawingCanvasColorCycleAnimationRuntimeOptions) =>
  useDrawingCanvasColorCycleAnimationBridge(
    buildDrawingCanvasColorCycleAnimationOptions({
      controls,
      layerState,
      viewportState,
      runtimeState,
    })
  );
