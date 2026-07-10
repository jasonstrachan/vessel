import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';

/**
 * Captures the cold runtime boundary before replay is allowed to initialize it.
 * Content compensation runs first; this cleanup then restores runtime residency
 * and the exact store objects that existed before replay.
 */
export const captureColdColorCycleRuntimeCompensation = (layerId: string) => {
  const manager = getColorCycleBrushManager();
  const hadBrush = Boolean(manager.hasBrush?.(layerId) || manager.getHistoryBrush(layerId));
  const document = manager.getDocument(layerId);
  const documentRead = document?.read();
  const documentResidency = document?.residency;
  const documentArchiveRefs = document?.archiveRefs ?? null;
  const documentAuditEntries = document?.getAuditLog?.();
  const documentDirtyBatch = document?.peekDirtyBatch?.() ?? null;
  const state = useAppStore.getState();
  const storeSnapshot = {
    layers: state.layers,
    layersNeedRecomposition: state.layersNeedRecomposition,
    compositeSegments: state.compositeSegments,
    pendingCompositeDirtyBatches: state.pendingCompositeDirtyBatches,
  };

  return {
    hadBrush,
    restoreIfCreated: () => {
      if (hadBrush) {
        return;
      }

      manager.deleteBrush?.(layerId);
      if (document && documentRead && documentResidency) {
        document.replaceBaseline(documentRead.snapshot, {
          version: documentRead.version,
          pixelVersion: documentRead.pixelVersion,
          residency: documentResidency,
          archiveRefs: documentArchiveRefs,
          auditEntries: documentAuditEntries,
          dirtyBatch: documentDirtyBatch,
        });
        manager.registerDocument?.(layerId, document);
      }

      useAppStore.setState(storeSnapshot);
    },
  };
};
