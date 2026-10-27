import { useMemo } from 'react';

import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import {
  beginSequentialExportTimeline,
  setSequentialExportTime,
} from '@/runtime/playback/sequentialFrameCursor';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { Layer } from '@/types';
import type { CompositeLayersToCanvasOptions } from '@/stores/layers/layersSliceTypes';
import type { FrameProvider } from '@/utils/export/types';
import { applyCanvasShapeMask, normalizeCanvasShape } from '@/utils/canvasShape';

import { hasSequentialExportLayers } from './exportModalModel';

interface UseExportFrameProviderOptions {
  width: number;
  height: number;
  compositeLayersToCanvasSync: (canvas: HTMLCanvasElement, options?: CompositeLayersToCanvasOptions) => boolean;
  includeBackground: boolean;
}

export const useExportFrameProvider = ({
  width,
  height,
  compositeLayersToCanvasSync,
  includeBackground,
}: UseExportFrameProviderOptions): FrameProvider => useMemo<FrameProvider>(() => ({
  getDimensions: () => ({ width, height }),
  compositeToCanvas: (canvas) => {
    if (!compositeLayersToCanvasSync(canvas, { includeBackground })) {
      throw new Error('Failed to composite export frame');
    }
    const project = getAppStoreState().project;
    if (project) {
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Failed to acquire export frame context');
      applyCanvasShapeMask(context, normalizeCanvasShape(project.canvasShape, width, height));
    }
  },
  beginAnimationSession: ({ fps, kind }) => {
    const setSequentialExportFrame = (frame: number) => {
      setSequentialExportTime((Math.max(0, frame) * 1000) / Math.max(1, fps));
    };

    const recolorManager = RecolorManager.getInstance();
    const colorCycleBrushManager = getColorCycleBrushManager();
    const originalStates: Array<{
      layerId: string;
      wasPlaying: boolean;
      wasAnimating: boolean;
    }> = [];
    const initialStore = getAppStoreState() as {
      layers?: Layer[];
    };
    const endSequentialExportTimeline = hasSequentialExportLayers(initialStore.layers)
      ? beginSequentialExportTimeline()
      : null;

    if (kind !== 'estimate') {
      try {
        const store = getAppStoreState();
        for (const layer of store.layers) {
          if (layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
            continue;
          }
          const brush = colorCycleBrushManager.getExportPlaybackBrush(layer.id);
          const wasPlaying = !!brush?.isPlaying?.();
          const wasAnimating = !!layer.colorCycleData.isAnimating;
          originalStates.push({ layerId: layer.id, wasPlaying, wasAnimating });
          if (!wasAnimating) {
            store.updateLayer(layer.id, {
              colorCycleData: {
                ...layer.colorCycleData,
                isAnimating: true,
              },
            });
          }
          if (brush) {
            try {
              brush.applySettings?.({ fps });
            } catch {
              // Preserve export when a stale brush cannot accept settings.
            }
            brush.setPlaying?.(false);
          }
        }
        if (kind === 'gif') {
          try {
            recolorManager.setFPS(fps);
          } catch {
            // GIF export can continue with the current recolor FPS.
          }
        }
      } catch {
        // The export service reports any material frame-capture failure.
      }
    }

    const stepFrame = ({
      frameIndex,
      totalFrames,
      useAbsolutePhase,
    }: {
      frameIndex: number;
      totalFrames: number;
      useAbsolutePhase: boolean;
    }) => {
      if (endSequentialExportTimeline) {
        setSequentialExportFrame(frameIndex);
      }

      try {
        const store = getAppStoreState();
        const phase = useAbsolutePhase ? frameIndex / totalFrames : null;
        for (const layer of store.layers) {
          if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
            if (useAbsolutePhase && phase !== null) {
              recolorManager.setPhase(layer, phase);
            } else {
              recolorManager.updateAnimation(layer);
            }
          }
        }
        for (const layer of store.layers) {
          if (layer.layerType !== 'color-cycle'
            || !layer.colorCycleData
            || layer.colorCycleData.mode === 'recolor') {
            continue;
          }
          const brush = colorCycleBrushManager.getExportPlaybackBrush(layer.id);
          if (useAbsolutePhase && phase !== null) {
            brush?.setPhase?.(phase);
          } else {
            brush?.updateAnimation?.();
          }
        }
      } catch {
        // The export service reports any material frame-capture failure.
      }
    };

    const advanceFrame = () => {
      try {
        const store = getAppStoreState();
        for (const layer of store.layers) {
          if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode === 'recolor') {
            recolorManager.updateAnimation(layer);
          }
        }
      } catch {
        // The export service reports any material frame-capture failure.
      }
    };

    const finish = () => {
      endSequentialExportTimeline?.();
      if (kind === 'estimate') {
        return;
      }

      try {
        const store = getAppStoreState();
        for (const originalState of originalStates) {
          const layer = store.layers.find((candidate) => candidate.id === originalState.layerId);
          if (!layer) {
            continue;
          }
          if (!originalState.wasAnimating && layer.colorCycleData) {
            store.updateLayer(layer.id, {
              colorCycleData: {
                ...layer.colorCycleData,
                isAnimating: false,
              },
            });
          }
          const brush = colorCycleBrushManager.getExportPlaybackBrush(layer.id);
          try {
            brush?.applySettings?.({
              fps: store.tools?.brushSettings?.colorCycleFPS || 30,
            });
          } catch {
            // Restore playback state even when the brush settings call is stale.
          }
          brush?.setPlaying?.(originalState.wasPlaying);
        }
      } catch {
        // Cleanup should not mask the completed export result.
      }
    };

    return { stepFrame, advanceFrame, finish };
  },
}), [compositeLayersToCanvasSync, height, includeBackground, width]);
