import type { Layer, SequentialStrokeEvent } from '@/types';
import { isFeatureFlagEnabled } from '@/config/featureFlags';
import { SequentialEventLog } from '@/lib/sequential/SequentialEventLog';
import { SequentialFrameCache } from '@/lib/sequential/SequentialFrameCache';
import {
  recordSequentialPatchOutcome,
  recordSequentialPatchReason,
} from '@/lib/sequential/SequentialPerfCounters';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import { SequentialGpuMaterializer } from '@/lib/sequential/materializer/SequentialGpuMaterializer';
import type {
  SequentialMaterializerBackend,
  SequentialMaterializerBackendKind,
} from '@/lib/sequential/materializer/SequentialMaterializerBackend';
import type { FrameTilePatch, FrameTileSet, SequentialFrameCacheStats } from '@/lib/sequential/types';

interface LayerRuntime {
  layerId: string;
  eventLog: SequentialEventLog;
  frameCache: SequentialFrameCache;
  materializer: SequentialMaterializerBackend;
  backendKind: SequentialMaterializerBackendKind;
  renderSignature: string;
  eventCount: number;
  lastEventId: string | null;
  targetCanvas: HTMLCanvasElement | OffscreenCanvas | null;
}

const layerRuntimes = new Map<string, LayerRuntime>();
let sequentialGpuUnavailable = false;
let sequentialGpuFallbackLogged = false;
const MAX_EMPTY_FRAME_HOLD_LOOKBACK = 2;

const createCanvas = (
  width: number,
  height: number
): HTMLCanvasElement | OffscreenCanvas | null => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));

  // Prefer DOM canvas when available for maximum 2D API compatibility in tests/browser.
  if (typeof document !== 'undefined') {
    const canvas = document.createElement('canvas');
    canvas.width = safeWidth;
    canvas.height = safeHeight;
    return canvas;
  }
  if (typeof OffscreenCanvas !== 'undefined') {
    return new OffscreenCanvas(safeWidth, safeHeight);
  }
  return null;
};

const ensureCanvas = (
  runtime: LayerRuntime,
  width: number,
  height: number
): HTMLCanvasElement | OffscreenCanvas | null => {
  if (!runtime.targetCanvas) {
    runtime.targetCanvas = createCanvas(width, height);
  }
  const canvas = runtime.targetCanvas;
  if (!canvas) {
    return null;
  }
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  if (canvas.width !== safeWidth || canvas.height !== safeHeight) {
    canvas.width = safeWidth;
    canvas.height = safeHeight;
  }
  return canvas;
};

const getOrCreateRuntime = (layerId: string): LayerRuntime => {
  const desiredBackend = isFeatureFlagEnabled('enableSequentialGpuAcceleration') && !sequentialGpuUnavailable
    ? 'gpu'
    : 'cpu';
  const existing = layerRuntimes.get(layerId);
  if (existing) {
    if (existing.backendKind !== desiredBackend) {
      existing.materializer.dispose?.();
      const nextBackend = createSequentialMaterializer(desiredBackend);
      existing.materializer = nextBackend.materializer;
      existing.backendKind = nextBackend.kind;
      existing.frameCache.clearLayer(layerId);
      existing.renderSignature = '';
      existing.eventCount = 0;
      existing.lastEventId = null;
    }
    return existing;
  }
  const initialBackend = createSequentialMaterializer(desiredBackend);
  const runtime: LayerRuntime = {
    layerId,
    eventLog: new SequentialEventLog(),
    frameCache: new SequentialFrameCache({ maxEntries: 128 }),
    materializer: initialBackend.materializer,
    backendKind: initialBackend.kind,
    renderSignature: '',
    eventCount: 0,
    lastEventId: null,
    targetCanvas: null,
  };
  layerRuntimes.set(layerId, runtime);
  return runtime;
};

const createSequentialMaterializer = (
  desiredBackend: SequentialMaterializerBackendKind
): {
  kind: SequentialMaterializerBackendKind;
  materializer: SequentialMaterializerBackend;
} => {
  if (desiredBackend === 'gpu') {
    try {
      return {
        kind: 'gpu',
        materializer: new SequentialGpuMaterializer({ tileSize: 128 }),
      };
    } catch (error) {
      sequentialGpuUnavailable = true;
      if (!sequentialGpuFallbackLogged && process.env.NODE_ENV !== 'production') {
        sequentialGpuFallbackLogged = true;
        console.warn(
          '[sequential] GPU materializer unavailable, falling back to CPU backend.',
          error
        );
      }
    }
  }

  return {
    kind: 'cpu',
    materializer: new SequentialCpuMaterializer({ tileSize: 128 }),
  };
};

const buildLayerRenderSignature = ({
  layer,
  width,
  height,
}: {
  layer: Layer;
  width: number;
  height: number;
}): string => {
  const data = layer.sequentialData;
  return [
    Math.max(1, Math.round(width)),
    Math.max(1, Math.round(height)),
    Math.max(1, Math.round(data?.frameCount ?? 1)),
    Math.max(1, Math.round(data?.fps ?? 1)),
  ].join('|');
};

const normalizeFrameIndex = (frameIndex: number, frameCount: number): number => {
  const safeCount = Math.max(1, Math.round(frameCount));
  const normalized = Math.round(frameIndex) % safeCount;
  return normalized < 0 ? normalized + safeCount : normalized;
};

const resolveHoldLookbackFrames = ({
  fps,
  frameCount,
}: {
  fps: number;
  frameCount: number;
}): number => {
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  if (safeFrameCount <= 1) {
    return 0;
  }
  const safeFps = Math.max(1, Math.round(fps));
  const desiredLookback = safeFps <= 12 ? 2 : safeFps <= 24 ? 1 : 0;
  return Math.min(MAX_EMPTY_FRAME_HOLD_LOOKBACK, safeFrameCount - 1, desiredLookback);
};

const copyTileSetToCanvas = ({
  canvas,
  tileSet,
}: {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  tileSet: ReturnType<SequentialMaterializerBackend['materializeFrame']>;
}): boolean => {
  const ctx = canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return false;
  }
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  for (let i = 0; i < tileSet.tiles.length; i += 1) {
    const tile = tileSet.tiles[i];
    if (tile.width <= 0 || tile.height <= 0) {
      continue;
    }
    const imageData = new ImageData(
      tile.data,
      tile.width,
      tile.height
    );
    ctx.putImageData(imageData, tile.x, tile.y);
  }
  return true;
};

const mergeFrameTilePatch = ({
  baseTileSet,
  patch,
  width,
}: {
  baseTileSet: FrameTileSet;
  patch: FrameTilePatch;
  width: number;
}): FrameTileSet => {
  const tileSize = patch.tileSize;
  const tileCols = Math.max(1, Math.ceil(Math.max(1, width) / tileSize));
  const keyForTile = (x: number, y: number): number => {
    const tileX = Math.max(0, Math.floor(x / tileSize));
    const tileY = Math.max(0, Math.floor(y / tileSize));
    return tileY * tileCols + tileX;
  };
  const tilesByKey = new Map<number, FrameTileSet['tiles'][number]>();
  for (let i = 0; i < baseTileSet.tiles.length; i += 1) {
    const tile = baseTileSet.tiles[i];
    tilesByKey.set(keyForTile(tile.x, tile.y), tile);
  }
  if (patch.clearTileKeys?.length) {
    for (let i = 0; i < patch.clearTileKeys.length; i += 1) {
      tilesByKey.delete(patch.clearTileKeys[i]);
    }
  }
  for (let i = 0; i < patch.tiles.length; i += 1) {
    const tile = patch.tiles[i];
    tilesByKey.set(keyForTile(tile.x, tile.y), tile);
  }
  const mergedTiles = Array.from(tilesByKey.values()).sort((a, b) => (a.y - b.y) || (a.x - b.x));
  return {
    frameIndex: patch.frameIndex,
    tileSize,
    pixelFormat: baseTileSet.pixelFormat,
    premultipliedAlpha: baseTileSet.premultipliedAlpha,
    colorSpace: baseTileSet.colorSpace,
    tiles: mergedTiles,
  };
};

const deriveEventsRect = ({
  events,
  width,
  height,
}: {
  events: ReadonlyArray<SequentialStrokeEvent>;
  width: number;
  height: number;
}): { x: number; y: number; width: number; height: number } | null => {
  if (events.length === 0) {
    return null;
  }
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  let minX = safeWidth;
  let minY = safeHeight;
  let maxX = -1;
  let maxY = -1;

  for (let eventIndex = 0; eventIndex < events.length; eventIndex += 1) {
    const event = events[eventIndex];
    for (let stampIndex = 0; stampIndex < event.stamps.length; stampIndex += 1) {
      const stamp = event.stamps[stampIndex];
      const stampSize = Math.max(1, stamp.size || event.brush.size || 1);
      const inflate = Math.max(2, Math.ceil(stampSize * 0.8));
      const x0 = Math.max(0, Math.floor(stamp.x - inflate));
      const y0 = Math.max(0, Math.floor(stamp.y - inflate));
      const x1 = Math.min(safeWidth - 1, Math.ceil(stamp.x + inflate));
      const y1 = Math.min(safeHeight - 1, Math.ceil(stamp.y + inflate));
      minX = Math.min(minX, x0);
      minY = Math.min(minY, y0);
      maxX = Math.max(maxX, x1);
      maxY = Math.max(maxY, y1);
    }
  }

  if (maxX < minX || maxY < minY) {
    return null;
  }

  return {
    x: minX,
    y: minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  };
};

export const getSequentialLayerRenderCanvas = ({
  layer,
  width,
  height,
  frameIndex,
  previewEvents,
}: {
  layer: Layer;
  width: number;
  height: number;
  frameIndex: number;
  previewEvents?: ReadonlyArray<SequentialStrokeEvent>;
}): HTMLCanvasElement | OffscreenCanvas | null => {
  if (layer.layerType !== 'sequential' || !layer.sequentialData) {
    return null;
  }

  const runtime = getOrCreateRuntime(layer.id);
  const renderSignature = buildLayerRenderSignature({ layer, width, height });
  const allEvents = layer.sequentialData.events ?? [];
  const eventCount = allEvents.length;
  const previousTailEventId =
    runtime.eventCount > 0 && runtime.eventCount - 1 < allEvents.length
      ? allEvents[runtime.eventCount - 1]?.id ?? null
      : null;

  if (runtime.renderSignature !== renderSignature) {
    runtime.renderSignature = renderSignature;
    runtime.eventLog.replaceLayer(layer.id, allEvents);
    runtime.frameCache.clearLayer(layer.id);
    runtime.eventCount = eventCount;
    runtime.lastEventId = eventCount > 0 ? allEvents[eventCount - 1]?.id ?? null : null;
  } else if (
    eventCount < runtime.eventCount ||
    (runtime.eventCount > 0 && previousTailEventId !== runtime.lastEventId)
  ) {
    runtime.eventLog.replaceLayer(layer.id, allEvents);
    runtime.frameCache.clearLayer(layer.id);
    runtime.eventCount = eventCount;
    runtime.lastEventId = eventCount > 0 ? allEvents[eventCount - 1]?.id ?? null : null;
  } else if (eventCount > runtime.eventCount) {
    const previousEventCount = runtime.eventCount;
    runtime.eventLog.appendFromIndex(layer.id, allEvents, previousEventCount);

    const applyFramePatch = (
      appendedFrameIndex: number,
      frameEvents: Array<(typeof allEvents)[number]>
    ): { attempted: boolean; applied: boolean; fallback: boolean } => {
      const cachedTileSet = runtime.frameCache.peek(layer.id, appendedFrameIndex);
      if (!cachedTileSet) {
        runtime.frameCache.markDirty(layer.id, appendedFrameIndex);
        return { attempted: false, applied: false, fallback: false };
      }
      try {
        let patchedTileSet: FrameTileSet;
        let reasonForPatch: 'applied_run_patch' | 'collapsed_to_full_patch' | null = null;
        if (runtime.materializer.materializeRect) {
          const patchRect = deriveEventsRect({
            events: frameEvents,
            width,
            height,
          });
          if (patchRect) {
            const patch = runtime.materializer.materializeRect({
              width,
              height,
              frameIndex: appendedFrameIndex,
              events: frameEvents,
              eventsAreFrameScoped: true,
              rect: patchRect,
            });
            patchedTileSet = mergeFrameTilePatch({
              baseTileSet: cachedTileSet,
              patch,
              width,
            });
            reasonForPatch =
              (patch.clearTileKeys?.length ?? 0) > 0
                ? 'collapsed_to_full_patch'
                : 'applied_run_patch';
          } else {
            patchedTileSet = cachedTileSet;
          }
        } else if (runtime.materializer.patchFrame) {
          patchedTileSet = runtime.materializer.patchFrame({
            width,
            height,
            frameIndex: appendedFrameIndex,
            events: frameEvents,
            eventsAreFrameScoped: true,
            baseTileSet: cachedTileSet,
          });
          if (runtime.backendKind !== 'cpu') {
            reasonForPatch = 'applied_run_patch';
          }
        } else {
          runtime.frameCache.markDirty(layer.id, appendedFrameIndex);
          return { attempted: false, applied: false, fallback: false };
        }
        if (reasonForPatch) {
          recordSequentialPatchReason(reasonForPatch);
        }
        runtime.frameCache.set(layer.id, appendedFrameIndex, patchedTileSet);
        return { attempted: true, applied: true, fallback: false };
      } catch {
        recordSequentialPatchReason('fallback_exception');
        runtime.frameCache.markDirty(layer.id, appendedFrameIndex);
        return { attempted: true, applied: false, fallback: true };
      }
    };

    const appendedCount = eventCount - previousEventCount;
    let patchAttempts = 0;
    let patchApplied = 0;
    let patchFallbacks = 0;

    if (appendedCount === 1) {
      const appendedEvent = allEvents[previousEventCount];
      if (appendedEvent) {
        const outcome = applyFramePatch(appendedEvent.frameIndex, [appendedEvent]);
        patchAttempts += outcome.attempted ? 1 : 0;
        patchApplied += outcome.applied ? 1 : 0;
        patchFallbacks += outcome.fallback ? 1 : 0;
      }
    } else {
      const appendedEventsByFrame = new Map<number, Array<(typeof allEvents)[number]>>();
      for (let i = previousEventCount; i < allEvents.length; i += 1) {
        const event = allEvents[i];
        const current = appendedEventsByFrame.get(event.frameIndex);
        if (current) {
          current.push(event);
        } else {
          appendedEventsByFrame.set(event.frameIndex, [event]);
        }
      }
      appendedEventsByFrame.forEach((frameEvents, appendedFrameIndex) => {
        const outcome = applyFramePatch(appendedFrameIndex, frameEvents);
        patchAttempts += outcome.attempted ? 1 : 0;
        patchApplied += outcome.applied ? 1 : 0;
        patchFallbacks += outcome.fallback ? 1 : 0;
      });
    }
    if (patchAttempts > 0 || patchFallbacks > 0) {
      recordSequentialPatchOutcome({
        attempts: patchAttempts,
        applied: patchApplied,
        fallbacks: patchFallbacks,
      });
    }
    runtime.eventCount = eventCount;
    runtime.lastEventId = allEvents[eventCount - 1]?.id ?? null;
  }

  const normalizedFrameIndex = normalizeFrameIndex(
    frameIndex,
    layer.sequentialData.frameCount
  );

  let sourceFrameIndex = normalizedFrameIndex;
  let committedFrameEvents = runtime.eventLog.getLayerFrameEventsReadonly(
    layer.id,
    sourceFrameIndex
  );
  if (committedFrameEvents.length === 0) {
    const maxLookbackFrames = resolveHoldLookbackFrames({
      fps: layer.sequentialData.fps,
      frameCount: layer.sequentialData.frameCount,
    });
    for (let offset = 1; offset <= maxLookbackFrames; offset += 1) {
      const candidateFrameIndex = normalizeFrameIndex(
        normalizedFrameIndex - offset,
        layer.sequentialData.frameCount
      );
      const candidateEvents = runtime.eventLog.getLayerFrameEventsReadonly(
        layer.id,
        candidateFrameIndex
      );
      if (candidateEvents.length > 0) {
        sourceFrameIndex = candidateFrameIndex;
        committedFrameEvents = candidateEvents;
        break;
      }
    }
  }

  const shouldUseFallbackFrame = sourceFrameIndex !== normalizedFrameIndex;
  let tileSet = shouldUseFallbackFrame
    ? runtime.frameCache.get(layer.id, sourceFrameIndex)
    : runtime.frameCache.get(layer.id, normalizedFrameIndex);
  if (!tileSet) {
    tileSet = runtime.materializer.materializeFrame({
      width,
      height,
      frameIndex: sourceFrameIndex,
      events: committedFrameEvents,
      eventsAreFrameScoped: true,
    });
    runtime.frameCache.set(layer.id, sourceFrameIndex, tileSet);
  }
  let renderTileSet = tileSet;
  const framePreviewEvents = previewEvents ?? [];
  if (framePreviewEvents.length > 0) {
    if (runtime.materializer.materializeRect) {
      try {
        const previewRect = deriveEventsRect({
          events: framePreviewEvents,
          width,
          height,
        });
        if (previewRect) {
          const previewPatch = runtime.materializer.materializeRect({
            width,
            height,
            frameIndex: normalizedFrameIndex,
            events: [...committedFrameEvents, ...framePreviewEvents],
            eventsAreFrameScoped: true,
            rect: previewRect,
          });
          renderTileSet = mergeFrameTilePatch({
            baseTileSet: tileSet,
            patch: previewPatch,
            width,
          });
          recordSequentialPatchReason(
            (previewPatch.clearTileKeys?.length ?? 0) > 0
              ? 'collapsed_to_full_patch'
              : 'applied_run_patch'
          );
        }
      } catch {
        recordSequentialPatchReason('fallback_exception');
        renderTileSet = runtime.materializer.materializeFrame({
          width,
          height,
          frameIndex: normalizedFrameIndex,
          events: [...committedFrameEvents, ...framePreviewEvents],
          eventsAreFrameScoped: true,
        });
      }
    } else if (runtime.materializer.patchFrame) {
      try {
        renderTileSet = runtime.materializer.patchFrame({
          width,
          height,
          frameIndex: normalizedFrameIndex,
          events: framePreviewEvents,
          eventsAreFrameScoped: true,
          baseTileSet: tileSet,
        });
        if (runtime.backendKind !== 'cpu') {
          recordSequentialPatchReason('applied_run_patch');
        }
      } catch {
        recordSequentialPatchReason('fallback_exception');
        renderTileSet = runtime.materializer.materializeFrame({
          width,
          height,
          frameIndex: normalizedFrameIndex,
          events: [...committedFrameEvents, ...framePreviewEvents],
          eventsAreFrameScoped: true,
        });
      }
    } else {
      renderTileSet = runtime.materializer.materializeFrame({
        width,
        height,
        frameIndex: normalizedFrameIndex,
        events: [...committedFrameEvents, ...framePreviewEvents],
        eventsAreFrameScoped: true,
      });
    }
  }

  const canvas = ensureCanvas(runtime, width, height);
  if (!canvas) {
    return null;
  }

  if (!copyTileSetToCanvas({ canvas, tileSet: renderTileSet })) {
    return null;
  }

  return canvas;
};

export const getSequentialLayerRendererStats = (): SequentialFrameCacheStats => {
  let entries = 0;
  let hits = 0;
  let misses = 0;
  let dirtyFrames = 0;

  layerRuntimes.forEach((runtime) => {
    const stats = runtime.frameCache.getStats();
    entries += stats.entries;
    hits += stats.hits;
    misses += stats.misses;
    dirtyFrames += stats.dirtyFrames;
  });

  return {
    entries,
    hits,
    misses,
    dirtyFrames,
  };
};

export const clearSequentialLayerRendererLayer = (layerId: string): void => {
  const runtime = layerRuntimes.get(layerId);
  if (!runtime) {
    return;
  }
  runtime.frameCache.clearLayer(layerId);
  runtime.eventLog.clearLayer(layerId);
  runtime.renderSignature = '';
  runtime.eventCount = 0;
  runtime.lastEventId = null;
};

export const clearSequentialLayerRendererAll = (): void => {
  layerRuntimes.forEach((runtime) => {
    runtime.materializer.dispose?.();
  });
  layerRuntimes.clear();
  sequentialGpuUnavailable = false;
  sequentialGpuFallbackLogged = false;
};
