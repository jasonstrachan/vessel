import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { PrepareFinalizeBrushContextDeps } from '@/hooks/canvas/handlers/finalizeBrushContext';
import { ensureColorCycleLayerCanvas } from '@/hooks/canvas/handlers/colorCycle/colorCycleLayerInit';
import { resolveStrokeHistoryMetadata } from '@/hooks/canvas/handlers/strokeHistoryMetadata';

export const createFinalizeBrushContextDeps = ({
  storeRef,
}: {
  storeRef: React.MutableRefObject<AppState>;
}): PrepareFinalizeBrushContextDeps => ({
  ensureColorCycleLayerCanvas: (args) =>
    ensureColorCycleLayerCanvas(args, { storeRef }),
  resolveStrokeHistoryMetadata,
});
