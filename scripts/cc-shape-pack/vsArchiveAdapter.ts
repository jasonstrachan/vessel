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
  rewritePackedCcLayers,
  type CcPackingLayerInput,
  type CcQuarterTurn,
  type CcShapePackingResult,
  type CcShapeSeparationOverride,
} from '@/lib/colorCycle/shapePacking';
import type {
  BinaryManifestEntry,
  PersistedColorCycleLayerEnvelope,
  PersistedLayerEnvelope,
  VesselProjectArchive,
} from '@/utils/projectPersistence';
import { buildRenderedPackingPng, type PackedPreviewSource } from './diagnostics';

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
}>;

export type VsArchivePackingResult = Readonly<{
  archiveData: Uint8Array;
  packing: CcShapePackingResult;
  canvasWidth: number;
  canvasHeight: number;
  selectedLayerIds: readonly string[];
  sourceShapeCount: number;
  renderedPreviewPng?: Uint8Array;
}>;

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
  const bytes = new TextEncoder().encode(text);
  zip.file(path, bytes);
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
  const destinationLayer = options.destinationLayerId
    ? selected.find((layer) => layer.id === options.destinationLayerId)
    : selected[0];
  if (!destinationLayer) {
    throw new CcShapePackingError('destination-layer-not-selected', 'The destination CC layer must be selected.');
  }
  assertCompatibleCcLayerPresentation(selected, destinationLayer.id);
  assertSelectedLayersAreContiguous(
    archive.project.layers.map((layer) => layer.id),
    selected.map((layer) => layer.id),
  );
  const maskPayloads = new Map<string, { erase: MaskPayload | null; soft: MaskPayload | null }>();
  const renderedPreviewSources = new Map<string, PackedPreviewSource>();
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

  const consolidated = consolidateCcLayerNamespaces(packingLayers);
  const shapes = consolidated.layers.flatMap((layer) => extractCcShapes(
    layer,
    {
      splitByGradientDefId: options.splitByGradientDefId,
      ...options.separationByLayerId?.[layer.layerId],
    },
  ));
  const packing = packCcShapes(shapes, {
    canvasWidth: archive.project.width,
    canvasHeight: archive.project.height,
    padding: options.padding,
    rotations: options.rotations,
    beamWidth: options.beamWidth,
    minimumSupportSpanRatio: options.minimumSupportSpanRatio,
    allowNonGravityNesting: options.allowNonGravityNesting,
    allowPartialPreview: options.allowPartialPreview,
    allowOverlap: options.allowOverlap,
  });
  if (!isCompleteCcPacking(shapes, packing)) {
    return {
      archiveData: input,
      packing,
      canvasWidth: archive.project.width,
      canvasHeight: archive.project.height,
      selectedLayerIds: selected.map((layer) => layer.id),
      sourceShapeCount: shapes.length,
      renderedPreviewPng: await buildRenderedPackingPng(
        packing,
        archive.project.width,
        archive.project.height,
        renderedPreviewSources,
      ) ?? undefined,
    };
  }
  const rewritten = rewritePackedCcLayers(consolidated.layers, packing.placements, {
    destinationLayerId: destinationLayer.id,
    allowOverlap: options.allowOverlap,
  });
  for (const layer of [destinationLayer]) {
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
    delete colorCycleData.canvasImageData;
  }

  const metadataSources = selected.map((layer) => ({
    layerId: layer.id,
    metadata: (getState(layer) ?? layer.colorCycleData) as Record<string, unknown>,
  }));
  const mergedMetadata = mergeColorCycleMetadata(metadataSources, consolidated.remap);
  const destinationColorCycleData = destinationLayer.colorCycleData as Record<string, unknown>;
  const destinationState = getState(destinationLayer);
  if (destinationState) {
    applyMergedColorCycleMetadata(destinationState, mergedMetadata);
  } else {
    applyMergedColorCycleMetadata(destinationColorCycleData, mergedMetadata);
    applyMergedColorCycleMetadata(getLegacyBrushSnapshot(destinationLayer), mergedMetadata);
  }
  const removedLayerIds = new Set(selected.filter((layer) => layer.id !== destinationLayer.id).map((layer) => layer.id));
  archive.project.layers = archive.project.layers.filter((layer) => !removedLayerIds.has(layer.id));

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
    selectedLayerIds: selected.map((layer) => layer.id),
    sourceShapeCount: shapes.length,
    renderedPreviewPng: await buildRenderedPackingPng(
      packing,
      archive.project.width,
      archive.project.height,
      renderedPreviewSources,
    ) ?? undefined,
  };
};
