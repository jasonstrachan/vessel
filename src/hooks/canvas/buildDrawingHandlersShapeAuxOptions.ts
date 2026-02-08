import type {
  RuntimeBridgeArgs,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersShapeAuxOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  shapeRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
}

export const buildDrawingHandlersShapeAuxOptions = ({
  project,
  storeRef,
  shapeRuntime,
  brushToolRuntime,
}: BuildDrawingHandlersShapeAuxOptions): RuntimeBridgeArgs['shapeLifecycleOptions']['shapeAuxOptions'] => ({
  endMaskHealingStroke: brushToolRuntime.endMaskHealingStroke,
  resetShapeDragRefs: shapeRuntime.resetShapeDragRefs,
  storeRef,
  seedManualStrokeBoundingBox: shapeRuntime.seedManualStrokeBoundingBox,
  triggerSimpleShapePreview: shapeRuntime.triggerSimpleShapePreview,
  project,
});
