import type { StoreApi } from 'zustand';

import { restoreOwnedProperties } from '@/history/storeStateCompensation';
import { cloneRecolorSettings } from '@/history/deltas/recolorDelta';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  mapDocumentSnapshotToArchiveState,
  readColorCycleBrushLayerSnapshotFromDocumentRead,
} from '@/lib/colorCycle/document';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';

const restoreCropLayer = (current: Layer, before: Layer): Layer => {
  const restored = restoreOwnedProperties(current, before, [
    'imageData', 'framebuffer', 'sequentialData',
  ]);
  restored.alignment = restoreOwnedProperties(current.alignment, before.alignment, ['offsetPercent']);
  if (current.colorCycleData && before.colorCycleData) {
    restored.colorCycleData = restoreOwnedProperties(current.colorCycleData, before.colorCycleData, [
      'colorCycleBrush', 'canvas', 'canvasImageData', 'canvasWidth', 'canvasHeight',
      'eraseMaskImageData', 'eraseMask', 'eraseMaskVersion',
      'softEdgeMaskImageData', 'softEdgeMask', 'softEdgeMaskVersion',
    ]);
    const currentSettings = current.colorCycleData.recolorSettings;
    const beforeSettings = before.colorCycleData.recolorSettings;
    restored.colorCycleData = currentSettings && beforeSettings ? {
      ...restored.colorCycleData,
      recolorSettings: restoreOwnedProperties(currentSettings, beforeSettings, [
        'originalImageData', 'indexBuffer', 'phaseMap',
      ]),
    } : restoreOwnedProperties(restored.colorCycleData, before.colorCycleData, ['recolorSettings']);
  } else {
    return restoreOwnedProperties(restored, before, ['colorCycleData']);
  }
  return restored;
};

/** Capture before Crop can replace runtime resources or publish new document state. */
export const captureCropRollback = (
  before: AppState,
  manager: ColorCycleBrushManager,
  get: () => AppState,
  set: StoreApi<AppState>['setState'],
  syncPlayback: (layers: Layer[], cause: string) => void,
): (() => Promise<void>) => {
  const projectId = before.project?.id;
  const canonical = before.layers
    .filter((layer) => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor')
    .map((layer) => {
      const document = manager.getDocument(layer.id);
      const read = document?.read();
      return {
        layer,
        brush: manager.getHistoryBrush(layer.id),
        document,
        read,
        runtimeSnapshot: read ? readColorCycleBrushLayerSnapshotFromDocumentRead(read) : null,
        archive: read ? mapDocumentSnapshotToArchiveState(read.snapshot) : null,
        residency: document?.residency,
        archiveRefs: document?.archiveRefs ?? null,
        auditEntries: document?.getAuditLog(),
        dirtyBatch: document?.peekDirtyBatch() ?? null,
      };
    });
  const isCurrentProject = () => get().project?.id === projectId;

  return async () => {
    if (!isCurrentProject()) return;
    const beforeLayers = new Map(before.layers.map((layer) => [layer.id, layer]));
    const restoredLayers = get().layers.map((layer) => {
      const baseline = beforeLayers.get(layer.id);
      return baseline ? restoreCropLayer(layer, baseline) : layer;
    });
    set((current) => ({
      project: current.project && before.project ? {
        ...restoreOwnedProperties(current.project, before.project, [
          'width', 'height', 'updatedAt', 'txtShapes', 'uiShapes', 'canvasShape',
        ]),
        layers: restoredLayers,
      } : before.project,
      layers: restoredLayers,
      canvas: restoreOwnedProperties(current.canvas, before.canvas, [
        'canvasWidth', 'canvasHeight', 'offsetX', 'offsetY', 'selection',
      ]),
      selectionStart: before.selectionStart,
      selectionEnd: before.selectionEnd,
      selectionMask: before.selectionMask,
      selectionMaskBounds: before.selectionMaskBounds,
      selectionMaskLayerId: before.selectionMaskLayerId,
      selectionVectorPath: before.selectionVectorPath,
      selectionLastAction: before.selectionLastAction,
      floatingPaste: before.floatingPaste,
      currentOffscreenCanvas: before.currentOffscreenCanvas,
      currentCompositeBitmap: null,
      colorCyclePlayback: restoreOwnedProperties(current.colorCyclePlayback, before.colorCyclePlayback, [
        'desiredPlaying', 'suspendDepth', 'lastReason',
      ]),
      crop: { ...before.crop, commitInFlight: true },
    }));

    for (const entry of canonical) {
      if (!isCurrentProject()) return;
      const index = restoredLayers.findIndex((layer) => layer.id === entry.layer.id);
      if (index === -1) continue;
      // Crop destroys the old resident brush. Never put its stale object back into
      // the store as a usable runtime; recover from the original canonical document.
      const changed = manager.getHistoryBrush(entry.layer.id) !== entry.brush
        || manager.getDocument(entry.layer.id) !== entry.document
        || manager.getDocument(entry.layer.id)?.read().version !== entry.read?.version;
      if (!changed) continue;
      manager.deleteBrush(entry.layer.id);
      if (!entry.document || !entry.archive || !entry.read || !entry.residency) continue;
      const restoreDocument = () => entry.document!.replaceBaseline(entry.archive!, {
        version: entry.read!.version,
        pixelVersion: entry.read!.pixelVersion,
        residency: entry.residency!,
        archiveRefs: entry.archiveRefs,
        auditEntries: entry.auditEntries,
        dirtyBatch: entry.dirtyBatch,
      });
      restoreDocument();
      manager.registerDocument(entry.layer.id, entry.document);
      if (!entry.brush) continue;
      const canvas = entry.layer.colorCycleData?.canvas;
      if (!entry.runtimeSnapshot || !canvas) {
        throw new Error(`Cannot restore pre-crop runtime for ${entry.layer.id}.`);
      }
      const brush = manager.createBrush(entry.layer.id, entry.read.snapshot.width, entry.read.snapshot.height);
      brush.setTargetCanvas?.(canvas);
      try {
        if (!applyColorCycleBrushLayerSnapshotToRuntime(
          brush, entry.layer.id, entry.runtimeSnapshot, undefined, 'crop-rollback', { suppressClearAudit: true },
        )) {
          throw new Error(`Pre-crop runtime snapshot rejected for ${entry.layer.id}.`);
        }
        brush.renderDirectToCanvas?.(canvas, entry.layer.id);
      } finally {
        // Runtime publication is derived work: retain original document versions,
        // residency, archive references, audit and pending dirty regions exactly.
        restoreDocument();
      }
      restoredLayers[index] = {
        ...restoredLayers[index],
        colorCycleData: { ...restoredLayers[index].colorCycleData, colorCycleBrush: brush },
      };
      manager.setActiveState(entry.layer.id, get().activeLayerId === entry.layer.id);
    }

    for (let index = 0; index < restoredLayers.length; index += 1) {
      const layer = restoredLayers[index];
      if (!beforeLayers.has(layer.id) || layer.colorCycleData?.mode !== 'recolor') continue;
      if (!isCurrentProject()) return;
      const restored = {
        ...layer,
        colorCycleData: {
          ...layer.colorCycleData,
          recolorSettings: cloneRecolorSettings(layer.colorCycleData.recolorSettings),
        },
      };
      if (!await RecolorManager.getInstance().restoreLayer(restored)) {
        throw new Error(`Cannot restore pre-crop Recolor runtime for ${layer.id}.`);
      }
      restoredLayers[index] = restored;
    }

    if (!isCurrentProject()) return;
    set((current) => {
      const recovered = new Map(restoredLayers.map((layer) => [layer.id, layer]));
      const layers = current.layers.map((layer) => {
        const baseline = beforeLayers.has(layer.id) ? recovered.get(layer.id) : undefined;
        return baseline ? restoreCropLayer(layer, baseline) : layer;
      });
      return {
        layers,
        project: current.project ? { ...current.project, layers } : current.project,
        crop: before.crop,
        currentOffscreenCanvas: before.currentOffscreenCanvas,
      };
    });
    syncPlayback(get().layers.filter((layer) => layer.layerType === 'color-cycle'), 'crop-rollback');
    get().setLayersNeedRecomposition(true);
  };
};
