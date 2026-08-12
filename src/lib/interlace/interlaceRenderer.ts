import {
  resolveInterlaceFrame,
  resolveInterlaceMaskRectangles,
  resolveInterlaceTileMetrics,
  resolveSierraTravelFrame,
} from '@/lib/colorCycle/gobletPlaybackMath';
import { sanitizeInterlaceSettings } from '@/lib/interlace/interlaceSettings';
import type { InterlaceGroupSettings } from '@/types';

export interface InterlaceRenderSource {
  source: CanvasImageSource;
  opacity: number;
  blendMode: GlobalCompositeOperation;
}

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface InterlaceScratch {
  mask: HTMLCanvasElement;
  maskContext: CanvasRenderingContext2D;
  tile: HTMLCanvasElement;
  tileContext: CanvasRenderingContext2D;
  layer: HTMLCanvasElement;
  layerContext: CanvasRenderingContext2D;
  tileKey: string | null;
}

const scratchByKey = new Map<string, InterlaceScratch>();

const getScratch = (width: number, height: number): InterlaceScratch | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  const key = `${width}x${height}`;
  const cached = scratchByKey.get(key);
  if (cached) {
    return cached;
  }
  const mask = document.createElement('canvas');
  mask.width = width;
  mask.height = height;
  const maskContext = mask.getContext('2d');
  const tile = document.createElement('canvas');
  tile.width = 1;
  tile.height = 1;
  const tileContext = tile.getContext('2d');
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const layerContext = layer.getContext('2d');
  if (!maskContext || !tileContext || !layerContext) {
    return null;
  }
  const scratch = {
    mask,
    maskContext,
    tile,
    tileContext,
    layer,
    layerContext,
    tileKey: null,
  };
  scratchByKey.set(key, scratch);
  if (scratchByKey.size > 8) {
    const oldest = scratchByKey.keys().next().value;
    if (oldest) scratchByKey.delete(oldest);
  }
  return scratch;
};

const drawMaskedSource = ({
  targetContext,
  source,
  scratch,
  width,
  height,
  keepHighBits,
  sourceRect,
  destinationRect,
}: {
  targetContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  source: InterlaceRenderSource;
  scratch: InterlaceScratch;
  width: number;
  height: number;
  keepHighBits: boolean;
  sourceRect: Rect;
  destinationRect: Rect;
}) => {
  const { layerContext } = scratch;
  layerContext.setTransform(1, 0, 0, 1, 0, 0);
  layerContext.globalAlpha = 1;
  layerContext.globalCompositeOperation = 'source-over';
  layerContext.clearRect(0, 0, width, height);
  layerContext.drawImage(source.source, 0, 0);
  layerContext.globalCompositeOperation = keepHighBits ? 'destination-in' : 'destination-out';
  layerContext.drawImage(scratch.mask, 0, 0);
  layerContext.globalCompositeOperation = 'source-over';

  targetContext.save();
  targetContext.globalAlpha = Math.max(0, Math.min(1, source.opacity));
  targetContext.globalCompositeOperation = source.blendMode;
  targetContext.drawImage(
    scratch.layer,
    sourceRect.x,
    sourceRect.y,
    sourceRect.width,
    sourceRect.height,
    destinationRect.x,
    destinationRect.y,
    destinationRect.width,
    destinationRect.height,
  );
  targetContext.restore();
};

export const drawSierraLiteInterlace = ({
  context,
  width,
  height,
  sources,
  settings: unsafeSettings,
  elapsedSeconds,
  sourceRect = { x: 0, y: 0, width, height },
  destinationRect = sourceRect,
}: {
  context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  width: number;
  height: number;
  sources: InterlaceRenderSource[];
  settings: InterlaceGroupSettings;
  elapsedSeconds: number;
  sourceRect?: Rect;
  destinationRect?: Rect;
}): boolean => {
  if (sources.length < 2 || width <= 0 || height <= 0) {
    return false;
  }
  const settings = sanitizeInterlaceSettings(unsafeSettings);
  const gridWidth = Math.ceil(width / settings.cellSize);
  const periodCells = Math.ceil(gridWidth / 8) * 8;
  const isSierraTravel = settings.patternPreset === 'sierra-travel';
  const scratch = getScratch(width, height);
  if (!scratch) {
    return false;
  }
  const pulseFrame = resolveInterlaceFrame({
    elapsedSeconds,
    sourceCount: sources.length,
    loopDurationSeconds: settings.loopDurationSeconds,
    dominance: settings.dominance,
    direction: settings.direction,
    travelCycles: settings.travelCycles,
    gridWidth: periodCells,
  });
  const tileMetrics = resolveInterlaceTileMetrics({
    documentWidth: width,
    documentHeight: height,
    cellSize: settings.cellSize,
    patternPreset: settings.patternPreset,
  });
  const { tileWidth, tileHeight } = tileMetrics;
  const sierraFrame = resolveSierraTravelFrame({
    elapsedSeconds,
    traversalDurationSeconds: settings.loopDurationSeconds,
    travelPeriodPixels: tileMetrics.travelPeriodPixels,
    travelCycles: settings.travelCycles,
    direction: settings.direction,
  });
  scratch.maskContext.setTransform(1, 0, 0, 1, 0, 0);
  scratch.maskContext.clearRect(0, 0, width, height);
  if (isSierraTravel) {
    if (scratch.tile.width !== tileWidth || scratch.tile.height !== tileHeight) {
      scratch.tile.width = tileWidth;
      scratch.tile.height = tileHeight;
      scratch.tileKey = null;
    }
    const plateKey = [
      tileWidth,
      tileHeight,
      tileMetrics.cellWidth,
      tileMetrics.cellHeight,
      settings.seed,
    ].join(':');
    if (scratch.tileKey !== plateKey) {
      const rectangles = resolveInterlaceMaskRectangles({
        width: tileWidth,
        height: tileHeight,
        cellSize: tileMetrics.cellWidth,
        cellHeight: tileMetrics.cellHeight,
        mix: 0.5,
        patternPreset: 'sierra-travel',
        seed: settings.seed,
      });
      scratch.tileContext.setTransform(1, 0, 0, 1, 0, 0);
      scratch.tileContext.clearRect(0, 0, tileWidth, tileHeight);
      scratch.tileContext.fillStyle = '#fff';
      for (const rectangle of rectangles) {
        const left = rectangle.x;
        const top = Math.round(rectangle.y);
        const right = rectangle.x + rectangle.width;
        const bottom = Math.round(rectangle.y + rectangle.height);
        if (right > left && bottom > top) {
          scratch.tileContext.fillRect(left, top, right - left, bottom - top);
        }
      }
      scratch.tileKey = plateKey;
    }
    scratch.maskContext.imageSmoothingEnabled = true;
    scratch.maskContext.drawImage(
      scratch.tile,
      -tileMetrics.overscanPixels + sierraFrame.sheetOffsetPixels,
      0,
    );
  } else {
    if (scratch.tile.width !== tileWidth || scratch.tile.height !== tileHeight) {
      scratch.tile.width = tileWidth;
      scratch.tile.height = tileHeight;
      scratch.tileKey = null;
    }
    const rectangles = resolveInterlaceMaskRectangles({
      width: tileWidth,
      height: tileHeight,
      cellSize: tileMetrics.cellWidth,
      cellHeight: tileMetrics.cellHeight,
      mix: pulseFrame.mix,
      motionPixels: settings.motionMode === 'travel'
        ? pulseFrame.motionCells * tileMetrics.cellWidth
        : 0,
      phaseCycles: pulseFrame.pairPhaseCycles,
      mirrorX: settings.motionMode === 'fixed' && settings.direction === 'left',
      patternPreset: settings.patternPreset,
      transitionProgress: pulseFrame.pairProgress,
      seed: settings.seed,
    });
    scratch.tileContext.setTransform(1, 0, 0, 1, 0, 0);
    scratch.tileContext.clearRect(0, 0, tileWidth, tileHeight);
    scratch.tileContext.fillStyle = '#fff';
    for (const rectangle of rectangles) {
      const left = rectangle.x;
      const top = Math.round(rectangle.y);
      const right = rectangle.x + rectangle.width;
      const bottom = Math.round(rectangle.y + rectangle.height);
      if (right > left && bottom > top) {
        scratch.tileContext.fillRect(left, top, right - left, bottom - top);
      }
    }
    const maskPattern = scratch.maskContext.createPattern(scratch.tile, 'repeat');
    if (!maskPattern) {
      return false;
    }
    scratch.maskContext.fillStyle = maskPattern;
    scratch.maskContext.fillRect(0, 0, width, height);
  }
  drawMaskedSource({
    targetContext: context,
    source: sources[isSierraTravel ? sierraFrame.baseIndex : pulseFrame.currentIndex],
    scratch,
    width,
    height,
    keepHighBits: false,
    sourceRect,
    destinationRect,
  });
  drawMaskedSource({
    targetContext: context,
    source: sources[isSierraTravel ? sierraFrame.revealIndex : pulseFrame.nextIndex],
    scratch,
    width,
    height,
    keepHighBits: true,
    sourceRect,
    destinationRect,
  });
  return true;
};
