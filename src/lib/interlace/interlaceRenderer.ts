import {
  resolveInterlaceFrame,
  rollSierraLiteBinaryField,
  resolveSierraLiteBinaryField,
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
  layer: HTMLCanvasElement;
  layerContext: CanvasRenderingContext2D;
  maskImageData: ImageData | null;
}

const scratchByKey = new Map<string, InterlaceScratch>();

const getScratch = (width: number, height: number, gridWidth: number, gridHeight: number): InterlaceScratch | null => {
  if (typeof document === 'undefined') {
    return null;
  }
  const key = `${width}x${height}:${gridWidth}x${gridHeight}`;
  const cached = scratchByKey.get(key);
  if (cached) {
    return cached;
  }
  const mask = document.createElement('canvas');
  mask.width = gridWidth;
  mask.height = gridHeight;
  const maskContext = mask.getContext('2d');
  const layer = document.createElement('canvas');
  layer.width = width;
  layer.height = height;
  const layerContext = layer.getContext('2d');
  if (!maskContext || !layerContext) {
    return null;
  }
  const scratch = { mask, maskContext, layer, layerContext, maskImageData: null };
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
  layerContext.imageSmoothingEnabled = false;
  layerContext.globalCompositeOperation = keepHighBits ? 'destination-in' : 'destination-out';
  layerContext.drawImage(scratch.mask, 0, 0, width, height);
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
  const gridHeight = Math.ceil(height / settings.cellSize);
  const scratch = getScratch(width, height, gridWidth, gridHeight);
  if (!scratch) {
    return false;
  }
  const frame = resolveInterlaceFrame({
    elapsedSeconds,
    sourceCount: sources.length,
    loopDurationSeconds: settings.loopDurationSeconds,
    dominance: settings.dominance,
    direction: settings.direction,
    travelCycles: settings.travelCycles,
    gridWidth,
  });
  const baseBits = resolveSierraLiteBinaryField({
    width: gridWidth,
    height: gridHeight,
    mix: frame.mix,
    seed: settings.seed,
    phaseX: 0,
    phaseY: 0,
    identityKey: frame.currentIndex,
    lowKey: frame.currentIndex,
    highKey: frame.nextIndex,
    diversity: 1,
  });
  const bits = rollSierraLiteBinaryField(
    baseBits,
    gridWidth,
    gridHeight,
    frame.motionCells,
  );
  const imageData = scratch.maskImageData?.width === gridWidth
    && scratch.maskImageData.height === gridHeight
    ? scratch.maskImageData
    : scratch.maskContext.createImageData(gridWidth, gridHeight);
  for (let index = 0, offset = 0; index < bits.length; index += 1, offset += 4) {
    imageData.data[offset] = 255;
    imageData.data[offset + 1] = 255;
    imageData.data[offset + 2] = 255;
    imageData.data[offset + 3] = bits[index] ? 255 : 0;
  }
  scratch.maskImageData = imageData;
  scratch.maskContext.putImageData(imageData, 0, 0);
  drawMaskedSource({
    targetContext: context,
    source: sources[frame.currentIndex],
    scratch,
    width,
    height,
    keepHighBits: false,
    sourceRect,
    destinationRect,
  });
  drawMaskedSource({
    targetContext: context,
    source: sources[frame.nextIndex],
    scratch,
    width,
    height,
    keepHighBits: true,
    sourceRect,
    destinationRect,
  });
  return true;
};
