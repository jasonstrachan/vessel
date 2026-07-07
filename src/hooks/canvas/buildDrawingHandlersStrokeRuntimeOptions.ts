import type {
  RuntimeBridgeArgs,
  StrokeRuntimeOptions,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersStrokeRuntimeOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  brushRuntime: StrokeRuntimeOptions['brushRuntime'];
  userBrushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['userBrushEngine'];
  shapeRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersStrokeRuntimeOptions = ({
  project,
  storeRef,
  brushRuntime,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersStrokeRuntimeOptions): RuntimeBridgeArgs['strokeLifecycleOptions']['strokeRuntimeOptions'] => ({
  storeRef,
  project,
  brushRuntime,
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
