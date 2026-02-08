import {
  createFinalizeLayerCaptureContextDeps as createFinalizeLayerCaptureContextDepsExternal,
} from '@/hooks/canvas/handlers/finalizeLayerCaptureContextDeps';
import {
  createFinalizeLostEdgeDispatcher as createFinalizeLostEdgeDispatcherExternal,
} from '@/hooks/canvas/handlers/finalizeLostEdgeDeps';
import {
  createFinalizeBrushContextDeps as createFinalizeBrushContextDepsExternal,
} from '@/hooks/canvas/handlers/finalizeBrushContextDeps';
import {
  createFinalizeEraserStrokeDeps as createFinalizeEraserStrokeDepsExternal,
} from '@/hooks/canvas/handlers/eraserFinalize';
import {
  createFinalizeDrawingCleanupDeps as createFinalizeDrawingCleanupDepsExternal,
} from '@/hooks/canvas/handlers/finalizeCleanupDeps';

type FinalizeLayerCaptureContextDepsArgs =
  Parameters<typeof createFinalizeLayerCaptureContextDepsExternal>[0];
type FinalizeLostEdgeDispatcherArgs =
  Parameters<typeof createFinalizeLostEdgeDispatcherExternal>[0];
type FinalizeBrushContextDepsArgs =
  Parameters<typeof createFinalizeBrushContextDepsExternal>[0];
type FinalizeEraserStrokeDepsArgs =
  Parameters<typeof createFinalizeEraserStrokeDepsExternal>[0];
type FinalizeDrawingCleanupDepsArgs =
  Parameters<typeof createFinalizeDrawingCleanupDepsExternal>[0];

export const buildFinalizeLayerCaptureContextDepsArgs = (
  args: FinalizeLayerCaptureContextDepsArgs
): FinalizeLayerCaptureContextDepsArgs => args;

export const buildFinalizeLostEdgeDispatcherArgs = (
  args: FinalizeLostEdgeDispatcherArgs
): FinalizeLostEdgeDispatcherArgs => args;

export const buildFinalizeBrushContextDepsArgs = (
  args: FinalizeBrushContextDepsArgs
): FinalizeBrushContextDepsArgs => args;

export const buildFinalizeEraserStrokeDepsArgs = (
  args: FinalizeEraserStrokeDepsArgs
): FinalizeEraserStrokeDepsArgs => args;

export const buildFinalizeDrawingCleanupDepsArgs = (
  args: FinalizeDrawingCleanupDepsArgs
): FinalizeDrawingCleanupDepsArgs => args;
