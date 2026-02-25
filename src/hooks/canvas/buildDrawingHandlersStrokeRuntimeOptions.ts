import type {
  RuntimeBridgeArgs,
  StrokeRuntimeOptions,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersStrokeRuntimeOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  brushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['brushEngine'];
  userBrushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['userBrushEngine'];
  shapeRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersStrokeRuntimeOptions = ({
  project,
  storeRef,
  brushEngine,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersStrokeRuntimeOptions): RuntimeBridgeArgs['strokeLifecycleOptions']['strokeRuntimeOptions'] => ({
  storeRef,
  project,
  brushEngine: brushEngine as StrokeRuntimeOptions['brushEngine'],
  userBrushEngine: userBrushEngine as unknown as StrokeRuntimeOptions['userBrushEngine'],
  drawEraserSegment: shapeRuntime.drawEraserSegment,
  updateAutoSampledGradient: colorCycleRuntime.updateAutoSampledGradient,
  updateCcSampledGradient: colorCycleRuntime.updateCcSampledGradient,
  renderBrushSamplingPreview: colorCycleRuntime.renderBrushSamplingPreview,
  getCCStampTargetCtx: brushToolRuntime.getCCStampTargetCtx,
  scheduleRecompose: colorCycleRuntime.scheduleRecompose,
  extendMaskHealingStroke: brushToolRuntime.extendMaskHealingStroke,
  endStrokeSession: brushToolRuntime.endStrokeSession,
});
