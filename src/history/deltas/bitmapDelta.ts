import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

import type { HistoryDelta, HistoryDirection } from '../actionTypes';
import { readBlob, releaseBlob, storeBlob } from '../blobStore';

type TileEncoding = 'raw' | 'rle';

export interface TilePatch {
  x: number;
  y: number;
  width: number;
  height: number;
  blobId: string;
  encoding: TileEncoding;
  approxBytes: number;
}

export interface BitmapDeltaOptions {
  layerId: string;
  before: ImageData | null;
  after: ImageData | null;
  tileSize?: number;
}

const TILE_SIZE_DEFAULT = 256;

const cloneImageData = (imageData: ImageData): ImageData =>
  new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

const encodeRLE = (input: Uint8Array): Uint8Array => {
  const encoded: number[] = [];
  for (let i = 0; i < input.length; ) {
    const value = input[i]!;
    let length = 1;
    while (i + length < input.length && input[i + length] === value && length < 255) {
      length += 1;
    }
    encoded.push(length, value);
    i += length;
  }
  return Uint8Array.from(encoded);
};

const decodeRLE = (input: Uint8Array): Uint8Array => {
  const output: number[] = [];
  for (let i = 0; i < input.length; i += 2) {
    const count = input[i] ?? 0;
    const value = input[i + 1] ?? 0;
    for (let run = 0; run < count; run += 1) {
      output.push(value);
    }
  }
  return Uint8Array.from(output);
};

const encodeTileData = async (bytes: Uint8Array) => {
  const rle = encodeRLE(bytes);
  if (rle.length < bytes.length) {
    const blobId = await storeBlob(rle.buffer);
    return { blobId, encoding: 'rle' as const, approxBytes: rle.length };
  }
  const blobId = await storeBlob(bytes.buffer);
  return { blobId, encoding: 'raw' as const, approxBytes: bytes.length };
};

const extractTile = (
  source: Uint8Array | null,
  sourceWidth: number,
  sourceHeight: number,
  x: number,
  y: number,
  tileWidth: number,
  tileHeight: number
): Uint8Array => {
  const output = new Uint8Array(tileWidth * tileHeight * 4);
  if (!source) {
    return output;
  }

  let targetIndex = 0;
  for (let row = 0; row < tileHeight; row += 1) {
    const sourceY = y + row;
    if (sourceY < 0 || sourceY >= sourceHeight) {
      targetIndex += tileWidth * 4;
      continue;
    }
    const sourceOffset = (sourceY * sourceWidth + x) * 4;
    for (let col = 0; col < tileWidth; col += 1) {
      const sourceX = x + col;
      if (sourceX < 0 || sourceX >= sourceWidth) {
        targetIndex += 4;
        continue;
      }
      const srcIndex = sourceOffset + col * 4;
      output[targetIndex++] = source[srcIndex]!;
      output[targetIndex++] = source[srcIndex + 1]!;
      output[targetIndex++] = source[srcIndex + 2]!;
      output[targetIndex++] = source[srcIndex + 3]!;
    }
  }
  return output;
};

const tilesEqual = (
  before: Uint8Array,
  after: Uint8Array
): boolean => {
  if (before.length !== after.length) {
    return false;
  }
  for (let i = 0; i < before.length; i += 1) {
    if (before[i] !== after[i]) {
      return false;
    }
  }
  return true;
};

class BitmapTileDelta implements HistoryDelta {
  readonly _tag = 'bitmap-tile';
  readonly approxBytes?: number;

  private readonly layerId: string;
  private readonly width: number;
  private readonly height: number;
  private readonly forward: TilePatch[];
  private readonly backward: TilePatch[];

  constructor(layerId: string, width: number, height: number, forward: TilePatch[], backward: TilePatch[]) {
    this.layerId = layerId;
    this.width = width;
    this.height = height;
    this.forward = forward;
    this.backward = backward;
    const total =
      forward.reduce((sum, patch) => sum + patch.approxBytes, 0) +
      backward.reduce((sum, patch) => sum + patch.approxBytes, 0);
    this.approxBytes = total;
  }

  async apply(direction: HistoryDirection): Promise<void> {
    const patches = direction === 'forward' ? this.forward : this.backward;
    if (patches.length === 0) {
      return;
    }
    const decoded = await Promise.all(
      patches.map(async (patch) => {
        const stored = await readBlob(patch.blobId);
        if (!stored) {
          return { patch, data: new Uint8Array(patch.width * patch.height * 4) };
        }
        const buffer =
          patch.encoding === 'rle' ? decodeRLE(stored.data) : stored.data;
        return { patch, data: buffer };
      })
    );

    useAppStore.setState((state) => {
      const targetLayer = state.layers.find((layer) => layer.id === this.layerId);
      if (!targetLayer) {
        return state;
      }

      const width = targetLayer.imageData?.width ?? this.width;
      const height = targetLayer.imageData?.height ?? this.height;
      const base =
        targetLayer.imageData &&
        targetLayer.imageData.width === width &&
        targetLayer.imageData.height === height
          ? cloneImageData(targetLayer.imageData)
          : new ImageData(width, height);
      const baseData = base.data;

      decoded.forEach(({ patch, data }) => {
        const { x, y, width: tileWidth, height: tileHeight } = patch;
        let srcIndex = 0;
        for (let row = 0; row < tileHeight; row += 1) {
          const targetY = y + row;
          if (targetY < 0 || targetY >= base.height) {
            srcIndex += tileWidth * 4;
            continue;
          }
          const baseOffset = (targetY * base.width + x) * 4;
          for (let col = 0; col < tileWidth; col += 1) {
            const targetX = x + col;
            if (targetX < 0 || targetX >= base.width) {
              srcIndex += 4;
              continue;
            }
            const dest = baseOffset + col * 4;
            baseData[dest] = data[srcIndex++] ?? 0;
            baseData[dest + 1] = data[srcIndex++] ?? 0;
            baseData[dest + 2] = data[srcIndex++] ?? 0;
            baseData[dest + 3] = data[srcIndex++] ?? 0;
          }
        }
      });

      const framebuffer = targetLayer.framebuffer;
      if (framebuffer) {
        try {
          const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
          fbCtx?.putImageData(base, 0, 0);
        } catch {
          // ignore framebuffer failures, history still updates imageData
        }
      }

      const updatedLayers = state.layers.map((layer) =>
        layer.id === this.layerId
          ? {
              ...layer,
              imageData: base
            }
          : layer
      );

      return {
        layers: updatedLayers as Layer[],
        layersNeedRecomposition: true
      };
    });
  }

  dispose(): void {
    const unique = new Set<string>();
    const collect = (patch: TilePatch) => {
      if (!unique.has(patch.blobId)) {
        unique.add(patch.blobId);
        releaseBlob(patch.blobId);
      }
    };
    this.forward.forEach(collect);
    this.backward.forEach(collect);
  }
}

export const createBitmapTileDelta = async ({
  layerId,
  before,
  after,
  tileSize = TILE_SIZE_DEFAULT
}: BitmapDeltaOptions): Promise<HistoryDelta | null> => {
  if (!after) {
    return null;
  }
  const width = after.width;
  const height = after.height;
  const beforeData = before ? new Uint8Array(before.data) : null;
  const afterData = new Uint8Array(after.data);
  const forwardPatches: TilePatch[] = [];
  const backwardPatches: TilePatch[] = [];

  const horizontalTiles = Math.ceil(width / tileSize);
  const verticalTiles = Math.ceil(height / tileSize);

  for (let ty = 0; ty < verticalTiles; ty += 1) {
    for (let tx = 0; tx < horizontalTiles; tx += 1) {
      const x = tx * tileSize;
      const y = ty * tileSize;
      const tileWidth = Math.min(tileSize, width - x);
      const tileHeight = Math.min(tileSize, height - y);
      const afterTile = extractTile(afterData, width, height, x, y, tileWidth, tileHeight);
      const beforeTile = extractTile(
        beforeData,
        before?.width ?? width,
        before ? before.height : height,
        x,
        y,
        tileWidth,
        tileHeight
      );

      if (before && tilesEqual(beforeTile, afterTile)) {
        continue;
      }

      const forward = await encodeTileData(afterTile);
      const backward = await encodeTileData(beforeTile);

      forwardPatches.push({
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        blobId: forward.blobId,
        encoding: forward.encoding,
        approxBytes: forward.approxBytes
      });
      backwardPatches.push({
        x,
        y,
        width: tileWidth,
        height: tileHeight,
        blobId: backward.blobId,
        encoding: backward.encoding,
        approxBytes: backward.approxBytes
      });
    }
  }

  if (forwardPatches.length === 0) {
    return null;
  }

  return new BitmapTileDelta(layerId, width, height, forwardPatches, backwardPatches);
};
