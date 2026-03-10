import { logError as defaultLogError } from '@/utils/debug';
import type { RecolorOptions } from '@/lib/colorCycle/RecolorManager';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import type { StoreApi } from 'zustand';
import type { ColorCycleBrushResetEntry, RecolorRebuildRequest } from './types';

type Logger = (message: string, error?: unknown) => void;

const toGradientArray = (
  stops: Array<{ position: number; color: string }> | undefined
): Uint8Array | undefined => {
  if (!stops || stops.length === 0) {
    return undefined;
  }
  const gradientArray = new Uint8Array(256 * 3);

  for (let i = 0; i < 256; i += 1) {
    const t = i / 255;
    let r = 0;
    let g = 0;
    let b = 0;
    for (let j = 0; j < stops.length - 1; j += 1) {
      const current = stops[j];
      const next = stops[j + 1];
      if (t >= current.position && t <= next.position) {
        const t0 = current.position;
        const t1 = next.position;
        const span = Math.max(1e-6, t1 - t0);
        const localT = (t - t0) / span;
        const c0 = parseInt(current.color.slice(1), 16);
        const c1 = parseInt(next.color.slice(1), 16);
        const r0 = (c0 >> 16) & 0xff;
        const g0 = (c0 >> 8) & 0xff;
        const b0 = c0 & 0xff;
        const r1 = (c1 >> 16) & 0xff;
        const g1 = (c1 >> 8) & 0xff;
        const b1 = c1 & 0xff;
        r = Math.round(r0 + (r1 - r0) * localT);
        g = Math.round(g0 + (g1 - g0) * localT);
        b = Math.round(b0 + (b1 - b0) * localT);
        break;
      }
    }
    gradientArray[i * 3] = r;
    gradientArray[i * 3 + 1] = g;
    gradientArray[i * 3 + 2] = b;
  }

  return gradientArray;
};

interface RebuildArgs {
  entries: ColorCycleBrushResetEntry[];
  colorCycleBrushManager: ColorCycleBrushManager;
  getState: () => AppState;
  setState: StoreApi<AppState>['setState'];
  syncCCRuntimes: (layers: Layer[], cause: string) => void;
  logError?: Logger;
}

export function rebuildCCLayerAfterCrop({
  entries,
  colorCycleBrushManager,
  getState,
  setState,
  syncCCRuntimes,
  logError
}: RebuildArgs): void {
  if (!entries.length || typeof window === 'undefined') {
    return;
  }

  const logger = logError ?? defaultLogError;

  Promise.resolve().then(() => {
    const rebuiltLayerIds: string[] = [];

    for (const entry of entries) {
      try {
        const currentState = getState();
        const targetLayer = currentState.layers.find((layer) => layer.id === entry.id);
        if (!targetLayer || targetLayer.layerType !== 'color-cycle' || !targetLayer.colorCycleData) {
          continue;
        }

        if (entry.mode === 'recolor') {
          continue;
        }

        const isActiveLayer = currentState.activeLayerId === entry.id;

        colorCycleBrushManager.removeColorCycleBrush(entry.id);

        const gradientStops =
          entry.gradientStops ??
          (Array.isArray(targetLayer.colorCycleData.gradient) && targetLayer.colorCycleData.gradient.length > 0
            ? targetLayer.colorCycleData.gradient.map((stop) => ({ ...stop }))
            : targetLayer.colorCycleData.recolorSettings?.gradient?.map((stop) => ({ ...stop })));

        const gradientArray = toGradientArray(gradientStops ?? undefined);

        const freshBrush = colorCycleBrushManager.createBrush(
          entry.id,
          Math.max(1, entry.width),
          Math.max(1, entry.height),
          gradientArray
        );

        if (!freshBrush) {
          continue;
        }

        if (typeof freshBrush.setLayerId === 'function') {
          try {
            freshBrush.setLayerId(entry.id);
          } catch {}
        }

        if ('setActiveLayer' in freshBrush && typeof freshBrush.setActiveLayer === 'function') {
          try {
            freshBrush.setActiveLayer(entry.id);
          } catch {}
        }

        if (entry.strokeSnapshot) {
          try {
            const snapshotBuffer = entry.strokeSnapshot.paintBuffer.slice(0);
            freshBrush.applyLayerSnapshot?.(
              entry.id,
              {
                paintBuffer: snapshotBuffer,
                gradientIdBuffer: entry.strokeSnapshot?.gradientIdBuffer,
                gradientDefIdBuffer: entry.strokeSnapshot?.gradientDefIdBuffer,
                speedBuffer: entry.strokeSnapshot?.speedBuffer,
                flowBuffer: entry.strokeSnapshot?.flowBuffer,
                hasContent: entry.strokeSnapshot.hasContent,
                strokeCounter: entry.strokeSnapshot.strokeCounter
              },
              entry.animatorIndex
            );
          } catch (snapshotError) {
            logger('[crop] Failed to restore color-cycle stroke snapshot after crop', snapshotError);
          }
        }

        const brushCanvas = freshBrush.getCanvas?.();
        if (brushCanvas) {
          const brushCtx = brushCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
          if (brushCtx) {
            brushCtx.clearRect(0, 0, brushCanvas.width, brushCanvas.height);
            const sourceCanvas = entry.croppedCanvas;
            if (sourceCanvas) {
              try {
                brushCtx.drawImage(
                  sourceCanvas as unknown as CanvasImageSource,
                  0,
                  0,
                  brushCanvas.width,
                  brushCanvas.height
                );
              } catch {
                if (entry.imageData) {
                  brushCtx.putImageData(entry.imageData, 0, 0);
                }
              }
            }
        if (entry.imageData) {
          try {
            brushCtx.putImageData(entry.imageData, 0, 0);
          } catch {}
        }
      }
    }

        const targetControllerSpeed =
          typeof entry.controllerSpeedCps === 'number'
            ? entry.controllerSpeedCps
            : targetLayer.colorCycleData?.controllerSpeedCps ??
              targetLayer.colorCycleData?.brushSpeed ??
              getState().tools.brushSettings.colorCycleSpeed ??
              0.1;

        if (typeof freshBrush.setSpeed === 'function') {
          try {
            freshBrush.setSpeed(targetControllerSpeed);
          } catch {
            // Ignore failures; downstream logic will handle fallback speed
          }
        }

        if (freshBrush && typeof freshBrush.markLayerHasExternalBase === 'function') {
          try {
            freshBrush.markLayerHasExternalBase(entry.id);
          } catch {}
        }

        try {
          colorCycleBrushManager.setActiveState(entry.id, isActiveLayer);
        } catch {}

        setState((current) => {
          const index = current.layers.findIndex((layer) => layer.id === entry.id);
          if (index === -1) {
            return {};
          }

          const nextLayers = current.layers.map((layer, layerIndex) => {
            if (layerIndex !== index || !layer.colorCycleData) {
              return layer;
            }

            return {
              ...layer,
              colorCycleData: {
                ...layer.colorCycleData,
                colorCycleBrush: freshBrush,
                canvas: freshBrush.getCanvas ? freshBrush.getCanvas() : layer.colorCycleData.canvas,
                gradient: gradientStops ?? layer.colorCycleData.gradient,
                gradientIdBuffer:
                  entry.strokeSnapshot?.gradientIdBuffer ?? layer.colorCycleData.gradientIdBuffer,
                gradientDefIdBuffer:
                  entry.strokeSnapshot?.gradientDefIdBuffer ?? layer.colorCycleData.gradientDefIdBuffer,
                brushSpeed:
                  typeof entry.brushSpeed === 'number'
                    ? entry.brushSpeed
                    : layer.colorCycleData.brushSpeed,
                controllerSpeedCps:
                  typeof entry.controllerSpeedCps === 'number'
                    ? entry.controllerSpeedCps
                    : layer.colorCycleData.controllerSpeedCps,
                isAnimating: entry.wasAnimating
              }
            };
          });

          return { layers: nextLayers };
        });

        rebuiltLayerIds.push(entry.id);
      } catch (brushError) {
        logger('[crop] Failed to rebuild color-cycle brush after crop', brushError);
      }
    }

    if (rebuiltLayerIds.length > 0) {
      try {
        const latestState = getState();
        const layersToSync = Array.from(new Set(rebuiltLayerIds))
          .map((layerId) => latestState.layers.find((layer) => layer.id === layerId))
          .filter((layer): layer is Layer => Boolean(layer && layer.layerType === 'color-cycle' && layer.colorCycleData));
        if (layersToSync.length > 0) {
          syncCCRuntimes(layersToSync, 'crop-rebuild');
        }
      } catch (error) {
        logger('[crop] Failed to sync CC runtime after rebuild', error);
      }
    }

    getState().setLayersNeedRecomposition(true);
  });
}

interface RecolorArgs {
  queue: RecolorRebuildRequest[];
  getState: () => AppState;
  setState: StoreApi<AppState>['setState'];
  processLayer: (layer: Layer, options: Partial<RecolorOptions>) => Promise<boolean>;
  logError?: Logger;
}

export function rebuildRecolorLayersAfterCrop({
  queue,
  getState,
  setState,
  processLayer,
  logError
}: RecolorArgs): void {
  if (!queue.length || typeof window === 'undefined') {
    return;
  }

  const logger = logError ?? defaultLogError;

  Promise.resolve().then(async () => {
    for (const entry of queue) {
      const latestState = getState();
      const targetLayer = latestState.layers.find((l) => l.id === entry.id);
      if (!targetLayer || targetLayer.layerType !== 'color-cycle' || targetLayer.colorCycleData?.mode !== 'recolor') {
        continue;
      }

      try {
        const success = await processLayer(targetLayer, entry.options);
        if (!success) {
          continue;
        }

        setState((current) => {
          const index = current.layers.findIndex((layer) => layer.id === entry.id);
          if (index === -1) {
            return {};
          }
          const nextLayers = current.layers.map((layer, layerIndex) => {
            if (layerIndex !== index) {
              return layer;
            }

            const nextColorCycleData = layer.colorCycleData
              ? {
                  ...layer.colorCycleData,
                  recolorSettings: layer.colorCycleData.recolorSettings
                    ? { ...layer.colorCycleData.recolorSettings }
                    : undefined
                }
              : undefined;

            return {
              ...layer,
              colorCycleData: nextColorCycleData
            };
          });
          return {
            layers: nextLayers,
          };
        });
        getState().setLayersNeedRecomposition(true);
      } catch (recolorError) {
        logger('[crop] Failed to rebuild recolor layer after crop', recolorError);
      }
    }
  });
}
