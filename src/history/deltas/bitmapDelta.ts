import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

import {
  createHistoryMutationTracker,
  type HistoryDelta,
  type HistoryDirection,
  type HistoryMutationTracker,
  type HistoryRehydrationTargets,
  type PreparedHistoryDelta,
} from '../actionTypes';
import { readBlob, releaseBlob, storeBlob } from '../blobStore';
import { HistoryBlobReadError, HistoryReplayDriftError } from '../errors';
import {
  strokeFinalizeProbeMark,
  strokeFinalizeProbeTimeSync,
} from '@/utils/strokeFinalizeProbe';

type TileEncoding = 'raw' | 'rle';
type BitmapValidationMode = 'full' | 'patches';

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
  roi?: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
}

const TILE_SIZE_DEFAULT = 256;

const fnvMix = (hash: number, value: number): number => {
  let next = hash ^ (value & 0xff);
  next = Math.imul(next, 0x01000193) >>> 0;
  return next;
};

const hashBitmapBytes = (
  data: Uint8Array | Uint8ClampedArray | null,
  width: number,
  height: number,
): string => {
  let hash = 0x811c9dc5;
  const mixNumber = (value: number) => {
    hash = fnvMix(hash, value);
    hash = fnvMix(hash, value >>> 8);
    hash = fnvMix(hash, value >>> 16);
    hash = fnvMix(hash, value >>> 24);
  };
  mixNumber(width);
  mixNumber(height);
  const byteLength = width * height * 4;
  mixNumber(byteLength);
  if (data) {
    for (let i = 0; i < byteLength; i += 1) {
      hash = fnvMix(hash, data[i] ?? 0);
    }
  }
  return hash.toString(16).padStart(8, '0');
};

const createPatchHasher = (width: number, height: number) => {
  let hash = 0x811c9dc5;
  let patchCount = 0;
  const mixNumber = (value: number) => {
    hash = fnvMix(hash, value);
    hash = fnvMix(hash, value >>> 8);
    hash = fnvMix(hash, value >>> 16);
    hash = fnvMix(hash, value >>> 24);
  };
  mixNumber(width);
  mixNumber(height);

  return {
    addPatch: (
      patch: { x: number; y: number; width: number; height: number },
      data: Uint8Array
    ) => {
      patchCount += 1;
      mixNumber(patch.x);
      mixNumber(patch.y);
      mixNumber(patch.width);
      mixNumber(patch.height);
      mixNumber(data.byteLength);
      for (let i = 0; i < data.byteLength; i += 1) {
        hash = fnvMix(hash, data[i] ?? 0);
      }
    },
    digest: (): string => {
      mixNumber(patchCount);
      return hash.toString(16).padStart(8, '0');
    },
  };
};

const hashImageData = (
  imageData: ImageData | null | undefined,
  width: number,
  height: number,
): string => hashBitmapBytes(imageData?.data ?? null, width, height);

const hashRoiBeforeOverAfter = (
  before: ImageData,
  after: ImageData,
  roi: { x: number; y: number; right: number; bottom: number },
): string => {
  const merged = new Uint8ClampedArray(after.data);
  const roiWidth = roi.right - roi.x;
  const roiHeight = roi.bottom - roi.y;
  for (let y = 0; y < roiHeight; y += 1) {
    const targetY = roi.y + y;
    const sourceRow = y * before.width * 4;
    const targetRow = targetY * after.width * 4;
    for (let x = 0; x < roiWidth; x += 1) {
      const targetX = roi.x + x;
      const sourceIndex = sourceRow + x * 4;
      const targetIndex = targetRow + targetX * 4;
      merged[targetIndex] = before.data[sourceIndex] ?? 0;
      merged[targetIndex + 1] = before.data[sourceIndex + 1] ?? 0;
      merged[targetIndex + 2] = before.data[sourceIndex + 2] ?? 0;
      merged[targetIndex + 3] = before.data[sourceIndex + 3] ?? 0;
    }
  }
  return hashBitmapBytes(merged, after.width, after.height);
};

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

const hashNormalizedImageData = (
  imageData: ImageData | null | undefined,
  width: number,
  height: number,
): string => {
  if (!imageData) {
    return hashImageData(null, width, height);
  }
  if (imageData.width === width && imageData.height === height) {
    return hashImageData(imageData, width, height);
  }
  return hashBitmapBytes(
    extractTile(new Uint8Array(imageData.data), imageData.width, imageData.height, 0, 0, width, height),
    width,
    height,
  );
};

const hashImagePatchRegions = (
  imageData: ImageData | null | undefined,
  width: number,
  height: number,
  patches: TilePatch[]
): string => {
  const hasher = createPatchHasher(width, height);
  const source = imageData ? new Uint8Array(imageData.data) : null;
  patches.forEach((patch) => {
    const patchBytes = extractTile(
      source,
      imageData?.width ?? width,
      imageData?.height ?? height,
      patch.x,
      patch.y,
      patch.width,
      patch.height
    );
    hasher.addPatch(patch, patchBytes);
  });
  return hasher.digest();
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

const buildDirtyRectsFromPatches = (
  patches: TilePatch[],
  maxWidth: number,
  maxHeight: number,
) => patches
  .map((patch) => {
    const x = Math.max(0, Math.floor(patch.x));
    const y = Math.max(0, Math.floor(patch.y));
    const right = Math.min(maxWidth, Math.ceil(patch.x + patch.width));
    const bottom = Math.min(maxHeight, Math.ceil(patch.y + patch.height));
    return {
      x,
      y,
      width: Math.max(0, right - x),
      height: Math.max(0, bottom - y),
    };
  })
  .filter((rect) => rect.width > 0 && rect.height > 0);

class BitmapTileDelta implements HistoryDelta {
  readonly _tag = 'bitmap-tile';
  readonly approxBytes?: number;

  readonly layerId: string;
  private readonly width: number;
  private readonly height: number;
  private readonly forward: TilePatch[];
  private readonly backward: TilePatch[];
  private readonly beforeHash: string;
  private readonly afterHash: string;
  private readonly validationMode: BitmapValidationMode;
  readonly tileCount: number;

  constructor(options: {
    layerId: string;
    width: number;
    height: number;
    forward: TilePatch[];
    backward: TilePatch[];
    beforeHash: string;
    afterHash: string;
    validationMode?: BitmapValidationMode;
  }) {
    const { layerId, width, height, forward, backward, beforeHash, afterHash, validationMode = 'full' } = options;
    this.layerId = layerId;
    this.width = width;
    this.height = height;
    this.forward = forward;
    this.backward = backward;
    this.beforeHash = beforeHash;
    this.afterHash = afterHash;
    this.validationMode = validationMode;
    this.tileCount = forward.length;
    const total =
      forward.reduce((sum, patch) => sum + patch.approxBytes, 0) +
      backward.reduce((sum, patch) => sum + patch.approxBytes, 0);
    this.approxBytes = total;
  }

  async prepare(direction: HistoryDirection): Promise<PreparedHistoryDelta> {
    const requested = await this.preparePatches(direction, true);
    const compensation = await this.preparePatches(direction === 'forward' ? 'backward' : 'forward', false);
    const mutation = createHistoryMutationTracker();
    return {
      deltaTag: this._tag,
      apply: () => this.applyPrepared(requested.patches, requested.decoded, mutation),
      requiresCompensation: mutation.requiresCompensation,
      compensate: () => this.applyPrepared(compensation.patches, compensation.decoded),
      collectRehydrationTargets: (targets) => this.collectRehydrationTargets(targets),
    };
  }

  async applyReplay(direction: HistoryDirection): Promise<void> {
    const prepared = await this.prepare(direction);
    await prepared.apply();
  }

  private async preparePatches(
    direction: HistoryDirection,
    validateCurrent: boolean,
  ): Promise<{ patches: TilePatch[]; decoded: Array<{ patch: TilePatch; data: Uint8Array }> }> {
    const patches = direction === 'forward' ? this.forward : this.backward;
    if (patches.length === 0) {
      return { patches, decoded: [] };
    }
    if (validateCurrent) {
      const expectedHash = direction === 'forward' ? this.beforeHash : this.afterHash;
      const targetLayer = useAppStore.getState().layers.find((layer) => layer.id === this.layerId);
      const actualHash =
        this.validationMode === 'patches'
          ? hashImagePatchRegions(
              targetLayer?.imageData,
              this.width,
              this.height,
              direction === 'forward' ? this.backward : this.forward
            )
          : hashImageData(targetLayer?.imageData, this.width, this.height);
      if (actualHash !== expectedHash) {
        throw new HistoryReplayDriftError({
          deltaTag: this._tag,
          direction,
          layerId: this.layerId,
          expected: expectedHash,
          actual: actualHash,
          reason: 'bitmap-content-hash-mismatch',
        });
      }
    }
    const decoded = await Promise.all(
      patches.map(async (patch) => {
        const stored = await readBlob(patch.blobId);
        if (!stored) {
          throw new HistoryBlobReadError({
            deltaTag: this._tag,
            direction,
            layerId: this.layerId,
            expected: patch.blobId,
            actual: null,
            reason: 'missing-bitmap-tile-blob',
          });
        }
        const buffer =
          patch.encoding === 'rle' ? decodeRLE(stored.data) : stored.data;
        return { patch, data: buffer };
      })
    );
    return { patches, decoded };
  }

  private applyPrepared(
    patches: TilePatch[],
    decoded: Array<{ patch: TilePatch; data: Uint8Array }>,
    mutation?: HistoryMutationTracker,
  ): void {
    if (
      patches.length > 0 &&
      useAppStore.getState().layers.some((layer) => layer.id === this.layerId)
    ) {
      mutation?.markMutated();
    }
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
          const fbCtx = framebuffer.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as
            | CanvasRenderingContext2D
            | OffscreenCanvasRenderingContext2D
            | null;
          if (fbCtx && 'putImageData' in fbCtx) {
            fbCtx.putImageData(base, 0, 0);
          }
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
      };
    });

    const state = useAppStore.getState();
    const dirtyRects = buildDirtyRectsFromPatches(patches, this.width, this.height);
    state.markCompositeSegmentsDirtyByLayerIds([this.layerId], {
      dirtyRectsByLayerId: dirtyRects.length
        ? new Map([[this.layerId, dirtyRects]])
        : undefined,
    });
    useAppStore.setState({ layersNeedRecomposition: true });
  }

  dispose(): void {
    this.forward.forEach((patch) => releaseBlob(patch.blobId));
    this.backward.forEach((patch) => releaseBlob(patch.blobId));
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    targets.layerIds.add(this.layerId);
  }
}

export const createBitmapTileDelta = async ({
  layerId,
  before,
  after,
  tileSize = TILE_SIZE_DEFAULT,
  roi,
}: BitmapDeltaOptions): Promise<HistoryDelta | null> => {
  if (!after) {
    return null;
  }
  const width = after.width;
  const height = after.height;
  const probeMetaBase = {
    layerId,
    width,
    height,
    beforeWidth: before?.width ?? null,
    beforeHeight: before?.height ?? null,
    roiX: roi?.x ?? null,
    roiY: roi?.y ?? null,
    roiWidth: roi?.width ?? null,
    roiHeight: roi?.height ?? null,
    tileSize,
  };
  const beforeData = strokeFinalizeProbeTimeSync(
    'createBitmapTileDelta:cloneBeforeData',
    () => (before ? new Uint8Array(before.data) : null),
    probeMetaBase
  );
  const afterData = strokeFinalizeProbeTimeSync(
    'createBitmapTileDelta:cloneAfterData',
    () => new Uint8Array(after.data),
    probeMetaBase
  );
  const forwardPatches: TilePatch[] = [];
  const backwardPatches: TilePatch[] = [];

  const normalizedRoi = (() => {
    if (!roi) {
      return null;
    }
    const x = Math.max(0, Math.floor(roi.x));
    const y = Math.max(0, Math.floor(roi.y));
    const right = Math.min(width, Math.ceil(roi.x + roi.width));
    const bottom = Math.min(height, Math.ceil(roi.y + roi.height));
    if (right <= x || bottom <= y) {
      return null;
    }
    return { x, y, right, bottom };
  })();
  const roiWidth = normalizedRoi ? normalizedRoi.right - normalizedRoi.x : 0;
  const roiHeight = normalizedRoi ? normalizedRoi.bottom - normalizedRoi.y : 0;
  const beforeIsRoi =
    Boolean(before && normalizedRoi) &&
    (before?.width ?? 0) === roiWidth &&
    (before?.height ?? 0) === roiHeight;
  const beforeOffsetX = beforeIsRoi && normalizedRoi ? normalizedRoi.x : 0;
  const beforeOffsetY = beforeIsRoi && normalizedRoi ? normalizedRoi.y : 0;

  const horizontalTiles = Math.ceil(width / tileSize);
  const verticalTiles = Math.ceil(height / tileSize);
  const validationMode: BitmapValidationMode = normalizedRoi ? 'patches' : 'full';
  const forwardPatchHasher = createPatchHasher(width, height);
  const backwardPatchHasher = createPatchHasher(width, height);

  const txStart = normalizedRoi ? Math.max(0, Math.floor(normalizedRoi.x / tileSize)) : 0;
  const txEnd = normalizedRoi
    ? Math.min(horizontalTiles - 1, Math.floor((normalizedRoi.right - 1) / tileSize))
    : horizontalTiles - 1;
  const tyStart = normalizedRoi ? Math.max(0, Math.floor(normalizedRoi.y / tileSize)) : 0;
  const tyEnd = normalizedRoi
    ? Math.min(verticalTiles - 1, Math.floor((normalizedRoi.bottom - 1) / tileSize))
    : verticalTiles - 1;

  if (txEnd < txStart || tyEnd < tyStart) {
    return null;
  }

  const tileCount = (txEnd - txStart + 1) * (tyEnd - tyStart + 1);
  let changedTileCount = 0;
  strokeFinalizeProbeMark('createBitmapTileDelta:tileLoop', 'start', {
    ...probeMetaBase,
    tileCount,
    txStart,
    txEnd,
    tyStart,
    tyEnd,
    beforeIsRoi,
  });
  for (let ty = tyStart; ty <= tyEnd; ty += 1) {
    for (let tx = txStart; tx <= txEnd; tx += 1) {
      const x = tx * tileSize;
      const y = ty * tileSize;
      const tileWidth = Math.min(tileSize, width - x);
      const tileHeight = Math.min(tileSize, height - y);
      const afterTile = extractTile(afterData, width, height, x, y, tileWidth, tileHeight);
      let beforeTile = extractTile(
        beforeData,
        before?.width ?? width,
        before ? before.height : height,
        beforeIsRoi ? x - beforeOffsetX : x,
        beforeIsRoi ? y - beforeOffsetY : y,
        tileWidth,
        tileHeight
      );
      if (beforeIsRoi && beforeData && normalizedRoi) {
        // Preserve pixels outside ROI by seeding from afterTile, then overwrite ROI pixels only.
        beforeTile = afterTile.slice();
        const ix0 = Math.max(x, normalizedRoi.x);
        const iy0 = Math.max(y, normalizedRoi.y);
        const ix1 = Math.min(x + tileWidth, normalizedRoi.right);
        const iy1 = Math.min(y + tileHeight, normalizedRoi.bottom);
        const roiWidthPx = normalizedRoi.right - normalizedRoi.x;
        for (let py = iy0; py < iy1; py += 1) {
          const srcY = py - normalizedRoi.y;
          const destY = py - y;
          const srcRow = srcY * roiWidthPx * 4;
          const destRow = destY * tileWidth * 4;
          for (let px = ix0; px < ix1; px += 1) {
            const srcX = px - normalizedRoi.x;
            const destX = px - x;
            const srcIndex = srcRow + srcX * 4;
            const destIndex = destRow + destX * 4;
            beforeTile[destIndex] = beforeData[srcIndex];
            beforeTile[destIndex + 1] = beforeData[srcIndex + 1];
            beforeTile[destIndex + 2] = beforeData[srcIndex + 2];
            beforeTile[destIndex + 3] = beforeData[srcIndex + 3];
          }
        }
      }

      if (before && tilesEqual(beforeTile, afterTile)) {
        continue;
      }
      changedTileCount += 1;
      const patchRegion = { x, y, width: tileWidth, height: tileHeight };
      forwardPatchHasher.addPatch(patchRegion, afterTile);
      backwardPatchHasher.addPatch(patchRegion, beforeTile);

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
  strokeFinalizeProbeMark('createBitmapTileDelta:tileLoop', 'end', {
    ...probeMetaBase,
    tileCount,
    changedTileCount,
    forwardPatchCount: forwardPatches.length,
    backwardPatchCount: backwardPatches.length,
    beforeIsRoi,
  });

  if (forwardPatches.length === 0) {
    return null;
  }

  const beforeHash = strokeFinalizeProbeTimeSync(
    'createBitmapTileDelta:beforeHash',
    () =>
      validationMode === 'patches'
        ? backwardPatchHasher.digest()
        : before && beforeIsRoi && normalizedRoi
          ? hashRoiBeforeOverAfter(before, after, normalizedRoi)
          : hashNormalizedImageData(before, width, height),
    {
      ...probeMetaBase,
      beforeIsRoi,
      validationMode,
    }
  );
  const afterHash = strokeFinalizeProbeTimeSync(
    'createBitmapTileDelta:afterHash',
    () => validationMode === 'patches' ? forwardPatchHasher.digest() : hashImageData(after, width, height),
    {
      ...probeMetaBase,
      validationMode,
    }
  );

  return new BitmapTileDelta({
    layerId,
    width,
    height,
    forward: forwardPatches,
    backward: backwardPatches,
    beforeHash,
    afterHash,
    validationMode,
  });
};
