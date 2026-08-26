import { useMemo } from 'react';

import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { setSequentialFrameCursor } from '@/runtime/playback/sequentialFrameCursor';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import type { FrameProvider } from '@/utils/export/types';

import { hasSequentialExportLayers } from './exportModalModel';

interface UseExportFrameProviderOptions {
  width: number;
  height: number;
  compositeLayersToCanvas?: (canvas: HTMLCanvasElement) => void;
}

export const useExportFrameProvider = ({
  width,
  height,
  compositeLayersToCanvas,
}: UseExportFrameProviderOptions): FrameProvider => useMemo<FrameProvider>(() => ({
  getDimensions: () => ({ width, height }),
  compositeToCanvas: (canvas) => {
    compositeLayersToCanvas?.(canvas);
  },
  beginAnimationSession: ({ fps, kind }) => {
    const setSequentialExportFrame = (frame: number) => {
      try {
        const currentState = getAppStoreState() as {
          sequentialRecord?: { frameCount?: number };
        };
        setSequentialFrameCursor({
          nextFrame: frame,
          nextFrameCount: currentState.sequentialRecord?.frameCount ?? 1,
        });
        const rawStore = useAppStore as unknown as {
          setState?: (updater: (state: unknown) => unknown) => void;
        };
        if (typeof rawStore.setState === 'function') {
          rawStore.setState((state: unknown) => {
            const typedState = state as {
              sequentialRecord?: { currentFrame?: number };
            };
            if (!typedState.sequentialRecord) {
              return state;
            }
            return {
              ...typedState,
              sequentialRecord: {
                ...typedState.sequentialRecord,
                currentFrame: frame,
              },
            };
          });
          return;
        }
      } catch {
        // Fall through to the public store action when the direct test seam is unavailable.
      }

      try {
        const fallbackStore = getAppStoreState() as {
          setSequentialFrame?: (nextFrame: number) => void;
        };
        fallbackStore.setSequentialFrame?.(frame);
      } catch {
        // Sequential playback is optional for non-sequential exports.
      }
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
      sequentialRecord?: { currentFrame?: number };
      setSequentialFrame?: (frame: number) => void;
    };
    const initialSequentialFrame = (
      hasSequentialExportLayers(initialStore.layers)
      && typeof initialStore.setSequentialFrame === 'function'
    )
      ? initialStore.sequentialRecord?.currentFrame ?? 0
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
      if (initialSequentialFrame !== null) {
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
      if (initialSequentialFrame !== null) {
        setSequentialExportFrame(initialSequentialFrame);
      }
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
}), [compositeLayersToCanvas, height, width]);
