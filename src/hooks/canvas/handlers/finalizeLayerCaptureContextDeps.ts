import { buildStrokeCoalescePayload } from '@/hooks/canvas/handlers/strokeHistoryCoalesce';
import {
  prepareStrokeCapture,
  type PrepareStrokeCaptureDeps,
} from '@/hooks/canvas/handlers/strokeCapture';
import type { PrepareFinalizeLayerCaptureContextDeps } from '@/hooks/canvas/handlers/finalizeLayerCaptureContext';

export const createFinalizeLayerCaptureContextDeps = ({
  boundingBoxToCaptureRegion,
  rectToCaptureRegion,
  unionCaptureRegions,
  captureLayerRegionImageData,
  ensureLayerSnapshotWithRetry,
  logError,
}: {
} & PrepareStrokeCaptureDeps): PrepareFinalizeLayerCaptureContextDeps => ({
  buildStrokeCoalescePayload: (args) =>
    buildStrokeCoalescePayload({
      activeStrokeSessionRef: args.activeStrokeSessionRef,
      endStrokeSession: args.endStrokeSession,
      activeLayerId: args.activeLayerId,
      currentTool: args.currentTool,
      maxIntervalMs: args.maxIntervalMs,
    }),
  prepareStrokeCapture: async (args) =>
    prepareStrokeCapture(args, {
      boundingBoxToCaptureRegion,
      rectToCaptureRegion,
      unionCaptureRegions,
      captureLayerRegionImageData,
      ensureLayerSnapshotWithRetry,
      logError,
    }),
});
