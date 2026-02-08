import type { SequentialStrokeEvent } from '@/types';
import { parseCssColor } from '@/utils/color/parseCssColor';
import type { FrameTile, FrameTileSet, SequentialMaterializeFrameInput } from '@/lib/sequential/types';
import type { SequentialMaterializerBackend } from '@/lib/sequential/materializer/SequentialMaterializerBackend';

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const paintStamp = ({
  pixels,
  width,
  height,
  stampX,
  stampY,
  stampSize,
  stampAlpha,
  color,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  stampX: number;
  stampY: number;
  stampSize: number;
  stampAlpha: number;
  color: { r: number; g: number; b: number; a: number };
}) => {
  if (stampSize <= 0 || stampAlpha <= 0) {
    return;
  }

  const radius = Math.max(0.5, stampSize * 0.5);
  const minX = Math.max(0, Math.floor(stampX - radius));
  const maxX = Math.min(width - 1, Math.ceil(stampX + radius));
  const minY = Math.max(0, Math.floor(stampY - radius));
  const maxY = Math.min(height - 1, Math.ceil(stampY + radius));
  const radiusSq = radius * radius;

  const srcA = clamp01(stampAlpha) * clamp01(color.a / 255);
  if (srcA <= 0) {
    return;
  }

  const srcR = (color.r / 255) * srcA;
  const srcG = (color.g / 255) * srcA;
  const srcB = (color.b / 255) * srcA;

  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      const dx = x + 0.5 - stampX;
      const dy = y + 0.5 - stampY;
      if (dx * dx + dy * dy > radiusSq) {
        continue;
      }

      const index = (y * width + x) * 4;
      const dstR = pixels[index] / 255;
      const dstG = pixels[index + 1] / 255;
      const dstB = pixels[index + 2] / 255;
      const dstA = pixels[index + 3] / 255;

      const outA = srcA + dstA * (1 - srcA);
      const outR = srcR + dstR * (1 - srcA);
      const outG = srcG + dstG * (1 - srcA);
      const outB = srcB + dstB * (1 - srcA);

      pixels[index] = Math.round(clamp01(outR) * 255);
      pixels[index + 1] = Math.round(clamp01(outG) * 255);
      pixels[index + 2] = Math.round(clamp01(outB) * 255);
      pixels[index + 3] = Math.round(clamp01(outA) * 255);
    }
  }
};

const copyTileData = ({
  pixels,
  width,
  tileX,
  tileY,
  tileWidth,
  tileHeight,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  tileX: number;
  tileY: number;
  tileWidth: number;
  tileHeight: number;
}): Uint8ClampedArray => {
  const tileData = new Uint8ClampedArray(tileWidth * tileHeight * 4);
  for (let row = 0; row < tileHeight; row += 1) {
    const sourceOffset = ((tileY + row) * width + tileX) * 4;
    const targetOffset = row * tileWidth * 4;
    tileData.set(
      pixels.subarray(sourceOffset, sourceOffset + tileWidth * 4),
      targetOffset
    );
  }
  return tileData;
};

const buildTiles = ({
  pixels,
  width,
  height,
  tileSize,
}: {
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  tileSize: number;
}): FrameTile[] => {
  const tiles: FrameTile[] = [];

  for (let tileY = 0; tileY < height; tileY += tileSize) {
    for (let tileX = 0; tileX < width; tileX += tileSize) {
      const tileWidth = Math.min(tileSize, width - tileX);
      const tileHeight = Math.min(tileSize, height - tileY);

      let hasAlpha = false;
      for (let y = 0; y < tileHeight && !hasAlpha; y += 1) {
        const base = ((tileY + y) * width + tileX) * 4;
        for (let x = 0; x < tileWidth; x += 1) {
          if (pixels[base + x * 4 + 3] > 0) {
            hasAlpha = true;
            break;
          }
        }
      }
      if (!hasAlpha) {
        continue;
      }

      tiles.push({
        x: tileX,
        y: tileY,
        width: tileWidth,
        height: tileHeight,
        data: copyTileData({
          pixels,
          width,
          tileX,
          tileY,
          tileWidth,
          tileHeight,
        }),
      });
    }
  }

  return tiles;
};

const getFrameEvents = (
  events: ReadonlyArray<SequentialStrokeEvent>,
  frameIndex: number
): SequentialStrokeEvent[] =>
  events.filter((event) => event.frameIndex === frameIndex);

export class SequentialCpuMaterializer implements SequentialMaterializerBackend {
  readonly kind = 'cpu' as const;
  private readonly tileSize: number;

  constructor(options?: { tileSize?: number }) {
    this.tileSize = Math.max(1, Math.round(options?.tileSize ?? 128));
  }

  materializeFrame({
    width,
    height,
    frameIndex,
    events,
  }: SequentialMaterializeFrameInput): FrameTileSet {
    const safeWidth = Math.max(1, Math.round(width));
    const safeHeight = Math.max(1, Math.round(height));
    const pixels = new Uint8ClampedArray(safeWidth * safeHeight * 4);
    const frameEvents = getFrameEvents(events, frameIndex);

    for (let eventIndex = 0; eventIndex < frameEvents.length; eventIndex += 1) {
      const event = frameEvents[eventIndex];
      const parsedColor = parseCssColor(event.brush.color);

      for (let stampIndex = 0; stampIndex < event.stamps.length; stampIndex += 1) {
        const stamp = event.stamps[stampIndex];
        paintStamp({
          pixels,
          width: safeWidth,
          height: safeHeight,
          stampX: stamp.x,
          stampY: stamp.y,
          stampSize: stamp.size || event.brush.size,
          stampAlpha: clamp01(stamp.alpha),
          color: parsedColor,
        });
      }
    }

    return {
      frameIndex,
      tileSize: this.tileSize,
      pixelFormat: 'rgba8',
      premultipliedAlpha: true,
      colorSpace: 'srgb',
      tiles: buildTiles({
        pixels,
        width: safeWidth,
        height: safeHeight,
        tileSize: this.tileSize,
      }),
    };
  }
}
