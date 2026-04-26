import { debugWarn } from '@/utils/debug';
import type { Layer, SequentialStrokeEvent } from '@/types';
import { isFeatureFlagEnabled } from '@/config/featureFlags';
import { SequentialEventLog } from '@/lib/sequential/SequentialEventLog';
import { SequentialFrameCache } from '@/lib/sequential/SequentialFrameCache';
import {
  recordSequentialPatchOutcome,
  recordSequentialPatchReason,
  recordSequentialPresentationCopyPerf,
} from '@/lib/sequential/SequentialPerfCounters';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import { SequentialGpuMaterializer } from '@/lib/sequential/materializer/SequentialGpuMaterializer';
import type {
  SequentialMaterializerBackend,
  SequentialMaterializerBackendKind,
} from '@/lib/sequential/materializer/SequentialMaterializerBackend';
import type { FrameTilePatch, FrameTileSet, SequentialFrameCacheStats } from '@/lib/sequential/types';
import {
  buildSequentialWorkerMaterializeKey,
  buildSequentialWorkerEventsSignature,
  clearSequentialWorkerMaterializerBridge,
  consumeSequentialWorkerMaterializedFrame,
  disposeSequentialWorkerMaterializerBridge,
  requestSequentialWorkerMaterializedFrame,
} from '@/lib/sequential/SequentialWorkerMaterializerBridge';

export interface SequentialLayerRendererDiagnostics {
  renderCalls: number;
  presentationHits: number;
  frameCacheMisses: number;
  materializeMisses: number;
  workerHits: number;
  workerWarmRequests: number;
  signatureResets: number;
  eventTailResets: number;
  appendBatches: number;
  dirtyPatchMisses: number;
  deferredAppendPatches: number;
  lastLayerId: string | null;
  lastFrameIndex: number | null;
  lastSourceFrameIndex: number | null;
  lastMaterializeEvents: number;
  lastResetReason: 'signature' | 'event-tail' | null;
  lastRenderSignature: string | null;
}

interface LayerRuntime {
  layerId: string;
  eventLog: SequentialEventLog;
  frameCache: SequentialFrameCache;
  presentationCache: Map<number, PresentationCacheEntry>;
  stalePresentationFrames: Set<number>;
  materializer: SequentialMaterializerBackend;
  backendKind: SequentialMaterializerBackendKind;
  renderSignature: string;
  eventCount: number;
  lastEventId: string | null;
  deferredAppendFrames: Set<number>;
  targetCanvas: HTMLCanvasElement | OffscreenCanvas | null;
  presentationAccessTick: number;
}

interface PresentationCacheEntry {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  tileSet: FrameTileSet;
  lastAccessTick: number;
}

const layerRuntimes = new Map<string, LayerRuntime>();
let sequentialGpuUnavailable = false;
let sequentialGpuFallbackLogged = false;
const MAX_EMPTY_FRAME_HOLD_LOOKBACK = 2;
const MAX_PRESENTATION_CACHE_ENTRIES = 48;
const MAX_PRESENTATION_CACHE_BYTES = 64 * 1024 * 1024;
const rendererDiagnostics: SequentialLayerRendererDiagnostics = {
  renderCalls: 0,
  presentationHits: 0,
  frameCacheMisses: 0,
  materializeMisses: 0,
  workerHits: 0,
  workerWarmRequests: 0,
  signatureResets: 0,
  eventTailResets: 0,
  appendBatches: 0,
  dirtyPatchMisses: 0,
  deferredAppendPatches: 0,
  lastLayerId: null,
  lastFrameIndex: null,
  lastSourceFrameIndex: null,
  lastMaterializeEvents: 0,
  lastResetReason: null,
  lastRenderSignature: null,
};

const publishRendererDiagnostics = (): void => {
  if (process.env.NODE_ENV === 'production') {
    return;
  }
  const target = globalThis as typeof globalThis & {
    __vesselSequentialRendererDiagnostics?: SequentialLayerRendererDiagnostics;
    __vesselSequentialRendererResetDiagnostics?: () => void;
  };
  target.__vesselSequentialRendererDiagnostics = { ...rendererDiagnostics };
  target.__vesselSequentialRendererResetDiagnostics = resetSequentialLayerRendererDiagnostics;
};

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

const ensurePresentationCanvas = (
  existing: HTMLCanvasElement | OffscreenCanvas | null,
  width: number,
  height: number
): HTMLCanvasElement | OffscreenCanvas | null => {
  const canvas = existing ?? createCanvas(width, height);
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

const clearPresentationCache = (runtime: LayerRuntime): void => {
  runtime.presentationCache.clear();
  runtime.stalePresentationFrames.clear();
  runtime.presentationAccessTick = 0;
};

const invalidatePresentationFrame = (
  runtime: LayerRuntime,
  frameIndex: number
): void => {
  runtime.stalePresentationFrames.add(frameIndex);
};

const promoteDeferredAppendFrames = (
  runtime: LayerRuntime,
  layerId: string
): void => {
  if (runtime.deferredAppendFrames.size === 0) {
    return;
  }
  runtime.deferredAppendFrames.forEach((frameIndex) => {
    runtime.frameCache.markDirty(layerId, frameIndex);
    invalidatePresentationFrame(runtime, frameIndex);
  });
  runtime.deferredAppendFrames.clear();
};

const getPresentationCacheCanvas = (
  runtime: LayerRuntime,
  frameIndex: number
): HTMLCanvasElement | OffscreenCanvas | null => {
  const entry = runtime.presentationCache.get(frameIndex);
  if (!entry) {
    return null;
  }
  if (runtime.stalePresentationFrames.has(frameIndex)) {
    return null;
  }
  runtime.presentationAccessTick += 1;
  entry.lastAccessTick = runtime.presentationAccessTick;
  return entry.canvas;
};

const setPresentationCacheCanvas = ({
  runtime,
  frameIndex,
  tileSet,
  width,
  height,
}: {
  runtime: LayerRuntime;
  frameIndex: number;
  tileSet: FrameTileSet;
  width: number;
  height: number;
}): HTMLCanvasElement | OffscreenCanvas | null => {
  const existing = runtime.presentationCache.get(frameIndex)?.canvas ?? null;
  const previousTileSet = runtime.presentationCache.get(frameIndex)?.tileSet ?? null;
  const canvas = ensurePresentationCanvas(existing, width, height);
  if (!canvas) {
    return null;
  }
  if (!copyTileSetToCanvas({ canvas, tileSet, previousTileSet })) {
    return null;
  }
  runtime.presentationAccessTick += 1;
  runtime.presentationCache.set(frameIndex, {
    canvas,
    tileSet,
    lastAccessTick: runtime.presentationAccessTick,
  });
  runtime.stalePresentationFrames.delete(frameIndex);

  const approximateBytesPerCanvas = Math.max(1, Math.round(width)) * Math.max(1, Math.round(height)) * 4;
  const maxEntriesForCanvasSize = Math.max(
    1,
    Math.min(
      MAX_PRESENTATION_CACHE_ENTRIES,
      Math.floor(MAX_PRESENTATION_CACHE_BYTES / approximateBytesPerCanvas)
    )
  );

  if (runtime.presentationCache.size > maxEntriesForCanvasSize) {
    const candidates = Array.from(runtime.presentationCache.entries()).sort(
      (a, b) => a[1].lastAccessTick - b[1].lastAccessTick
    );
    const overflowCount = runtime.presentationCache.size - maxEntriesForCanvasSize;
    for (let i = 0; i < overflowCount; i += 1) {
      runtime.presentationCache.delete(candidates[i][0]);
    }
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
      clearPresentationCache(existing);
      existing.renderSignature = '';
      existing.eventCount = 0;
      existing.lastEventId = null;
      existing.deferredAppendFrames.clear();
    }
    return existing;
  }
  const initialBackend = createSequentialMaterializer(desiredBackend);
  const runtime: LayerRuntime = {
    layerId,
    eventLog: new SequentialEventLog(),
    frameCache: new SequentialFrameCache({ maxEntries: 128 }),
    presentationCache: new Map(),
    stalePresentationFrames: new Set(),
    materializer: initialBackend.materializer,
    backendKind: initialBackend.kind,
    renderSignature: '',
    eventCount: 0,
    lastEventId: null,
    deferredAppendFrames: new Set<number>(),
    targetCanvas: null,
    presentationAccessTick: 0,
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
        debugWarn('raw-console',
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

const requestWorkerWarmFrame = ({
  layer,
  renderSignature,
  width,
  height,
  frameIndex,
  events,
}: {
  layer: Layer;
  renderSignature: string;
  width: number;
  height: number;
  frameIndex: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}): void => {
  if (!isFeatureFlagEnabled('enableSequentialWorkerMaterialization')) {
    return;
  }
  rendererDiagnostics.workerWarmRequests += 1;
  publishRendererDiagnostics();
  requestSequentialWorkerMaterializedFrame({
    key: buildSequentialWorkerMaterializeKey({
      layerId: layer.id,
      renderSignature,
      frameIndex,
      eventSignature: buildSequentialWorkerEventsSignature(events),
    }),
    width,
    height,
    frameIndex,
    events,
  });
};

const copyTileSetToCanvas = ({
  canvas,
  tileSet,
  previousTileSet,
}: {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  tileSet: ReturnType<SequentialMaterializerBackend['materializeFrame']>;
  previousTileSet?: FrameTileSet | null;
}): boolean => {
  const copyStartMs =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();
  const ctx = canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return false;
  }

  const previousTilesByKey = new Map<number, FrameTileSet['tiles'][number]>();
  const tileSize = tileSet.tileSize;
  const tileCols = Math.max(1, Math.ceil(Math.max(1, canvas.width) / tileSize));
  const keyForTile = (tile: FrameTileSet['tiles'][number]): number => {
    const tileX = Math.max(0, Math.floor(tile.x / tileSize));
    const tileY = Math.max(0, Math.floor(tile.y / tileSize));
    return tileY * tileCols + tileX;
  };
  if (previousTileSet) {
    for (let i = 0; i < previousTileSet.tiles.length; i += 1) {
      const tile = previousTileSet.tiles[i];
      previousTilesByKey.set(keyForTile(tile), tile);
    }
  } else {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  }

  let copiedTiles = 0;

  for (let i = 0; i < tileSet.tiles.length; i += 1) {
    const tile = tileSet.tiles[i];
    if (tile.width <= 0 || tile.height <= 0) {
      continue;
    }
    const tileKey = keyForTile(tile);
    if (previousTilesByKey.get(tileKey) === tile) {
      previousTilesByKey.delete(tileKey);
      continue;
    }
    const imageData = new ImageData(
      tile.data,
      tile.width,
      tile.height
    );
    ctx.putImageData(imageData, tile.x, tile.y);
    previousTilesByKey.delete(tileKey);
    copiedTiles += 1;
  }

  previousTilesByKey.forEach((tile) => {
    ctx.clearRect(tile.x, tile.y, tile.width, tile.height);
    copiedTiles += 1;
  });

  const copyDurationMs =
    (typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now()) - copyStartMs;
  recordSequentialPresentationCopyPerf({
    tiles: copiedTiles,
    durationMs: copyDurationMs,
  });

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
  holdPreviousOnEmptyFrames = true,
  deferAppendPatching = false,
}: {
  layer: Layer;
  width: number;
  height: number;
  frameIndex: number;
  previewEvents?: ReadonlyArray<SequentialStrokeEvent>;
  holdPreviousOnEmptyFrames?: boolean;
  deferAppendPatching?: boolean;
}): HTMLCanvasElement | OffscreenCanvas | null => {
  if (layer.layerType !== 'sequential' || !layer.sequentialData) {
    return null;
  }

  rendererDiagnostics.renderCalls += 1;
  rendererDiagnostics.lastLayerId = layer.id;
  rendererDiagnostics.lastFrameIndex = frameIndex;
  const runtime = getOrCreateRuntime(layer.id);
  const renderSignature = buildLayerRenderSignature({ layer, width, height });
  rendererDiagnostics.lastRenderSignature = renderSignature;
  const allEvents = layer.sequentialData.events ?? [];
  const eventCount = allEvents.length;
  const previousTailEventId =
    runtime.eventCount > 0 && runtime.eventCount - 1 < allEvents.length
      ? allEvents[runtime.eventCount - 1]?.id ?? null
      : null;

  if (runtime.renderSignature !== renderSignature) {
    rendererDiagnostics.signatureResets += 1;
    rendererDiagnostics.lastResetReason = 'signature';
    runtime.renderSignature = renderSignature;
    runtime.eventLog.replaceLayer(layer.id, allEvents);
    runtime.frameCache.clearLayer(layer.id);
    clearPresentationCache(runtime);
    runtime.eventCount = eventCount;
    runtime.lastEventId = eventCount > 0 ? allEvents[eventCount - 1]?.id ?? null : null;
    runtime.deferredAppendFrames.clear();
  } else if (
    eventCount < runtime.eventCount ||
    (runtime.eventCount > 0 && previousTailEventId !== runtime.lastEventId)
  ) {
    rendererDiagnostics.eventTailResets += 1;
    rendererDiagnostics.lastResetReason = 'event-tail';
    runtime.eventLog.replaceLayer(layer.id, allEvents);
    runtime.frameCache.clearLayer(layer.id);
    clearPresentationCache(runtime);
    runtime.eventCount = eventCount;
    runtime.lastEventId = eventCount > 0 ? allEvents[eventCount - 1]?.id ?? null : null;
    runtime.deferredAppendFrames.clear();
  } else if (eventCount > runtime.eventCount) {
    rendererDiagnostics.appendBatches += 1;
    const previousEventCount = runtime.eventCount;
    runtime.eventLog.appendFromIndex(layer.id, allEvents, previousEventCount);

    const applyFramePatch = (
      appendedFrameIndex: number,
      frameEvents: Array<(typeof allEvents)[number]>
    ): { attempted: boolean; applied: boolean; fallback: boolean } => {
      const cachedTileSet = runtime.frameCache.peek(layer.id, appendedFrameIndex);
      if (!cachedTileSet) {
        rendererDiagnostics.dirtyPatchMisses += 1;
        runtime.frameCache.markDirty(layer.id, appendedFrameIndex);
        invalidatePresentationFrame(runtime, appendedFrameIndex);
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
          invalidatePresentationFrame(runtime, appendedFrameIndex);
          return { attempted: false, applied: false, fallback: false };
        }
        if (reasonForPatch) {
          recordSequentialPatchReason(reasonForPatch);
        }
        runtime.frameCache.set(layer.id, appendedFrameIndex, patchedTileSet);
        invalidatePresentationFrame(runtime, appendedFrameIndex);
        return { attempted: true, applied: true, fallback: false };
      } catch {
        recordSequentialPatchReason('fallback_exception');
        runtime.frameCache.markDirty(layer.id, appendedFrameIndex);
        invalidatePresentationFrame(runtime, appendedFrameIndex);
        return { attempted: true, applied: false, fallback: true };
      }
    };

    const appendedCount = eventCount - previousEventCount;
    let patchAttempts = 0;
    let patchApplied = 0;
    let patchFallbacks = 0;

    if (deferAppendPatching) {
      const appendedFrames = new Set<number>();
      for (let i = previousEventCount; i < allEvents.length; i += 1) {
        appendedFrames.add(allEvents[i].frameIndex);
      }
      appendedFrames.forEach((appendedFrameIndex) => {
        runtime.deferredAppendFrames.add(appendedFrameIndex);
      });
      rendererDiagnostics.deferredAppendPatches += appendedFrames.size;
    } else if (appendedCount === 1) {
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
  if (!deferAppendPatching) {
    promoteDeferredAppendFrames(runtime, layer.id);
  }

  const normalizedFrameIndex = normalizeFrameIndex(
    frameIndex,
    layer.sequentialData.frameCount
  );
  const framePreviewEvents = previewEvents ?? [];
  const shouldHoldEmptyFrame =
    holdPreviousOnEmptyFrames && framePreviewEvents.length === 0;

  let sourceFrameIndex = normalizedFrameIndex;
  let committedFrameEvents = runtime.eventLog.getLayerFrameEventsReadonly(
    layer.id,
    sourceFrameIndex
  );
  if (shouldHoldEmptyFrame && committedFrameEvents.length === 0) {
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
  rendererDiagnostics.lastSourceFrameIndex = sourceFrameIndex;
  if (framePreviewEvents.length === 0) {
    const presentationCanvas = getPresentationCacheCanvas(runtime, sourceFrameIndex);
    if (presentationCanvas) {
      rendererDiagnostics.presentationHits += 1;
      publishRendererDiagnostics();
      void runtime.frameCache.get(layer.id, sourceFrameIndex);
      return presentationCanvas;
    }
  }

  let tileSet = shouldUseFallbackFrame
    ? runtime.frameCache.get(layer.id, sourceFrameIndex)
    : runtime.frameCache.get(layer.id, normalizedFrameIndex);
  if (!tileSet) {
    rendererDiagnostics.frameCacheMisses += 1;
    const workerKey = buildSequentialWorkerMaterializeKey({
      layerId: layer.id,
      renderSignature,
      frameIndex: sourceFrameIndex,
      eventSignature: buildSequentialWorkerEventsSignature(committedFrameEvents),
    });
    tileSet = isFeatureFlagEnabled('enableSequentialWorkerMaterialization')
      ? consumeSequentialWorkerMaterializedFrame(workerKey)
      : null;
    if (tileSet) {
      rendererDiagnostics.workerHits += 1;
    }
    if (!tileSet) {
      rendererDiagnostics.materializeMisses += 1;
      rendererDiagnostics.lastMaterializeEvents = committedFrameEvents.length;
      tileSet = runtime.materializer.materializeFrame({
        width,
        height,
        frameIndex: sourceFrameIndex,
        events: committedFrameEvents,
        eventsAreFrameScoped: true,
      });
    }
    runtime.frameCache.set(layer.id, sourceFrameIndex, tileSet);
  }
  const nextFrameIndex = normalizeFrameIndex(
    normalizedFrameIndex + 1,
    layer.sequentialData.frameCount
  );
  if (!runtime.frameCache.peek(layer.id, nextFrameIndex)) {
    requestWorkerWarmFrame({
      layer,
      renderSignature,
      width,
      height,
      frameIndex: nextFrameIndex,
      events: runtime.eventLog.getLayerFrameEventsReadonly(layer.id, nextFrameIndex),
    });
  }
  let renderTileSet = tileSet;
  if (framePreviewEvents.length > 0) {
    if (runtime.materializer.patchFrame) {
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
        if (runtime.materializer.materializeRect) {
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
    } else if (runtime.materializer.materializeRect) {
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

  if (framePreviewEvents.length === 0) {
    return setPresentationCacheCanvas({
      runtime,
      frameIndex: sourceFrameIndex,
      tileSet: renderTileSet,
      width,
      height,
    });
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

export const getSequentialLayerRendererDiagnostics = (): SequentialLayerRendererDiagnostics => ({
  ...rendererDiagnostics,
});

export const resetSequentialLayerRendererDiagnostics = (): void => {
  rendererDiagnostics.renderCalls = 0;
  rendererDiagnostics.presentationHits = 0;
  rendererDiagnostics.frameCacheMisses = 0;
  rendererDiagnostics.materializeMisses = 0;
  rendererDiagnostics.workerHits = 0;
  rendererDiagnostics.workerWarmRequests = 0;
  rendererDiagnostics.signatureResets = 0;
  rendererDiagnostics.eventTailResets = 0;
  rendererDiagnostics.appendBatches = 0;
  rendererDiagnostics.dirtyPatchMisses = 0;
  rendererDiagnostics.deferredAppendPatches = 0;
  rendererDiagnostics.lastLayerId = null;
  rendererDiagnostics.lastFrameIndex = null;
  rendererDiagnostics.lastSourceFrameIndex = null;
  rendererDiagnostics.lastMaterializeEvents = 0;
  rendererDiagnostics.lastResetReason = null;
  rendererDiagnostics.lastRenderSignature = null;
  publishRendererDiagnostics();
};

export const clearSequentialLayerRendererLayer = (layerId: string): void => {
  const runtime = layerRuntimes.get(layerId);
  if (!runtime) {
    return;
  }
  runtime.frameCache.clearLayer(layerId);
  clearPresentationCache(runtime);
  runtime.eventLog.clearLayer(layerId);
  runtime.renderSignature = '';
  runtime.eventCount = 0;
  runtime.lastEventId = null;
  runtime.deferredAppendFrames.clear();
  clearSequentialWorkerMaterializerBridge();
};

export const clearSequentialLayerRendererAll = (): void => {
  layerRuntimes.forEach((runtime) => {
    runtime.materializer.dispose?.();
  });
  layerRuntimes.clear();
  disposeSequentialWorkerMaterializerBridge();
  sequentialGpuUnavailable = false;
  sequentialGpuFallbackLogged = false;
  resetSequentialLayerRendererDiagnostics();
};
