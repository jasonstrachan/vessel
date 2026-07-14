import JSZip from 'jszip';
import sharp from 'sharp';

import {
  CcShapePackingError,
  applyMergedColorCycleMetadata,
  assertCompatibleCcLayerPresentation,
  assertSelectedLayersAreContiguous,
  isCompleteCcPacking,
  consolidateCcLayerNamespaces,
  extractCcShapes,
  packCcShapes,
  mergeColorCycleMetadata,
  rotateCcShape,
  rewritePackedCcLayers,
  type CcPackingLayerInput,
  type CcExtractedShape,
  type CcPackedShapePlacement,
  type CcQuarterTurn,
  type CcShapePackingResult,
  type CcShapeSeparationOverride,
} from '@/lib/colorCycle/shapePacking';
import type {
  BinaryManifestEntry,
  PersistedColorCycleLayerEnvelope,
  PersistedLayerEnvelope,
  PersistedNormalLayerEnvelope,
  VesselProjectArchive,
} from '@/utils/projectPersistence';
import {
  buildRenderedContactSheetPng,
  buildRenderedPackingPng,
  type PackedPreviewSource,
} from './diagnostics';

type ColorCycleArchiveState = {
  version: 1;
  dimensions: { width: number; height: number };
  paintRef?: string;
  gradientIdRef?: string;
  gradientDefIdRef?: string;
  speedRef?: string;
  flowRef?: string;
  phaseRef?: string;
  hasContent?: boolean;
  [key: string]: unknown;
};

type MaskPayload = {
  width: number;
  height: number;
  rgba: Uint8Array;
};

type NormalArchiveState = {
  version?: number;
  dimensions?: { width: number; height: number };
  imageRef?: string;
  [key: string]: unknown;
};

type RasterPackingLayer = {
  layer: PersistedNormalLayerEnvelope;
  source: MaskPayload;
  shapes: readonly CcExtractedShape[];
  imageContainer: Record<string, unknown>;
  imageField: 'imageRef' | 'imageDataUrl';
};

type ScaledShapeSet = {
  shapes: readonly CcExtractedShape[];
  sourcePixelByShapeId: ReadonlyMap<string, Uint32Array>;
  originalBoundsByShapeId: ReadonlyMap<string, CcExtractedShape['sourceBounds']>;
};

type LegacyStrokeData = {
  paintBuffer?: string;
  gradientIdBuffer?: string;
  gradientDefIdBuffer?: string;
  speedBuffer?: string;
  flowBuffer?: string;
  phaseBuffer?: string;
  hasContent?: boolean;
  [key: string]: unknown;
};

type LegacyBrushSnapshot = {
  layerId?: string;
  dimensions?: { width: number; height: number };
  strokeData?: LegacyStrokeData;
  animator?: {
    indexBuffer?: {
      width?: number;
      height?: number;
      data?: string;
      gradientId?: string;
      speedData?: string;
      flowData?: string;
      phaseData?: string;
      [key: string]: unknown;
    };
    [key: string]: unknown;
  };
  [key: string]: unknown;
};

export type VsArchiveLayerSelector = Readonly<{ id?: string; name?: string }>;

export type VsArchivePackingOptions = Readonly<{
  selectors: readonly VsArchiveLayerSelector[];
  destinationLayerId?: string;
  splitByGradientDefId?: boolean;
  separationByLayerId?: Readonly<Record<string, CcShapeSeparationOverride>>;
  padding?: number;
  rotations?: readonly CcQuarterTurn[];
  beamWidth?: number;
  minimumSupportSpanRatio?: number;
  allowNonGravityNesting?: boolean;
  allowPartialPreview?: boolean;
  allowOverlap?: boolean;
  includeVisibleRasterLayers?: boolean;
  shapeScale?: number;
  autoFitWithoutOverlap?: boolean;
  preserveSelectedCcLayers?: boolean;
  largestCcShapeAsBackground?: boolean;
}>;

export type VsArchivePackingResult = Readonly<{
  archiveData: Uint8Array;
  packing: CcShapePackingResult;
  canvasWidth: number;
  canvasHeight: number;
  selectedLayerIds: readonly string[];
  sourceShapeCount: number;
  appliedShapeScale: number;
  renderedPreviewPng?: Uint8Array;
  renderedContactSheetPng?: Uint8Array;
}>;

type FastPackingOptions = Parameters<typeof packCcShapes>[1] & {
  fastFeasibility?: boolean;
};

const AUTO_SCALE_STEP = 0.05;

const roundScale = (scale: number): number => Number(scale.toFixed(2));

const autoFitShapes = (
  sourceShapes: readonly CcExtractedShape[],
  canvasWidth: number,
  canvasHeight: number,
  packingOptions: FastPackingOptions,
): Readonly<{
  scaledShapeSet: ScaledShapeSet;
  packing: CcShapePackingResult;
  scale: number;
}> => {
  let scale = 1;
  let best: { scaledShapeSet: ScaledShapeSet; packing: CcShapePackingResult; scale: number } | null = null;

  while (scale >= AUTO_SCALE_STEP) {
    const scaledShapeSet = scaleExtractedShapes(sourceShapes, roundScale(scale));
    const scaledArea = scaledShapeSet.shapes.reduce((total, shape) => total + shape.area, 0);
    let packing: CcShapePackingResult | null = null;
    if (scaledArea <= canvasWidth * canvasHeight) {
      try {
        packing = packCcShapes(scaledShapeSet.shapes, {
          ...packingOptions,
          allowOverlap: false,
          allowPartialPreview: true,
          fastFeasibility: true,
        } as FastPackingOptions);
      } catch (error) {
        if (!(error instanceof CcShapePackingError) || error.code !== 'insufficient-space') throw error;
      }
    }
    if (packing && isCompleteCcPacking(scaledShapeSet.shapes, packing)) {
      best = { scaledShapeSet, packing, scale: roundScale(scale) };
      break;
    }
    scale = roundScale(scale - AUTO_SCALE_STEP);
  }
  if (!best) {
    throw new CcShapePackingError(
      'insufficient-space',
      'The extracted shapes cannot be packed without overlap, even at the minimum automatic scale.',
    );
  }
  return best;
};

const PROJECT_ENTRY = 'project.json';
const PREVIEW_ENTRY = 'manifest.json';

const fnv1aHash = (bytes: Uint8Array): string => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < bytes.length; index += 1) {
    hash ^= bytes[index];
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
};

const inferBinaryManifestDType = (path: string): BinaryManifestEntry['dtype'] => {
  if (path.endsWith('gradient-def-id.bin')) return 'uint16';
  if (path.endsWith('.json')) return 'json';
  if (path.endsWith('.bin')) return 'uint8';
  return 'unknown';
};

const normalizePersistedLayerType = (
  layerType: PersistedLayerEnvelope['layerType'],
): 'normal' | 'color-cycle' | 'sequential' => {
  if (layerType === 'colorCycle' || layerType === 'color-cycle') return 'color-cycle';
  return layerType === 'sequential' ? 'sequential' : 'normal';
};

const archivePath = (ref: string | undefined): string | null =>
  ref?.startsWith('zip:') ? ref.slice('zip:'.length) : null;

const getState = (layer: PersistedLayerEnvelope): ColorCycleArchiveState | null => {
  const state = layer.state;
  if (!state || typeof state !== 'object' || !('dimensions' in state)) {
    return null;
  }
  return state as ColorCycleArchiveState;
};

const getLegacyBrushSnapshot = (layer: PersistedColorCycleLayerEnvelope): LegacyBrushSnapshot => {
  const colorCycleData = layer.colorCycleData as Record<string, unknown>;
  const brushState = colorCycleData.brushState;
  const snapshots = brushState && typeof brushState === 'object' && Array.isArray((brushState as { layers?: unknown }).layers)
    ? (brushState as { layers: LegacyBrushSnapshot[] }).layers
    : [];
  const snapshot = snapshots.find((candidate) => candidate.layerId === layer.id) ?? snapshots[0];
  if (!snapshot?.strokeData) {
    throw new CcShapePackingError(
      'missing-color-cycle-state',
      `Selected layer "${layer.name}" has neither canonical archive state nor legacy brush buffers.`,
      { layerId: layer.id },
    );
  }
  return snapshot;
};

const bytesPerPixel = (entry: BinaryManifestEntry): number => entry.dtype === 'uint16' ? 2 : 1;

const expandSparse = (bytes: Uint8Array, entry: BinaryManifestEntry): Uint8Array => {
  if (entry.encoding !== 'sparse-rect-v1' || !entry.crop || !entry.width || !entry.height) {
    return bytes;
  }
  const stride = bytesPerPixel(entry);
  const expected = entry.crop.width * entry.crop.height * stride;
  if (bytes.byteLength !== expected) {
    throw new CcShapePackingError('invalid-sparse-buffer', `Sparse archive buffer ${entry.path} has the wrong length.`);
  }
  const expanded = new Uint8Array(entry.logicalByteLength ?? entry.width * entry.height * stride);
  const rowBytes = entry.crop.width * stride;
  for (let row = 0; row < entry.crop.height; row += 1) {
    const sourceStart = row * rowBytes;
    const destinationStart = ((entry.crop.y + row) * entry.width + entry.crop.x) * stride;
    expanded.set(bytes.subarray(sourceStart, sourceStart + rowBytes), destinationStart);
  }
  return expanded;
};

const readArchiveBytes = async (
  zip: JSZip,
  manifest: Map<string, BinaryManifestEntry>,
  ref: string | undefined,
  field: string,
): Promise<Uint8Array> => {
  const path = archivePath(ref);
  if (!path) {
    throw new CcShapePackingError('missing-archive-buffer-ref', `${field} is missing its archive reference.`, { field });
  }
  const entry = zip.file(path);
  const manifestEntry = manifest.get(path);
  if (!entry || !manifestEntry) {
    throw new CcShapePackingError('missing-archive-buffer', `Archive buffer ${path} is missing.`, { field, path });
  }
  const stored = await entry.async('uint8array');
  if (stored.byteLength !== manifestEntry.byteLength || fnv1aHash(stored) !== manifestEntry.checksum) {
    throw new CcShapePackingError('archive-buffer-integrity', `Archive buffer ${path} failed length/checksum validation.`);
  }
  return expandSparse(stored, manifestEntry);
};

const readStoredBytes = async (
  zip: JSZip,
  manifest: Map<string, BinaryManifestEntry>,
  value: string | undefined,
  field: string,
): Promise<Uint8Array> => {
  if (!value) {
    throw new CcShapePackingError('missing-archive-buffer-ref', `${field} is missing its stored buffer.`, { field });
  }
  if (archivePath(value)) return readArchiveBytes(zip, manifest, value, field);
  return new Uint8Array(Buffer.from(value, 'base64'));
};

const readTextValue = async (
  zip: JSZip,
  manifest: Map<string, BinaryManifestEntry>,
  value: unknown,
): Promise<string | null> => {
  if (typeof value !== 'string' || !value) return null;
  const path = archivePath(value);
  if (!path) return value;
  return new TextDecoder().decode(await readArchiveBytes(zip, manifest, value, path));
};

const decodeMask = async (text: string | null): Promise<MaskPayload | null> => {
  if (!text) return null;
  if (text.startsWith('data:application/json;base64,')) {
    const encoded = text.slice('data:application/json;base64,'.length);
    const payload = JSON.parse(Buffer.from(encoded, 'base64').toString('utf8')) as {
      width: number;
      height: number;
      dataBase64?: string;
      data?: number[];
    };
    const rgba = payload.dataBase64
      ? new Uint8Array(Buffer.from(payload.dataBase64, 'base64'))
      : Uint8Array.from(payload.data ?? []);
    return { width: payload.width, height: payload.height, rgba };
  }
  if (text.startsWith('data:image/png;base64,')) {
    const decoded = await sharp(Buffer.from(text.slice('data:image/png;base64,'.length), 'base64'))
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    return {
      width: decoded.info.width,
      height: decoded.info.height,
      rgba: new Uint8Array(decoded.data),
    };
  }
  throw new CcShapePackingError('unsupported-mask-encoding', 'Selected layer uses an unsupported mask encoding.');
};

const maskAlpha = (mask: MaskPayload | null, width: number, height: number, field: string): Uint8Array | undefined => {
  if (!mask) return undefined;
  if (mask.width !== width || mask.height !== height || mask.rgba.length !== width * height * 4) {
    throw new CcShapePackingError('invalid-mask-dimensions', `${field} does not match the selected CC layer dimensions.`);
  }
  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index += 1) alpha[index] = mask.rgba[index * 4 + 3];
  return alpha;
};

const applyMaskAlpha = (mask: MaskPayload, alpha: Uint8Array): string => {
  const rgba = mask.rgba.slice();
  for (let index = 0; index < alpha.length; index += 1) rgba[index * 4 + 3] = alpha[index];
  const raw = {
    width: mask.width,
    height: mask.height,
    dataBase64: Buffer.from(rgba).toString('base64'),
  };
  return `data:application/json;base64,${Buffer.from(JSON.stringify(raw)).toString('base64')}`;
};

const sourceCoordinateForRotatedPixel = (
  x: number,
  y: number,
  width: number,
  height: number,
  rotation: CcQuarterTurn,
): { x: number; y: number } => {
  switch (rotation) {
    case 0: return { x, y };
    case 90: return { x: y, y: height - 1 - x };
    case 180: return { x: width - 1 - x, y: height - 1 - y };
    case 270: return { x: width - 1 - y, y: x };
  }
};

const scaleExtractedShapes = (
  shapes: readonly CcExtractedShape[],
  scale: number | undefined,
): ScaledShapeSet => {
  if (scale === undefined || scale === 1) {
    return {
      shapes,
      sourcePixelByShapeId: new Map(),
      originalBoundsByShapeId: new Map(),
    };
  }
  if (!Number.isFinite(scale) || scale <= 0 || scale > 1) {
    throw new CcShapePackingError('invalid-shape-scale', 'Shape scale must be greater than 0 and no more than 1.');
  }
  const sourcePixelByShapeId = new Map<string, Uint32Array>();
  const originalBoundsByShapeId = new Map<string, CcExtractedShape['sourceBounds']>();
  const scaledShapes = shapes.map((shape): CcExtractedShape => {
    const resized = resizeExtractedShape(
      shape,
      Math.max(1, Math.round(shape.width * scale)),
      Math.max(1, Math.round(shape.height * scale)),
    );
    sourcePixelByShapeId.set(shape.id, resized.sourcePixels);
    originalBoundsByShapeId.set(shape.id, shape.sourceBounds);
    return resized.shape;
  });
  return { shapes: scaledShapes, sourcePixelByShapeId, originalBoundsByShapeId };
};

function resizeExtractedShape(
  shape: CcExtractedShape,
  width: number,
  height: number,
  fillBounds = false,
): Readonly<{ shape: CcExtractedShape; sourcePixels: Uint32Array }> {
  const size = width * height;
  const mask = new Uint8Array(size);
  const sourcePixels = new Uint32Array(size);
  const channels = {
      paint: new Uint8Array(size),
      gradientId: new Uint8Array(size),
      gradientDefId: new Uint16Array(size),
      speed: new Uint8Array(size),
      flow: new Uint8Array(size),
      phase: new Uint8Array(size),
      alphaMask: shape.channels.alphaMask ? new Uint8Array(size) : undefined,
      softEdgeMask: shape.channels.softEdgeMask ? new Uint8Array(size) : undefined,
  };
  let area = 0;
  let sumX = 0;
  let sumY = 0;
  const nearestVisibleSource = fillBounds
    ? resolveNearestVisibleSourcePixels(shape)
    : null;
  for (let y = 0; y < height; y += 1) {
      const sourceYStart = Math.floor(y * shape.height / height);
      const sourceYEnd = Math.max(sourceYStart + 1, Math.ceil((y + 1) * shape.height / height));
      for (let x = 0; x < width; x += 1) {
        const sourceXStart = Math.floor(x * shape.width / width);
        const sourceXEnd = Math.max(sourceXStart + 1, Math.ceil((x + 1) * shape.width / width));
        let sourceIndex = -1;
        for (let sourceY = sourceYStart; sourceY < sourceYEnd && sourceIndex < 0; sourceY += 1) {
          for (let sourceX = sourceXStart; sourceX < sourceXEnd; sourceX += 1) {
            const candidateIndex = sourceY * shape.width + sourceX;
            if (shape.mask[candidateIndex]) {
              sourceIndex = candidateIndex;
              break;
            }
          }
        }
        if (sourceIndex < 0 && nearestVisibleSource) {
          const centerX = Math.min(shape.width - 1, Math.floor((sourceXStart + sourceXEnd - 1) / 2));
          const centerY = Math.min(shape.height - 1, Math.floor((sourceYStart + sourceYEnd - 1) / 2));
          sourceIndex = nearestVisibleSource[centerY * shape.width + centerX];
        }
        if (sourceIndex < 0) continue;
        const destinationIndex = y * width + x;
        mask[destinationIndex] = 1;
        sourcePixels[destinationIndex] = sourceIndex;
        channels.paint[destinationIndex] = shape.channels.paint[sourceIndex];
        channels.gradientId[destinationIndex] = shape.channels.gradientId[sourceIndex];
        channels.gradientDefId[destinationIndex] = shape.channels.gradientDefId[sourceIndex];
        channels.speed[destinationIndex] = shape.channels.speed[sourceIndex];
        channels.flow[destinationIndex] = shape.channels.flow[sourceIndex];
        channels.phase[destinationIndex] = shape.channels.phase[sourceIndex];
        if (channels.alphaMask && shape.channels.alphaMask) {
          channels.alphaMask[destinationIndex] = shape.channels.alphaMask[sourceIndex];
        }
        if (channels.softEdgeMask && shape.channels.softEdgeMask) {
          channels.softEdgeMask[destinationIndex] = shape.channels.softEdgeMask[sourceIndex];
        }
        area += 1;
        sumX += x;
        sumY += y;
      }
  }
  return {
    sourcePixels,
    shape: {
      ...shape,
      width,
      height,
      area,
      centerOfMass: { x: sumX / area, y: sumY / area },
      mask,
      channels,
    },
  };
}

const resolveNearestVisibleSourcePixels = (shape: CcExtractedShape): Int32Array => {
  const nearest = new Int32Array(shape.mask.length).fill(-1);
  const queue = new Int32Array(shape.mask.length);
  let head = 0;
  let tail = 0;
  shape.mask.forEach((visible, index) => {
    if (!visible) return;
    nearest[index] = index;
    queue[tail] = index;
    tail += 1;
  });
  while (head < tail) {
    const index = queue[head];
    head += 1;
    const x = index % shape.width;
    const y = Math.floor(index / shape.width);
    const left = x > 0 ? index - 1 : -1;
    const right = x + 1 < shape.width ? index + 1 : -1;
    const up = y > 0 ? index - shape.width : -1;
    const down = y + 1 < shape.height ? index + shape.width : -1;
    if (left >= 0 && nearest[left] < 0) {
      nearest[left] = nearest[index];
      queue[tail] = left;
      tail += 1;
    }
    if (right >= 0 && nearest[right] < 0) {
      nearest[right] = nearest[index];
      queue[tail] = right;
      tail += 1;
    }
    if (up >= 0 && nearest[up] < 0) {
      nearest[up] = nearest[index];
      queue[tail] = up;
      tail += 1;
    }
    if (down >= 0 && nearest[down] < 0) {
      nearest[down] = nearest[index];
      queue[tail] = down;
      tail += 1;
    }
  }
  return nearest;
};

const buildScaledPreviewSources = (
  shapes: readonly CcExtractedShape[],
  originalSources: ReadonlyMap<string, PackedPreviewSource>,
  sourcePixelByShapeId: ReadonlyMap<string, Uint32Array>,
  originalBoundsByShapeId: ReadonlyMap<string, CcExtractedShape['sourceBounds']>,
): Map<string, PackedPreviewSource> => {
  if (sourcePixelByShapeId.size === 0) return new Map(originalSources);
  const scaledSources = new Map<string, PackedPreviewSource>();
  for (const [layerId, source] of originalSources) {
    scaledSources.set(layerId, {
      width: source.width,
      height: source.height,
      rgba: new Uint8Array(source.rgba.length),
    });
  }
  for (const shape of shapes) {
    const original = originalSources.get(shape.layerId);
    const sourcePixels = sourcePixelByShapeId.get(shape.id);
    if (!original) continue;
    const originalBounds = originalBoundsByShapeId.get(shape.id) ?? shape.sourceBounds;
    const usesShapeSpecificSource = (
      originalBounds.x !== shape.sourceBounds.x ||
      originalBounds.y !== shape.sourceBounds.y ||
      originalBounds.width !== shape.sourceBounds.width ||
      originalBounds.height !== shape.sourceBounds.height
    );
    const scaled = usesShapeSpecificSource
      ? {
        width: original.width,
        height: original.height,
        rgba: new Uint8Array(original.rgba.length),
      }
      : scaledSources.get(shape.layerId);
    if (!scaled) continue;
    if (usesShapeSpecificSource) scaledSources.set(shape.id, scaled);
    for (let index = 0; index < shape.mask.length; index += 1) {
      if (!shape.mask[index]) continue;
      const originalIndex = sourcePixels?.[index] ?? index;
      const sourceX = originalBounds.x + originalIndex % originalBounds.width;
      const sourceY = originalBounds.y + Math.floor(originalIndex / originalBounds.width);
      const destinationX = shape.sourceBounds.x + index % shape.width;
      const destinationY = shape.sourceBounds.y + Math.floor(index / shape.width);
      const sourceOffset = (sourceY * original.width + sourceX) * 4;
      const destinationOffset = (destinationY * scaled.width + destinationX) * 4;
      scaled.rgba.set(original.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  return scaledSources;
};

const extractRasterShapes = (
  layerId: string,
  source: MaskPayload,
): CcExtractedShape[] => {
  const pixels = source.width * source.height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  const shapes: CcExtractedShape[] = [];
  const isVisible = (index: number): boolean => source.rgba[index * 4 + 3] !== 0;

  for (let start = 0; start < pixels; start += 1) {
    if (visited[start] || !isVisible(start)) continue;
    let head = 0;
    let tail = 1;
    queue[0] = start;
    visited[start] = 1;
    let minX = start % source.width;
    let maxX = minX;
    let minY = Math.floor(start / source.width);
    let maxY = minY;
    let sumX = 0;
    let sumY = 0;

    while (head < tail) {
      const index = queue[head];
      head += 1;
      const x = index % source.width;
      const y = Math.floor(index / source.width);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
      sumX += x;
      sumY += y;
      for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
        const nextY = y + offsetY;
        if (nextY < 0 || nextY >= source.height) continue;
        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          if (offsetX === 0 && offsetY === 0) continue;
          const nextX = x + offsetX;
          if (nextX < 0 || nextX >= source.width) continue;
          const nextIndex = nextY * source.width + nextX;
          if (visited[nextIndex] || !isVisible(nextIndex)) continue;
          visited[nextIndex] = 1;
          queue[tail] = nextIndex;
          tail += 1;
        }
      }
    }

    const width = maxX - minX + 1;
    const height = maxY - minY + 1;
    const mask = new Uint8Array(width * height);
    for (let index = 0; index < tail; index += 1) {
      const sourceIndex = queue[index];
      const x = sourceIndex % source.width;
      const y = Math.floor(sourceIndex / source.width);
      mask[(y - minY) * width + x - minX] = 1;
    }
    const size = width * height;
    shapes.push({
      id: `${layerId}:raster-shape-${shapes.length}`,
      layerId,
      sourceBounds: { x: minX, y: minY, width, height },
      width,
      height,
      area: tail,
      centerOfMass: { x: sumX / tail - minX, y: sumY / tail - minY },
      mask,
      channels: {
        paint: mask.slice(),
        gradientId: new Uint8Array(size),
        gradientDefId: new Uint16Array(size),
        speed: new Uint8Array(size),
        flow: new Uint8Array(size),
        phase: new Uint8Array(size),
      },
    });
  }
  return shapes;
};

const rewritePackedRasterLayer = async (
  rasterLayer: RasterPackingLayer,
  placements: readonly CcPackedShapePlacement[],
  sourcePixelByShapeId: ReadonlyMap<string, Uint32Array>,
): Promise<string> => {
  const { source } = rasterLayer;
  const rgba = new Uint8Array(source.width * source.height * 4);
  for (const placement of placements) {
    if (placement.layerId !== rasterLayer.layer.id) continue;
    const shape = placement.rotated.source;
    for (let index = 0; index < placement.rotated.mask.length; index += 1) {
      if (!placement.rotated.mask[index]) continue;
      const localX = index % placement.rotated.width;
      const localY = Math.floor(index / placement.rotated.width);
      const sourceLocal = sourceCoordinateForRotatedPixel(
        localX,
        localY,
        shape.width,
        shape.height,
        placement.rotation,
      );
      const scaledSourceIndex = sourceLocal.y * shape.width + sourceLocal.x;
      const sourceIndex = sourcePixelByShapeId.get(shape.id)?.[scaledSourceIndex] ?? scaledSourceIndex;
      const sourceX = shape.sourceBounds.x + sourceIndex % shape.sourceBounds.width;
      const sourceY = shape.sourceBounds.y + Math.floor(sourceIndex / shape.sourceBounds.width);
      const destinationX = placement.x + localX;
      const destinationY = placement.y + localY;
      const sourceOffset = (sourceY * source.width + sourceX) * 4;
      const destinationOffset = (destinationY * source.width + destinationX) * 4;
      rgba.set(source.rgba.subarray(sourceOffset, sourceOffset + 4), destinationOffset);
    }
  }
  const png = await sharp(rgba, {
    raw: { width: source.width, height: source.height, channels: 4 },
  }).png().toBuffer();
  return `data:image/png;base64,${png.toString('base64')}`;
};

const selectLayers = (
  archive: VesselProjectArchive,
  selectors: readonly VsArchiveLayerSelector[],
): PersistedColorCycleLayerEnvelope[] => {
  if (selectors.length === 0) {
    throw new CcShapePackingError('missing-layer-selectors', 'At least one selected CC layer is required.');
  }
  const selected: PersistedColorCycleLayerEnvelope[] = [];
  const seen = new Set<string>();
  for (const selector of selectors) {
    let layer: PersistedLayerEnvelope | undefined;
    if (selector.id) {
      layer = archive.project.layers.find((candidate) => candidate.id === selector.id);
    } else if (selector.name) {
      const matches = archive.project.layers.filter((candidate) => candidate.name === selector.name);
      if (matches.length > 1) {
        throw new CcShapePackingError('ambiguous-layer-name', `Layer name "${selector.name}" is not unique; select it by ID.`);
      }
      layer = matches[0];
    }
    if (!layer) throw new CcShapePackingError('missing-selected-layer', 'A selected layer was not found.', { selector });
    if (normalizePersistedLayerType(layer.layerType) !== 'color-cycle' || !layer.colorCycleData) {
      throw new CcShapePackingError('selected-layer-not-color-cycle', `Layer "${layer.name}" is not a CC layer.`);
    }
    if (!seen.has(layer.id)) {
      seen.add(layer.id);
      selected.push(layer as PersistedColorCycleLayerEnvelope);
    }
  }
  return selected;
};

const replaceBinary = (
  zip: JSZip,
  entries: BinaryManifestEntry[],
  ref: string | undefined,
  bytes: Uint8Array,
  width: number,
  height: number,
): void => {
  const path = archivePath(ref);
  if (!path) throw new CcShapePackingError('missing-archive-buffer-ref', 'Cannot replace a missing canonical buffer reference.');
  zip.file(path, bytes);
  const replacement: BinaryManifestEntry = {
    version: 1,
    path,
    checksum: fnv1aHash(bytes),
    byteLength: bytes.byteLength,
    dtype: inferBinaryManifestDType(path),
    width,
    height,
    encoding: 'raw',
    compression: 'deflate',
  };
  const index = entries.findIndex((entry) => entry.path === path);
  if (index >= 0) entries[index] = replacement;
  else entries.push(replacement);
};

const replaceStoredBytes = (
  zip: JSZip,
  entries: BinaryManifestEntry[],
  container: Record<string, unknown>,
  field: string,
  bytes: Uint8Array,
  width: number,
  height: number,
): void => {
  const current = typeof container[field] === 'string' ? container[field] as string : undefined;
  if (archivePath(current)) {
    replaceBinary(zip, entries, current, bytes, width, height);
    return;
  }
  container[field] = Buffer.from(bytes).toString('base64');
};

const replaceTextValue = (
  zip: JSZip,
  entries: BinaryManifestEntry[],
  container: Record<string, unknown>,
  field: string,
  text: string,
): void => {
  const current = container[field];
  const path = typeof current === 'string' ? archivePath(current) : null;
  if (!path) {
    container[field] = text;
    return;
  }
  const bytes = new Uint8Array(Buffer.from(text, 'utf8'));
  zip.file(path, text);
  const replacement: BinaryManifestEntry = {
    version: 1,
    path,
    checksum: fnv1aHash(bytes),
    byteLength: bytes.byteLength,
    dtype: inferBinaryManifestDType(path),
    encoding: 'raw',
    compression: 'deflate',
  };
  const index = entries.findIndex((entry) => entry.path === path);
  if (index >= 0) entries[index] = replacement;
  else entries.push(replacement);
};

export const packVsArchiveColorCycleShapes = async (
  input: Uint8Array,
  options: VsArchivePackingOptions,
): Promise<VsArchivePackingResult> => {
  const zip = await JSZip.loadAsync(input);
  const projectEntry = zip.file(PROJECT_ENTRY);
  if (!projectEntry) throw new CcShapePackingError('missing-project-manifest', 'Project archive is missing project.json.');
  const archive = JSON.parse(await projectEntry.async('string')) as VesselProjectArchive;
  const entries = archive.binaries?.entries ?? [];
  archive.binaries = { entries };
  const manifest = new Map(entries.map((entry) => [entry.path, entry] as const));
  const selected = selectLayers(archive, options.selectors);
  const shouldPreserveSelectedCcLayers = Boolean(options.preserveSelectedCcLayers);
  if (options.autoFitWithoutOverlap && options.shapeScale !== undefined) {
    throw new CcShapePackingError(
      'conflicting-shape-scale',
      'Automatic fitting cannot be combined with an explicit shape scale.',
    );
  }
  if (options.autoFitWithoutOverlap && options.allowOverlap) {
    throw new CcShapePackingError(
      'conflicting-overlap-mode',
      'Automatic fitting requires overlap to remain disabled.',
    );
  }
  const destinationLayer = options.destinationLayerId
    ? selected.find((layer) => layer.id === options.destinationLayerId)
    : selected[0];
  if (!destinationLayer) {
    throw new CcShapePackingError('destination-layer-not-selected', 'The destination CC layer must be selected.');
  }
  if (!shouldPreserveSelectedCcLayers) {
    assertCompatibleCcLayerPresentation(selected, destinationLayer.id);
    assertSelectedLayersAreContiguous(
      archive.project.layers.map((layer) => layer.id),
      selected.map((layer) => layer.id),
    );
  }
  const maskPayloads = new Map<string, { erase: MaskPayload | null; soft: MaskPayload | null }>();
  const renderedPreviewSources = new Map<string, PackedPreviewSource>();
  const ccRenderedPreviewSources = new Map<string, PackedPreviewSource>();
  const packingLayers: CcPackingLayerInput[] = [];
  for (const layer of selected) {
    const state = getState(layer);
    const legacySnapshot = state ? null : getLegacyBrushSnapshot(layer);
    const colorCycleData = layer.colorCycleData as Record<string, unknown>;
    const width = state?.dimensions.width
      ?? legacySnapshot?.dimensions?.width
      ?? (typeof colorCycleData.canvasWidth === 'number' ? colorCycleData.canvasWidth : archive.project.width);
    const height = state?.dimensions.height
      ?? legacySnapshot?.dimensions?.height
      ?? (typeof colorCycleData.canvasHeight === 'number' ? colorCycleData.canvasHeight : archive.project.height);
    if (width !== archive.project.width || height !== archive.project.height) {
      throw new CcShapePackingError('document-canvas-mismatch', `Selected layer "${layer.name}" does not match the project canvas.`);
    }
    const pixels = width * height;
    const strokeData = legacySnapshot?.strokeData;
    const paint = await readStoredBytes(zip, manifest, state?.paintRef ?? strokeData?.paintBuffer, 'paintBuffer');
    const gradientId = await readStoredBytes(
      zip,
      manifest,
      state?.gradientIdRef ?? strokeData?.gradientIdBuffer,
      'gradientIdBuffer',
    );
    const gradientDefBytes = await readStoredBytes(
      zip,
      manifest,
      state?.gradientDefIdRef ?? strokeData?.gradientDefIdBuffer,
      'gradientDefIdBuffer',
    );
    const speed = await readStoredBytes(zip, manifest, state?.speedRef ?? strokeData?.speedBuffer, 'speedBuffer');
    const flow = await readStoredBytes(zip, manifest, state?.flowRef ?? strokeData?.flowBuffer, 'flowBuffer');
    const phaseRef = state?.phaseRef ?? strokeData?.phaseBuffer;
    const phase = phaseRef
      ? await readStoredBytes(zip, manifest, phaseRef, 'phaseBuffer')
      : new Uint8Array(pixels);
    if (
      paint.length !== pixels || gradientId.length !== pixels || speed.length !== pixels ||
      flow.length !== pixels || phase.length !== pixels || gradientDefBytes.length !== pixels * 2
    ) {
      throw new CcShapePackingError('incomplete-color-cycle-document', `Selected layer "${layer.name}" has invalid canonical buffer lengths.`);
    }
    const erase = await decodeMask(await readTextValue(zip, manifest, colorCycleData.eraseMaskImageData));
    const isSoftEdgeMaskEnabled = colorCycleData.softEdgeMaskEnabled !== false;
    const soft = isSoftEdgeMaskEnabled
      ? await decodeMask(await readTextValue(zip, manifest, colorCycleData.softEdgeMaskImageData))
      : null;
    const renderedPreview = await decodeMask(await readTextValue(zip, manifest, colorCycleData.canvasImageData));
    if (renderedPreview && renderedPreview.width === width && renderedPreview.height === height) {
      renderedPreviewSources.set(layer.id, renderedPreview);
      ccRenderedPreviewSources.set(layer.id, renderedPreview);
    }
    maskPayloads.set(layer.id, { erase, soft });
    const gradientDefCopy = gradientDefBytes.slice();
    packingLayers.push({
      layerId: layer.id,
      layerName: layer.name,
      width,
      height,
      channels: {
        paint,
        gradientId,
        gradientDefId: new Uint16Array(gradientDefCopy.buffer),
        speed,
        flow,
        phase,
        alphaMask: maskAlpha(erase, width, height, 'eraseMaskImageData'),
        softEdgeMask: maskAlpha(soft, width, height, 'softEdgeMaskImageData'),
      },
    });
  }

  const rasterPackingLayers: RasterPackingLayer[] = [];
  if (options.includeVisibleRasterLayers) {
    const visibleRasterLayers = archive.project.layers.filter((layer): layer is PersistedNormalLayerEnvelope => (
      layer.visible && normalizePersistedLayerType(layer.layerType) === 'normal'
    ));
    for (const layer of visibleRasterLayers) {
      const state = layer.state && typeof layer.state === 'object'
        ? layer.state as NormalArchiveState
        : null;
      const imageRef = state?.imageRef;
      const imageText = await readTextValue(zip, manifest, imageRef ?? layer.imageDataUrl);
      const source = await decodeMask(imageText);
      if (!source) continue;
      if (source.width !== archive.project.width || source.height !== archive.project.height) {
        throw new CcShapePackingError(
          'document-canvas-mismatch',
          `Visible normal layer "${layer.name}" does not match the project canvas.`,
        );
      }
      const shapes = extractRasterShapes(layer.id, source);
      if (shapes.length === 0) continue;
      renderedPreviewSources.set(layer.id, source);
      rasterPackingLayers.push({
        layer,
        source,
        shapes,
        imageContainer: imageRef
          ? state as Record<string, unknown>
          : layer as unknown as Record<string, unknown>,
        imageField: imageRef ? 'imageRef' : 'imageDataUrl',
      });
    }
  }

  const consolidated = consolidateCcLayerNamespaces(packingLayers);
  const ccShapes = consolidated.layers.flatMap((layer) => extractCcShapes(
    layer,
    {
      splitByGradientDefId: options.splitByGradientDefId,
      ...options.separationByLayerId?.[layer.layerId],
    },
  ));
  const backgroundSourceShape = options.largestCcShapeAsBackground
    ? [...ccShapes].sort((left, right) => right.area - left.area || left.id.localeCompare(right.id))[0]
    : undefined;
  const sourceShapes = [
    ...ccShapes,
    ...rasterPackingLayers.flatMap((layer) => layer.shapes),
  ];
  const packingOptions: FastPackingOptions = {
    canvasWidth: archive.project.width,
    canvasHeight: archive.project.height,
    padding: options.padding,
    rotations: options.rotations,
    beamWidth: options.beamWidth,
    minimumSupportSpanRatio: options.minimumSupportSpanRatio,
    allowNonGravityNesting: options.allowNonGravityNesting,
    allowPartialPreview: options.allowPartialPreview,
    allowOverlap: options.allowOverlap,
  };
  const autoFit = options.autoFitWithoutOverlap
    ? autoFitShapes(
      sourceShapes,
      archive.project.width,
      archive.project.height,
      packingOptions,
    )
    : null;
  const foregroundScaledShapeSet = autoFit?.scaledShapeSet
    ?? scaleExtractedShapes(sourceShapes, options.shapeScale);
  const backgroundResize = backgroundSourceShape
    ? resizeExtractedShape(
      backgroundSourceShape,
      archive.project.width,
      archive.project.height,
      true,
    )
    : null;
  const backgroundShape = backgroundResize
    ? {
      ...backgroundResize.shape,
      id: `${backgroundResize.shape.id}:background-copy`,
      sourceBounds: {
        x: 0,
        y: 0,
        width: archive.project.width,
        height: archive.project.height,
      },
    }
    : null;
  const sourcePixelByShapeId = new Map(foregroundScaledShapeSet.sourcePixelByShapeId);
  const originalBoundsByShapeId = new Map(foregroundScaledShapeSet.originalBoundsByShapeId);
  if (backgroundShape && backgroundResize && backgroundSourceShape) {
    sourcePixelByShapeId.set(backgroundShape.id, backgroundResize.sourcePixels);
    originalBoundsByShapeId.set(backgroundShape.id, backgroundSourceShape.sourceBounds);
  }
  const shapes = [
    ...(backgroundShape ? [backgroundShape] : []),
    ...foregroundScaledShapeSet.shapes,
  ];
  const packingPreviewSources = buildScaledPreviewSources(
    shapes,
    renderedPreviewSources,
    sourcePixelByShapeId,
    originalBoundsByShapeId,
  );
  const ccPackingPreviewSources = buildScaledPreviewSources(
    shapes,
    ccRenderedPreviewSources,
    sourcePixelByShapeId,
    originalBoundsByShapeId,
  );
  const selectedLayerIds = [
    ...selected.map((layer) => layer.id),
    ...rasterPackingLayers.map(({ layer }) => layer.id),
  ];
  const foregroundPacking = autoFit?.packing
    ?? packCcShapes(foregroundScaledShapeSet.shapes, packingOptions);
  const backgroundPlacement: CcPackedShapePlacement | null = backgroundShape
    ? {
      shapeId: backgroundShape.id,
      layerId: backgroundShape.layerId,
      x: 0,
      y: 0,
      rotation: 0,
      rotated: rotateCcShape(backgroundShape, 0),
      supportShapeIds: [],
      supportSpan: archive.project.width,
      stabilityMargin: Number.POSITIVE_INFINITY,
    }
    : null;
  const canvasArea = archive.project.width * archive.project.height;
  const packing: CcShapePackingResult = backgroundPlacement
    ? {
      placements: [backgroundPlacement, ...foregroundPacking.placements],
      metrics: {
        ...foregroundPacking.metrics,
        shapeCount: foregroundPacking.metrics.shapeCount + 1,
        occupiedArea: canvasArea,
        packedHeight: archive.project.height,
        horizontalSpan: archive.project.width,
        boundingWasteArea: 0,
        packingDensity: 1,
      },
    }
    : foregroundPacking;
  const [renderedPreviewPngResult, renderedContactSheetPngResult] = await Promise.all([
    buildRenderedPackingPng(
      packing,
      archive.project.width,
      archive.project.height,
      packingPreviewSources,
    ),
    buildRenderedContactSheetPng(packing, packingPreviewSources),
  ]);
  const renderedPreviewPng = renderedPreviewPngResult ?? undefined;
  const renderedContactSheetPng = renderedContactSheetPngResult ?? undefined;
  const appliedShapeScale = autoFit?.scale ?? options.shapeScale ?? 1;
  const selectedCcLayerIds = new Set(selected.map((layer) => layer.id));
  const ccPlacements = packing.placements.filter((placement) => selectedCcLayerIds.has(placement.layerId));
  const renderedCcPreviewByLayerId = new Map<string, Uint8Array>();
  if (shouldPreserveSelectedCcLayers) {
    await Promise.all(selected.map(async (layer) => {
      const preview = await buildRenderedPackingPng(
        {
          ...packing,
          placements: ccPlacements.filter((placement) => placement.layerId === layer.id),
        },
        archive.project.width,
        archive.project.height,
        ccPackingPreviewSources,
      );
      if (preview) renderedCcPreviewByLayerId.set(layer.id, preview);
    }));
  } else {
    const preview = await buildRenderedPackingPng(
      { ...packing, placements: ccPlacements },
      archive.project.width,
      archive.project.height,
      ccPackingPreviewSources,
    );
    if (preview) renderedCcPreviewByLayerId.set(destinationLayer.id, preview);
  }
  if (!isCompleteCcPacking(shapes, packing)) {
    return {
      archiveData: input,
      packing,
      canvasWidth: archive.project.width,
      canvasHeight: archive.project.height,
      selectedLayerIds,
      sourceShapeCount: shapes.length,
      appliedShapeScale,
      renderedPreviewPng,
      renderedContactSheetPng,
    };
  }
  const rewritten = rewritePackedCcLayers(consolidated.layers, ccPlacements, {
    destinationLayerId: shouldPreserveSelectedCcLayers ? undefined : destinationLayer.id,
    allowOverlap: options.allowOverlap || Boolean(backgroundShape),
  });
  const rewrittenCcLayers = shouldPreserveSelectedCcLayers ? selected : [destinationLayer];
  for (const layer of rewrittenCcLayers) {
    const state = getState(layer);
    const legacySnapshot = state ? null : getLegacyBrushSnapshot(layer);
    const next = rewritten.get(layer.id);
    if (!next) throw new CcShapePackingError('missing-packed-layer', `Selected layer "${layer.name}" was not rewritten.`);
    const colorCycleData = layer.colorCycleData as Record<string, unknown>;
    const width = state?.dimensions.width ?? archive.project.width;
    const height = state?.dimensions.height ?? archive.project.height;
    const gradientDefBytes = new Uint8Array(
      next.gradientDefId.buffer,
      next.gradientDefId.byteOffset,
      next.gradientDefId.byteLength,
    );
    if (state) {
      replaceBinary(zip, entries, state.paintRef, next.paint, width, height);
      replaceBinary(zip, entries, state.gradientIdRef, next.gradientId, width, height);
      replaceBinary(zip, entries, state.gradientDefIdRef, gradientDefBytes, width, height);
      replaceBinary(zip, entries, state.speedRef, next.speed, width, height);
      replaceBinary(zip, entries, state.flowRef, next.flow, width, height);
      replaceBinary(zip, entries, state.phaseRef, next.phase, width, height);
      state.hasContent = next.paint.some((value) => value !== 0);
    } else if (legacySnapshot?.strokeData) {
      const strokeData = legacySnapshot.strokeData as Record<string, unknown>;
      replaceStoredBytes(zip, entries, strokeData, 'paintBuffer', next.paint, width, height);
      replaceStoredBytes(zip, entries, strokeData, 'gradientIdBuffer', next.gradientId, width, height);
      replaceStoredBytes(zip, entries, strokeData, 'gradientDefIdBuffer', gradientDefBytes, width, height);
      replaceStoredBytes(zip, entries, strokeData, 'speedBuffer', next.speed, width, height);
      replaceStoredBytes(zip, entries, strokeData, 'flowBuffer', next.flow, width, height);
      replaceStoredBytes(zip, entries, strokeData, 'phaseBuffer', next.phase, width, height);
      strokeData.hasContent = next.paint.some((value) => value !== 0);

      const animatorIndex = legacySnapshot.animator?.indexBuffer as Record<string, unknown> | undefined;
      if (animatorIndex) {
        replaceStoredBytes(zip, entries, animatorIndex, 'data', next.paint, width, height);
        replaceStoredBytes(zip, entries, animatorIndex, 'gradientId', next.gradientId, width, height);
        replaceStoredBytes(zip, entries, animatorIndex, 'speedData', next.speed, width, height);
        replaceStoredBytes(zip, entries, animatorIndex, 'flowData', next.flow, width, height);
        replaceStoredBytes(zip, entries, animatorIndex, 'phaseData', next.phase, width, height);
      }
      replaceStoredBytes(zip, entries, colorCycleData, 'gradientIdBuffer', next.gradientId, width, height);
      replaceStoredBytes(zip, entries, colorCycleData, 'gradientDefIdBuffer', gradientDefBytes, width, height);
    }
    const masks = maskPayloads.get(layer.id);
    if (next.alphaMask) {
      const erase = masks?.erase ?? { width, height, rgba: new Uint8Array(width * height * 4) };
      replaceTextValue(zip, entries, colorCycleData, 'eraseMaskImageData', applyMaskAlpha(erase, next.alphaMask));
    }
    if (next.softEdgeMask) {
      const soft = masks?.soft ?? { width, height, rgba: new Uint8Array(width * height * 4) };
      replaceTextValue(zip, entries, colorCycleData, 'softEdgeMaskImageData', applyMaskAlpha(soft, next.softEdgeMask));
    }
    const renderedCcPreviewPng = renderedCcPreviewByLayerId.get(layer.id);
    if (renderedCcPreviewPng) {
      replaceTextValue(
        zip,
        entries,
        colorCycleData,
        'canvasImageData',
        `data:image/png;base64,${Buffer.from(renderedCcPreviewPng).toString('base64')}`,
      );
    } else {
      delete colorCycleData.canvasImageData;
    }
  }

  const rewrittenRasterImages = await Promise.all(rasterPackingLayers.map(async (rasterLayer) => ({
    rasterLayer,
    imageDataUrl: await rewritePackedRasterLayer(
      rasterLayer,
      packing.placements,
      sourcePixelByShapeId,
    ),
  })));
  for (const { rasterLayer, imageDataUrl } of rewrittenRasterImages) {
    replaceTextValue(
      zip,
      entries,
      rasterLayer.imageContainer,
      rasterLayer.imageField,
      imageDataUrl,
    );
  }

  const metadataSources = selected.map((layer) => ({
    layerId: layer.id,
    metadata: (getState(layer) ?? layer.colorCycleData) as Record<string, unknown>,
  }));
  const mergedMetadata = mergeColorCycleMetadata(metadataSources, consolidated.remap);
  const destinationColorCycleData = destinationLayer.colorCycleData as Record<string, unknown>;
  const destinationState = getState(destinationLayer);
  if (shouldPreserveSelectedCcLayers) {
    for (const layer of selected) {
      const state = getState(layer);
      const colorCycleData = layer.colorCycleData as Record<string, unknown>;
      if (state) {
        applyMergedColorCycleMetadata(state, mergedMetadata);
      } else {
        applyMergedColorCycleMetadata(colorCycleData, mergedMetadata);
        applyMergedColorCycleMetadata(getLegacyBrushSnapshot(layer), mergedMetadata);
      }
    }
  } else if (destinationState) {
    applyMergedColorCycleMetadata(destinationState, mergedMetadata);
  } else {
    applyMergedColorCycleMetadata(destinationColorCycleData, mergedMetadata);
    applyMergedColorCycleMetadata(getLegacyBrushSnapshot(destinationLayer), mergedMetadata);
  }
  const removedLayerIds = new Set(shouldPreserveSelectedCcLayers
    ? []
    : selected.filter((layer) => layer.id !== destinationLayer.id).map((layer) => layer.id));
  archive.project.layers = archive.project.layers.filter((layer) => !removedLayerIds.has(layer.id));
  if (backgroundShape) {
    const backgroundLayerId = shouldPreserveSelectedCcLayers
      ? backgroundShape.layerId
      : destinationLayer.id;
    const backgroundLayer = archive.project.layers.find((layer) => layer.id === backgroundLayerId);
    if (backgroundLayer) {
      const orderedLayers = [
        backgroundLayer,
        ...archive.project.layers
          .filter((layer) => layer.id !== backgroundLayer.id)
          .sort((left, right) => left.order - right.order),
      ];
      orderedLayers.forEach((layer, index) => {
        layer.order = index;
      });
      archive.project.layers = orderedLayers;
    }
  }

  const now = new Date().toISOString();
  archive.metadata.modified = now;
  zip.file(PROJECT_ENTRY, JSON.stringify(archive));
  const previewEntry = zip.file(PREVIEW_ENTRY);
  if (previewEntry) {
    const preview = JSON.parse(await previewEntry.async('string')) as Record<string, unknown>;
    const metadata = preview.metadata;
    if (metadata && typeof metadata === 'object') (metadata as Record<string, unknown>).modified = now;
    delete preview.preview;
    zip.file(PREVIEW_ENTRY, JSON.stringify(preview));
  }
  const archiveData = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
    compressionOptions: { level: 9 },
  });
  return {
    archiveData,
    packing,
    canvasWidth: archive.project.width,
    canvasHeight: archive.project.height,
    selectedLayerIds,
    sourceShapeCount: shapes.length,
    appliedShapeScale,
    renderedPreviewPng,
    renderedContactSheetPng,
  };
};
