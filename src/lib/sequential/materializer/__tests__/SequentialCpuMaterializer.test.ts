import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';

const createEvent = ({
  id,
  frameIndex,
  x,
  y,
  color,
  size = 4,
  brushShape = BrushShape.ROUND,
  alpha = 1,
  ditherEnabled = false,
  mosaicTilePx,
  mosaicBlocksCount,
  mosaicPaletteCount,
  mosaicDitherEnabled,
  mosaicSegmentPx,
  mosaicSegmentJitter,
  mosaicSeed,
  colorCycleGradient,
  customStamp = null,
}: {
  id: string;
  frameIndex: number;
  x: number;
  y: number;
  color: string;
  size?: number;
  brushShape?: BrushShape;
  alpha?: number;
  ditherEnabled?: boolean;
  mosaicTilePx?: number;
  mosaicBlocksCount?: number;
  mosaicPaletteCount?: number;
  mosaicDitherEnabled?: boolean;
  mosaicSegmentPx?: number;
  mosaicSegmentJitter?: number;
  mosaicSeed?: number;
  colorCycleGradient?: Array<{ position: number; color: string }>;
  customStamp?: {
    width: number;
    height: number;
    rgbaBase64: string;
    isColorizable: boolean;
    hash: string;
  } | null;
}): SequentialStrokeEvent => ({
  id,
  layerId: 'layer-1',
  strokeId: 'stroke-1',
  timestampMs: 0,
  frameIndex,
  brush: {
    tool: 'brush',
    brushShape,
    size,
    opacity: 1,
    blendMode: 'source-over',
    rotation: 0,
    spacing: 1,
    color,
    customStampId: null,
    customStampHash: customStamp?.hash ?? null,
    customStamp: customStamp
      ? {
          width: customStamp.width,
          height: customStamp.height,
          rgbaBase64: customStamp.rgbaBase64,
          isColorizable: customStamp.isColorizable,
        }
      : null,
    ditherEnabled,
    mosaicTilePx,
    mosaicBlocksCount,
    mosaicPaletteCount,
    mosaicDitherEnabled,
    mosaicSegmentPx,
    mosaicSegmentJitter,
    mosaicSeed,
    colorCycleGradient,
  },
  stamps: [
    {
      x,
      y,
      pressure: 1,
      rotation: 0,
      size,
      alpha,
    },
  ],
});

const bytesToBase64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const sumAlpha = (data: Uint8ClampedArray): number => {
  let total = 0;
  for (let i = 3; i < data.length; i += 4) {
    total += data[i];
  }
  return total;
};

const countUniqueVisibleColors = (data: Uint8ClampedArray): number => {
  const colors = new Set<string>();
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      continue;
    }
    colors.add(`${data[i]},${data[i + 1]},${data[i + 2]}`);
  }
  return colors.size;
};

const countVisibleWithPredicate = (
  data: Uint8ClampedArray,
  predicate: (r: number, g: number, b: number) => boolean
): number => {
  let count = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) {
      continue;
    }
    if (predicate(data[i], data[i + 1], data[i + 2])) {
      count += 1;
    }
  }
  return count;
};

const materializeToPixels = (
  materializer: SequentialCpuMaterializer,
  input: Parameters<SequentialCpuMaterializer['materializeFrame']>[0]
): Uint8ClampedArray => {
  const tileSet = materializer.materializeFrame(input);
  const pixels = new Uint8ClampedArray(input.width * input.height * 4);
  tileSet.tiles.forEach((tile) => {
    for (let row = 0; row < tile.height; row += 1) {
      const sourceOffset = row * tile.width * 4;
      const targetOffset = ((tile.y + row) * input.width + tile.x) * 4;
      pixels.set(
        tile.data.subarray(sourceOffset, sourceOffset + tile.width * 4),
        targetOffset
      );
    }
  });
  return pixels;
};

describe('SequentialCpuMaterializer', () => {
  it('materializes only the requested frame', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 8 });
    const tileSet = materializer.materializeFrame({
      width: 16,
      height: 16,
      frameIndex: 1,
      events: [
        createEvent({ id: 'f0', frameIndex: 0, x: 4, y: 4, color: '#ff0000' }),
        createEvent({ id: 'f1', frameIndex: 1, x: 12, y: 12, color: '#00ff00' }),
      ],
    });

    expect(tileSet.frameIndex).toBe(1);
    expect(tileSet.tiles.length).toBeGreaterThan(0);
    expect(tileSet.tiles.every((tile) => tile.x >= 8 || tile.y >= 8)).toBe(true);
  });

  it('produces deterministic premultiplied output', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 8 });
    const input = {
      width: 12,
      height: 12,
      frameIndex: 0,
      events: [
        createEvent({ id: 'a', frameIndex: 0, x: 4, y: 4, color: 'rgba(255, 0, 0, 0.5)' }),
        createEvent({ id: 'b', frameIndex: 0, x: 7, y: 6, color: '#00ff0080', alpha: 0.8 }),
      ],
    };

    const first = materializer.materializeFrame(input);
    const second = materializer.materializeFrame(input);

    expect(first.tiles).toHaveLength(second.tiles.length);
    const firstBytes = first.tiles.flatMap((tile) => Array.from(tile.data));
    const secondBytes = second.tiles.flatMap((tile) => Array.from(tile.data));
    expect(firstBytes).toEqual(secondBytes);
    expect(first.tiles.some((tile) => sumAlpha(tile.data) > 0)).toBe(true);
  });

  it('uses brushShape when rasterizing stamps', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 16 });
    const inputBase = {
      width: 20,
      height: 20,
      frameIndex: 0,
    };

    const roundPixels = materializeToPixels(materializer, {
      ...inputBase,
      events: [
        createEvent({
          id: 'round',
          frameIndex: 0,
          x: 10,
          y: 10,
          color: '#ffffff',
          brushShape: BrushShape.ROUND,
        }),
      ],
    });
    const squarePixels = materializeToPixels(materializer, {
      ...inputBase,
      events: [
        createEvent({
          id: 'square',
          frameIndex: 0,
          x: 10,
          y: 10,
          color: '#ffffff',
          brushShape: BrushShape.SQUARE,
        }),
      ],
    });

    // Pixel is inside a square stamp but outside a round stamp of the same size.
    const edgePixelAlphaIndex = (11 * inputBase.width + 11) * 4 + 3;
    expect(roundPixels[edgePixelAlphaIndex]).toBe(0);
    expect(squarePixels[edgePixelAlphaIndex]).toBeGreaterThan(0);
  });

  it('applies dither texture when enabled', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 16 });
    const inputBase = {
      width: 24,
      height: 24,
      frameIndex: 0,
    };
    const plain = materializeToPixels(materializer, {
      ...inputBase,
      events: [
        createEvent({
          id: 'plain',
          frameIndex: 0,
          x: 12,
          y: 12,
          color: '#ffffff',
          ditherEnabled: false,
        }),
      ],
    });
    const dithered = materializeToPixels(materializer, {
      ...inputBase,
      events: [
        createEvent({
          id: 'dithered',
          frameIndex: 0,
          x: 12,
          y: 12,
          color: '#ffffff',
          ditherEnabled: true,
        }),
      ],
    });

    expect(sumAlpha(dithered)).toBeLessThan(sumAlpha(plain));
  });

  it('applies pixel-dither texture mode for non-custom brushes', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 16 });
    const inputBase = {
      width: 24,
      height: 24,
      frameIndex: 0,
    };
    const solid = materializeToPixels(materializer, {
      ...inputBase,
      events: [
        createEvent({
          id: 'solid-shape',
          frameIndex: 0,
          x: 12,
          y: 12,
          color: '#ffffff',
          brushShape: BrushShape.ROUND,
        }),
      ],
    });
    const textured = materializeToPixels(materializer, {
      ...inputBase,
      events: [
        createEvent({
          id: 'pixel-dither',
          frameIndex: 0,
          x: 12,
          y: 12,
          color: '#ffffff',
          brushShape: BrushShape.PIXEL_DITHER,
        }),
      ],
    });

    expect(sumAlpha(textured)).toBeLessThan(sumAlpha(solid));
  });

  it('renders custom stamp texture when provided', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 16 });
    const rgba = new Uint8Array([
      // red opaque, blue transparent
      255, 0, 0, 255, 0, 0, 255, 0,
      // green opaque, white transparent
      0, 255, 0, 255, 255, 255, 255, 0,
    ]);
    const customStamp = {
      width: 2,
      height: 2,
      rgbaBase64: bytesToBase64(rgba),
      isColorizable: false,
      hash: 'stamp-hash-1',
    };
    const pixels = materializeToPixels(materializer, {
      width: 20,
      height: 20,
      frameIndex: 0,
      events: [
        createEvent({
          id: 'custom',
          frameIndex: 0,
          x: 10,
          y: 10,
          color: '#ffffff',
          brushShape: BrushShape.CUSTOM,
          customStamp,
        }),
      ],
    });

    expect(sumAlpha(pixels)).toBeGreaterThan(0);
    // Texture color should not be flat white when not colorizable.
    const sample = (9 * 20 + 9) * 4;
    expect(pixels[sample]).not.toBe(pixels[sample + 1]);
  });

  it('renders mosaic brush with multiple shade levels instead of flat fill', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 16 });
    const pixels = materializeToPixels(materializer, {
      width: 36,
      height: 36,
      frameIndex: 0,
      events: [
        createEvent({
          id: 'mosaic',
          frameIndex: 0,
          x: 18,
          y: 18,
          color: '#ff5500',
          size: 60,
          brushShape: BrushShape.MOSAIC,
          mosaicTilePx: 3,
          mosaicBlocksCount: 6,
          mosaicPaletteCount: 6,
          mosaicDitherEnabled: true,
          mosaicSegmentPx: 40,
          mosaicSegmentJitter: 20,
          mosaicSeed: 7,
          colorCycleGradient: [
            { position: 0, color: '#ff0000' },
            { position: 1, color: '#0000ff' },
          ],
        }),
      ],
    });

    expect(sumAlpha(pixels)).toBeGreaterThan(0);
    expect(countUniqueVisibleColors(pixels)).toBeGreaterThan(1);
    expect(countVisibleWithPredicate(pixels, (r, _g, b) => r > b)).toBeGreaterThan(0);
    expect(countVisibleWithPredicate(pixels, (r, _g, b) => b > r)).toBeGreaterThan(0);
    const center = (18 * 36 + 18) * 4;
    // Should be sourced from mosaic gradient palette, not the brush FG color (#ff5500).
    expect(pixels[center + 1]).toBeLessThan(40);
  });

  it('patches frame tiles equivalently to full rematerialization', () => {
    const materializer = new SequentialCpuMaterializer({ tileSize: 8 });
    const baseEvent = createEvent({ id: 'base', frameIndex: 0, x: 5, y: 5, color: '#ff0000' });
    const appendedEvent = createEvent({
      id: 'append',
      frameIndex: 0,
      x: 9,
      y: 9,
      color: '#00ff00',
    });

    const baseTileSet = materializer.materializeFrame({
      width: 16,
      height: 16,
      frameIndex: 0,
      events: [baseEvent],
    });
    const patched = materializer.patchFrame({
      width: 16,
      height: 16,
      frameIndex: 0,
      events: [appendedEvent],
      baseTileSet,
    });
    const fullyMaterialized = materializer.materializeFrame({
      width: 16,
      height: 16,
      frameIndex: 0,
      events: [baseEvent, appendedEvent],
    });

    const patchedBytes = patched.tiles.flatMap((tile) => Array.from(tile.data));
    const fullBytes = fullyMaterialized.tiles.flatMap((tile) => Array.from(tile.data));
    expect(patchedBytes).toEqual(fullBytes);
  });
});
