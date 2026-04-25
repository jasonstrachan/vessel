import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import type { FrameTileSet } from '@/lib/sequential/types';
import type { SequentialStrokeEvent } from '@/types';

interface LivePreviewRuntime {
  layerId: string;
  sessionKey: string;
  width: number;
  height: number;
  materializer: SequentialCpuMaterializer;
  frames: Map<number, LivePreviewFrame>;
}

interface LivePreviewFrame {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  tileSet: FrameTileSet;
  bounds: Rect | null;
}

const TILE_SIZE = 128;
const LIVE_PREVIEW_FRAME_INDEX = 0;
const livePreviewRuntimes = new Map<string, LivePreviewRuntime>();

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SequentialLivePreviewFrame {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  bounds: Rect;
}

const createCanvas = (
  width: number,
  height: number
): HTMLCanvasElement | OffscreenCanvas | null => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
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

const createEmptyTileSet = (): FrameTileSet => ({
  frameIndex: LIVE_PREVIEW_FRAME_INDEX,
  tileSize: TILE_SIZE,
  pixelFormat: 'rgba8',
  premultipliedAlpha: true,
  colorSpace: 'srgb',
  tiles: [],
});

const clearCanvas = (canvas: HTMLCanvasElement | OffscreenCanvas): void => {
  const ctx = canvas.getContext('2d') as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  ctx?.clearRect(0, 0, canvas.width, canvas.height);
};

const tileKey = (tile: FrameTileSet['tiles'][number]): string => `${tile.x}:${tile.y}`;

const copyChangedTilesToCanvas = ({
  canvas,
  previousTileSet,
  nextTileSet,
}: {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  previousTileSet: FrameTileSet;
  nextTileSet: FrameTileSet;
}): boolean => {
  const ctx = canvas.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) {
    return false;
  }

  const previousTilesByKey = new Map<string, FrameTileSet['tiles'][number]>();
  for (let i = 0; i < previousTileSet.tiles.length; i += 1) {
    const tile = previousTileSet.tiles[i];
    previousTilesByKey.set(tileKey(tile), tile);
  }

  for (let i = 0; i < nextTileSet.tiles.length; i += 1) {
    const tile = nextTileSet.tiles[i];
    if (tile.width <= 0 || tile.height <= 0) {
      continue;
    }
    if (previousTilesByKey.get(tileKey(tile)) === tile) {
      continue;
    }
    const imageData = new ImageData(tile.data, tile.width, tile.height);
    ctx.putImageData(imageData, tile.x, tile.y);
  }

  return true;
};

const getOrCreateRuntime = ({
  layerId,
  sessionKey,
  width,
  height,
}: {
  layerId: string;
  sessionKey: string;
  width: number;
  height: number;
}): LivePreviewRuntime | null => {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const existing = livePreviewRuntimes.get(layerId);
  if (
    existing &&
    existing.sessionKey === sessionKey &&
    existing.width === safeWidth &&
    existing.height === safeHeight
  ) {
    return existing;
  }

  const runtime: LivePreviewRuntime = {
    layerId,
    sessionKey,
    width: safeWidth,
    height: safeHeight,
    materializer: new SequentialCpuMaterializer({ tileSize: TILE_SIZE }),
    frames: new Map(),
  };
  livePreviewRuntimes.set(layerId, runtime);
  return runtime;
};

const normalizeFrameIndex = (frameIndex: number, frameCount: number): number => {
  const safeFrameCount = Math.max(1, Math.round(frameCount));
  const normalized = Math.round(frameIndex) % safeFrameCount;
  return normalized < 0 ? normalized + safeFrameCount : normalized;
};

const getOrCreateFrame = (
  runtime: LivePreviewRuntime,
  frameIndex: number
): LivePreviewFrame | null => {
  const existing = runtime.frames.get(frameIndex);
  if (existing) {
    return existing;
  }
  const canvas = createCanvas(runtime.width, runtime.height);
  if (!canvas) {
    return null;
  }
  clearCanvas(canvas);
  const frame: LivePreviewFrame = {
    canvas,
    tileSet: createEmptyTileSet(),
    bounds: null,
  };
  runtime.frames.set(frameIndex, frame);
  return frame;
};

const deriveEventsRect = ({
  events,
  width,
  height,
}: {
  events: ReadonlyArray<SequentialStrokeEvent>;
  width: number;
  height: number;
}): Rect | null => {
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
      minX = Math.min(minX, Math.max(0, Math.floor(stamp.x - inflate)));
      minY = Math.min(minY, Math.max(0, Math.floor(stamp.y - inflate)));
      maxX = Math.max(maxX, Math.min(safeWidth - 1, Math.ceil(stamp.x + inflate)));
      maxY = Math.max(maxY, Math.min(safeHeight - 1, Math.ceil(stamp.y + inflate)));
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

const mergeBounds = (current: Rect | null, next: Rect | null): Rect | null => {
  if (!next) {
    return current;
  }
  if (!current) {
    return next;
  }
  const minX = Math.min(current.x, next.x);
  const minY = Math.min(current.y, next.y);
  const maxX = Math.max(current.x + current.width, next.x + next.width);
  const maxY = Math.max(current.y + current.height, next.y + next.height);
  return {
    x: minX,
    y: minY,
    width: maxX - minX,
    height: maxY - minY,
  };
};

export const appendSequentialLivePreviewEvents = ({
  layerId,
  sessionKey,
  width,
  height,
  frameCount,
  events,
}: {
  layerId: string;
  sessionKey: string;
  width: number;
  height: number;
  frameCount: number;
  events: ReadonlyArray<SequentialStrokeEvent>;
}): void => {
  if (!layerId || !sessionKey || events.length === 0) {
    return;
  }
  const runtime = getOrCreateRuntime({ layerId, sessionKey, width, height });
  if (!runtime) {
    return;
  }

  const eventsByFrame = new Map<number, SequentialStrokeEvent[]>();
  for (let i = 0; i < events.length; i += 1) {
    const event = events[i];
    const previewFrameIndex = normalizeFrameIndex(event.frameIndex, frameCount);
    const existing = eventsByFrame.get(previewFrameIndex);
    if (existing) {
      existing.push(event);
    } else {
      eventsByFrame.set(previewFrameIndex, [event]);
    }
  }

  eventsByFrame.forEach((frameEvents, previewFrameIndex) => {
    const frame = getOrCreateFrame(runtime, previewFrameIndex);
    if (!frame) {
      return;
    }
    const frameEventsRect = deriveEventsRect({
      events: frameEvents,
      width: runtime.width,
      height: runtime.height,
    });
    const previousTileSet = frame.tileSet;
    const nextTileSet = runtime.materializer.patchFrame({
      width: runtime.width,
      height: runtime.height,
      frameIndex: LIVE_PREVIEW_FRAME_INDEX,
      events: frameEvents,
      eventsAreFrameScoped: true,
      baseTileSet: previousTileSet,
    });
    if (
      copyChangedTilesToCanvas({
        canvas: frame.canvas,
        previousTileSet,
        nextTileSet,
      })
    ) {
      frame.tileSet = nextTileSet;
      frame.bounds = mergeBounds(frame.bounds, frameEventsRect);
    }
  });
};

export const getSequentialLivePreviewFrame = ({
  layerId,
  sessionKey,
  width,
  height,
  frameIndex,
  frameCount,
}: {
  layerId: string;
  sessionKey: string | null | undefined;
  width: number;
  height: number;
  frameIndex: number;
  frameCount: number;
}): SequentialLivePreviewFrame | null => {
  if (!layerId || !sessionKey) {
    return null;
  }
  const runtime = livePreviewRuntimes.get(layerId);
  if (!runtime) {
    return null;
  }
  if (
    runtime.sessionKey !== sessionKey ||
    runtime.width !== Math.max(1, Math.round(width)) ||
    runtime.height !== Math.max(1, Math.round(height))
  ) {
    return null;
  }
  const frame = runtime.frames.get(normalizeFrameIndex(frameIndex, frameCount));
  if (!frame?.bounds) {
    return null;
  }
  return {
    canvas: frame.canvas,
    bounds: frame.bounds,
  };
};

export const getSequentialLivePreviewCanvas = (
  options: Parameters<typeof getSequentialLivePreviewFrame>[0]
): HTMLCanvasElement | OffscreenCanvas | null =>
  getSequentialLivePreviewFrame(options)?.canvas ?? null;

export const clearSequentialLivePreview = (layerId?: string): void => {
  if (layerId) {
    livePreviewRuntimes.delete(layerId);
    return;
  }
  livePreviewRuntimes.clear();
};

export const __TESTING__ = {
  clearSequentialLivePreview,
  runtimeCount: () => livePreviewRuntimes.size,
};
