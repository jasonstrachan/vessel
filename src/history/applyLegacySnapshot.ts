import { useAppStore } from '@/stores/useAppStore';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { applyViewStateFromSnapshot } from '@/history/helpers/viewState';
import type { CanvasSnapshot, Layer } from '@/types';

const isColorCycleLayer = (
  layer: Layer | undefined | null
): layer is Layer & { colorCycleData: NonNullable<Layer['colorCycleData']> } =>
  Boolean(layer && layer.layerType === 'color-cycle' && layer.colorCycleData);

const rebuildLayersFromSnapshot = (
  snapshotLayers: Layer[],
  existingLayers: Layer[]
): Layer[] => {
  const manager = getColorCycleBrushManager();

  const resolveDimension = (candidates: Array<number | undefined>): number => {
    const value = candidates.find(
      (candidate): candidate is number =>
        typeof candidate === 'number' && Number.isFinite(candidate) && candidate > 0
    );
    return Math.max(1, Math.round(value ?? 1));
  };

  return snapshotLayers.map((layer) => {
    const existing = existingLayers.find((candidate) => candidate.id === layer.id) ?? null;
    const baseProps = {
      id: layer.id,
      name: layer.name,
      visible: layer.visible,
      opacity: layer.opacity,
      blendMode: layer.blendMode,
      locked: layer.locked,
      transparencyLocked: layer.transparencyLocked === true,
      order: layer.order,
      imageData: layer.imageData,
      framebuffer: layer.framebuffer,
      alignment: layer.alignment
    } as Layer;

    const snapshotColorCycle = layer.colorCycleData;
    if (!snapshotColorCycle) {
      return {
        ...baseProps,
        layerType: 'normal',
        colorCycleData: undefined
      } as Layer;
    }

    try {
      manager.removeColorCycleBrush(layer.id);
    } catch {
      // ignore failures
    }

    if (snapshotColorCycle.mode === 'recolor') {
      return {
        ...baseProps,
        layerType: 'color-cycle',
        colorCycleData: {
          ...snapshotColorCycle,
          isAnimating: false,
          colorCycleBrush: undefined
        }
      } as Layer;
    }

    const targetWidth = resolveDimension([
      snapshotColorCycle.canvasImageData?.width,
      layer.imageData?.width,
      snapshotColorCycle.canvas?.width,
      existing?.colorCycleData?.canvas?.width,
      existing?.imageData?.width
    ]);
    const targetHeight = resolveDimension([
      snapshotColorCycle.canvasImageData?.height,
      layer.imageData?.height,
      snapshotColorCycle.canvas?.height,
      existing?.colorCycleData?.canvas?.height,
      existing?.imageData?.height
    ]);

    let canvas: HTMLCanvasElement | OffscreenCanvas | undefined = snapshotColorCycle.canvas ?? undefined;
    if (!canvas && typeof document !== 'undefined') {
      const created = document.createElement('canvas');
      created.width = targetWidth;
      created.height = targetHeight;
      const ctx = created.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        ctx.clearRect(0, 0, created.width, created.height);
        if (snapshotColorCycle.canvasImageData) {
          ctx.putImageData(snapshotColorCycle.canvasImageData, 0, 0);
        } else if (layer.imageData) {
          ctx.putImageData(layer.imageData, 0, 0);
        }
      }
      canvas = created;
    }

    return {
      ...baseProps,
      layerType: 'color-cycle',
      colorCycleData: {
        ...snapshotColorCycle,
        canvas,
        isAnimating: false,
        colorCycleBrush: snapshotColorCycle.colorCycleBrush
      }
    } as Layer;
  });
};

export interface ApplySnapshotResult {
  restoredLayers: Layer[] | null;
}

export const applyLegacySnapshot = async (
  snapshot: CanvasSnapshot
): Promise<ApplySnapshotResult> => {
  applyViewStateFromSnapshot(snapshot);

  const store = useAppStore.getState();
  const existingLayers = store.layers;
  const restoredLayers = snapshot.layers
    ? rebuildLayersFromSnapshot(snapshot.layers as Layer[], existingLayers)
    : null;

  if (snapshot.layers && restoredLayers) {
    store.setLayers(restoredLayers);
    if (snapshot.activeLayerId) {
      store.setActiveLayer(snapshot.activeLayerId);
    }

    useAppStore.setState((state) => {
      if (!state.project) {
        return state;
      }
      const nextWidth = snapshot.projectSize?.width ?? state.project.width;
      const nextHeight = snapshot.projectSize?.height ?? state.project.height;
      return {
        project: {
          ...state.project,
          width: nextWidth,
          height: nextHeight,
          layers: restoredLayers,
          updatedAt: new Date()
        }
      };
    });

    if (snapshot.colorCycleState) {
      const { layerId } = snapshot.colorCycleState;
      const layer = restoredLayers.find((candidate) => candidate.id === layerId);
      if (isColorCycleLayer(layer) && layer.colorCycleData.colorCycleBrush) {
        try {
          layer.colorCycleData.colorCycleBrush.restoreFullState({
            gradients: snapshot.colorCycleState.gradients.map((gradient) => ({
              gradientStops: gradient.gradientStops
            })),
            animationState: snapshot.colorCycleState.animationState,
            layerSnapshots: snapshot.colorCycleState.layerStrokes
          });
        } catch {
          // ignore failure to restore state
        }
      }
    }

    try {
      const activeRestored = restoredLayers.find((layer) => layer.id === snapshot.activeLayerId);
      if (isColorCycleLayer(activeRestored) && activeRestored.colorCycleData.canvas) {
        await store.captureCanvasToActiveLayer(activeRestored.colorCycleData.canvas as HTMLCanvasElement);
      }
    } catch {
      // ignore capture failures
    }

    restoredLayers.forEach((layer) => {
      if (isColorCycleLayer(layer) && !layer.colorCycleData.colorCycleBrush) {
        const canvas = layer.colorCycleData.canvas;
        if (canvas) {
          store.initColorCycleForLayer(layer.id, canvas.width, canvas.height);
        }
      }
    });

    useAppStore.setState({
      layersNeedRecomposition: true,
      floatingPaste: null,
    });

    const recolor = RecolorManager.getInstance();
    try {
      for (const layer of restoredLayers) {
        if (isColorCycleLayer(layer) && layer.colorCycleData.mode === 'recolor') {
          recolor.processLayer(layer).catch(() => {});
        }
      }
    } catch {
      // ignore recolor failures
    }

    return { restoredLayers };
  }

  return { restoredLayers: null };
};
