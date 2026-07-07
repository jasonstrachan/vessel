import { logError } from '@/utils/debug';
import type {
  RuntimeBridgeArgs,
  StrokeStartRuntimeOptions,
  UseDrawingHandlersRuntimeSetupBridgeOptions,
} from '@/hooks/canvas/useDrawingHandlersRuntimeSetupBridge.types';

interface BuildDrawingHandlersStrokeStartRuntimeOptions {
  project: UseDrawingHandlersRuntimeSetupBridgeOptions['project'];
  storeRef: UseDrawingHandlersRuntimeSetupBridgeOptions['storeRef'];
  sampleColorAt: UseDrawingHandlersRuntimeSetupBridgeOptions['sampleColorAt'];
  debugVerbose: UseDrawingHandlersRuntimeSetupBridgeOptions['debugVerbose'];
  brushRuntime: StrokeStartRuntimeOptions['brushRuntime'];
  userBrushEngine: UseDrawingHandlersRuntimeSetupBridgeOptions['userBrushEngine'];
  shapeRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['shapeRuntime'];
  brushToolRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['brushToolRuntime'];
  colorCycleRuntime: UseDrawingHandlersRuntimeSetupBridgeOptions['colorCycleRuntime'];
}

export const buildDrawingHandlersStrokeStartRuntimeOptions = ({
  project,
  storeRef,
  sampleColorAt,
  debugVerbose,
  brushRuntime,
  userBrushEngine,
  shapeRuntime,
  brushToolRuntime,
  colorCycleRuntime,
}: BuildDrawingHandlersStrokeStartRuntimeOptions): RuntimeBridgeArgs['strokeLifecycleOptions']['startRuntimeOptions'] => ({
  project,
  storeRef,
  sampleColorAt,
  sampleHexAt: colorCycleRuntime.sampleHexAt,
  debugVerbose,
  logError,
  brushRuntime,
  userBrushEngine: userBrushEngine as unknown as StrokeStartRuntimeOptions['userBrushEngine'],
  beginStrokeSession: brushToolRuntime.beginStrokeSession,
  ensureOverlayInitialized: colorCycleRuntime.ensureOverlayInitialized,
  renderBrushSamplingPreview: colorCycleRuntime.renderBrushSamplingPreview,
  updateCcSampledGradient: colorCycleRuntime.updateCcSampledGradient,
  getEffectiveColorCyclePlaying: colorCycleRuntime.getEffectiveColorCyclePlaying,
  pauseColorCycleForNonCCInteraction: colorCycleRuntime.pauseColorCycleForNonCCInteraction,
  drawEraserSegment: shapeRuntime.drawEraserSegment,
  createBrushStampSource: brushToolRuntime.createBrushStampSource,
  getBrushHalfSize: brushToolRuntime.getBrushHalfSize,
  getColorCycleBrushEraserSettings: brushToolRuntime.getColorCycleBrushEraserSettings,
  scheduleRecompose: colorCycleRuntime.scheduleRecompose,
  getCCStampTargetCtx: brushToolRuntime.getCCStampTargetCtx,
  beginMaskHealingStroke: brushToolRuntime.beginMaskHealingStroke,
});
