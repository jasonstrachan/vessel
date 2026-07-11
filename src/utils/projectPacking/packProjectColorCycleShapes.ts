import type { Project } from '@/types';
import type { ColorCycleLayerDocumentSnapshot, ColorCycleLayerDocumentState } from '@/lib/colorCycle/document';
import {
  CcShapePackingError,
  assertCompleteCcPacking,
  assertCompatibleCcLayerPresentation,
  assertSelectedLayersAreContiguous,
  consolidateCcLayerNamespaces,
  extractCcShapes,
  packCcShapes,
  mergeColorCycleMetadata,
  rewritePackedCcLayers,
  type CcExtractedShape,
  type CcLayerNamespaceRemap,
  type CcPackingLayerInput,
  type CcQuarterTurn,
  type CcShapePackingResult,
  type CcShapeSeparationOverride,
} from '@/lib/colorCycle/shapePacking';
import { resolvePackingLayers, type CcPackingLayerSelector } from './resolvePackingLayers';

export type ProjectCcShapePackingOptions = Readonly<{
  selectors: readonly CcPackingLayerSelector[];
  destinationLayerId?: string;
  separationByLayerId?: Readonly<Record<string, CcShapeSeparationOverride>>;
  padding?: number;
  rotations?: readonly CcQuarterTurn[];
  beamWidth?: number;
  minimumSupportSpanRatio?: number;
  allowNonGravityNesting?: boolean;
  allowPartialPreview?: boolean;
  allowOverlap?: boolean;
}>;

export type ProjectCcShapePackingPlan = Readonly<{
  selectedLayerIds: readonly string[];
  destinationLayerId: string;
  removedSourceLayerIds: readonly string[];
  namespaceRemap: CcLayerNamespaceRemap;
  shapes: readonly CcExtractedShape[];
  packing: CcShapePackingResult;
  nextDocumentStates: ReadonlyMap<string, ColorCycleLayerDocumentState>;
  nextEraseMaskAlphaByLayerId: ReadonlyMap<string, Uint8Array>;
  nextSoftEdgeMaskAlphaByLayerId: ReadonlyMap<string, Uint8Array>;
}>;

export type ReadColorCycleDocumentSnapshot = (layerId: string) => ColorCycleLayerDocumentSnapshot | null;

const requiredByteBuffer = (
  buffer: ArrayBuffer | undefined,
  expectedLength: number,
  layerId: string,
  field: string,
): Uint8Array => {
  if (!buffer || buffer.byteLength !== expectedLength) {
    throw new CcShapePackingError('incomplete-color-cycle-document', `${field} is missing or has the wrong length.`, {
      layerId,
      field,
      expectedLength,
      actualLength: buffer?.byteLength ?? 0,
    });
  }
  return new Uint8Array(buffer);
};

const requiredUint16Buffer = (
  buffer: ArrayBuffer | undefined,
  expectedLength: number,
  layerId: string,
  field: string,
): Uint16Array => {
  if (!buffer || buffer.byteLength !== expectedLength * Uint16Array.BYTES_PER_ELEMENT) {
    throw new CcShapePackingError('incomplete-color-cycle-document', `${field} is missing or has the wrong length.`, {
      layerId,
      field,
      expectedLength: expectedLength * Uint16Array.BYTES_PER_ELEMENT,
      actualLength: buffer?.byteLength ?? 0,
    });
  }
  return new Uint16Array(buffer);
};

const imageDataAlpha = (
  imageData: ImageData | undefined,
  width: number,
  height: number,
  layerId: string,
  field: string,
): Uint8Array | undefined => {
  if (!imageData) return undefined;
  if (imageData.width !== width || imageData.height !== height) {
    throw new CcShapePackingError('invalid-mask-dimensions', `${field} dimensions do not match the CC document.`, {
      layerId,
      field,
      expected: { width, height },
      actual: { width: imageData.width, height: imageData.height },
    });
  }
  const alpha = new Uint8Array(width * height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = imageData.data[index * 4 + 3] ?? 0;
  }
  return alpha;
};

const toPackingLayer = (
  layerId: string,
  layerName: string,
  snapshot: ColorCycleLayerDocumentSnapshot,
  eraseMaskImageData?: ImageData,
  softEdgeMaskImageData?: ImageData,
): CcPackingLayerInput => {
  const pixels = snapshot.width * snapshot.height;
  return {
    layerId,
    layerName,
    width: snapshot.width,
    height: snapshot.height,
    channels: {
      paint: requiredByteBuffer(snapshot.paintBuffer, pixels, layerId, 'paintBuffer'),
      gradientId: requiredByteBuffer(snapshot.gradientIdBuffer, pixels, layerId, 'gradientIdBuffer'),
      gradientDefId: requiredUint16Buffer(snapshot.gradientDefIdBuffer, pixels, layerId, 'gradientDefIdBuffer'),
      speed: requiredByteBuffer(snapshot.speedBuffer, pixels, layerId, 'speedBuffer'),
      flow: requiredByteBuffer(snapshot.flowBuffer, pixels, layerId, 'flowBuffer'),
      phase: requiredByteBuffer(snapshot.phaseBuffer, pixels, layerId, 'phaseBuffer'),
      alphaMask: imageDataAlpha(eraseMaskImageData, snapshot.width, snapshot.height, layerId, 'eraseMaskImageData'),
      softEdgeMask: imageDataAlpha(softEdgeMaskImageData, snapshot.width, snapshot.height, layerId, 'softEdgeMaskImageData'),
    },
  };
};

const exactArrayBuffer = (view: Uint8Array | Uint16Array): ArrayBuffer =>
  view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;

export const planProjectColorCycleShapePacking = (
  project: Pick<Project, 'width' | 'height' | 'layers'>,
  options: ProjectCcShapePackingOptions,
  readSnapshot: ReadColorCycleDocumentSnapshot,
): ProjectCcShapePackingPlan => {
  const selectedLayers = resolvePackingLayers(project, options.selectors);
  const destinationLayer = options.destinationLayerId
    ? selectedLayers.find((layer) => layer.id === options.destinationLayerId)
    : selectedLayers[0];
  if (!destinationLayer) {
    throw new CcShapePackingError('destination-layer-not-selected', 'The destination CC layer must be one of the selected layers.', {
      destinationLayerId: options.destinationLayerId,
    });
  }
  assertCompatibleCcLayerPresentation(selectedLayers, destinationLayer.id);
  assertSelectedLayersAreContiguous(
    project.layers.map((layer) => layer.id),
    selectedLayers.map((layer) => layer.id),
  );
  const originalSnapshots = new Map<string, ColorCycleLayerDocumentSnapshot>();
  const packingLayers = selectedLayers.map((layer) => {
    const snapshot = readSnapshot(layer.id);
    if (!snapshot) {
      throw new CcShapePackingError('missing-color-cycle-document', `Selected layer "${layer.name}" has no canonical CC document.`, {
        layerId: layer.id,
        layerName: layer.name,
      });
    }
    if (snapshot.width !== project.width || snapshot.height !== project.height) {
      throw new CcShapePackingError('document-canvas-mismatch', 'Selected CC document dimensions must match the project canvas.', {
        layerId: layer.id,
        document: { width: snapshot.width, height: snapshot.height },
        project: { width: project.width, height: project.height },
      });
    }
    originalSnapshots.set(layer.id, snapshot);
    return toPackingLayer(
      layer.id,
      layer.name,
      snapshot,
      layer.colorCycleData?.eraseMaskImageData,
      layer.colorCycleData?.softEdgeMaskEnabled === false
        ? undefined
        : layer.colorCycleData?.softEdgeMaskImageData,
    );
  });
  const consolidated = consolidateCcLayerNamespaces(packingLayers);
  const mergedMetadata = mergeColorCycleMetadata(
    selectedLayers.map((layer) => ({
      layerId: layer.id,
      metadata: originalSnapshots.get(layer.id) as unknown as Record<string, unknown>,
    })),
    consolidated.remap,
  );
  const shapes = consolidated.layers.flatMap((layer) => extractCcShapes(
    layer,
    options.separationByLayerId?.[layer.layerId],
  ));
  const packing = packCcShapes(shapes, {
    canvasWidth: project.width,
    canvasHeight: project.height,
    padding: options.padding,
    rotations: options.rotations,
    beamWidth: options.beamWidth,
    minimumSupportSpanRatio: options.minimumSupportSpanRatio,
    allowNonGravityNesting: options.allowNonGravityNesting,
    allowPartialPreview: options.allowPartialPreview,
    allowOverlap: options.allowOverlap,
  });
  assertCompleteCcPacking(shapes, packing);
  const rewritten = rewritePackedCcLayers(consolidated.layers, packing.placements, {
    destinationLayerId: destinationLayer.id,
    allowOverlap: options.allowOverlap,
  });
  const nextDocumentStates = new Map<string, ColorCycleLayerDocumentState>();
  const nextEraseMaskAlphaByLayerId = new Map<string, Uint8Array>();
  const nextSoftEdgeMaskAlphaByLayerId = new Map<string, Uint8Array>();
  [destinationLayer].forEach((layer) => {
    const original = originalSnapshots.get(layer.id);
    const next = rewritten.get(destinationLayer.id);
    if (!original || !next) {
      throw new CcShapePackingError('missing-packed-layer', 'Selected layer was omitted from the packed rewrite.', {
        layerId: layer.id,
      });
    }
    nextDocumentStates.set(layer.id, {
      ...original,
      paintBuffer: exactArrayBuffer(next.paint),
      gradientIdBuffer: exactArrayBuffer(next.gradientId),
      gradientDefIdBuffer: exactArrayBuffer(next.gradientDefId),
      speedBuffer: exactArrayBuffer(next.speed),
      flowBuffer: exactArrayBuffer(next.flow),
      phaseBuffer: exactArrayBuffer(next.phase),
      slotPalettes: mergedMetadata.slotPalettes as unknown as ColorCycleLayerDocumentState['slotPalettes'],
      gradientDefStore: mergedMetadata.gradientDefStore as unknown as ColorCycleLayerDocumentState['gradientDefStore'],
      hasContent: next.paint.some((value) => value !== 0),
      sources: { ...original.sources },
    });
    if (next.alphaMask) nextEraseMaskAlphaByLayerId.set(layer.id, next.alphaMask);
    if (next.softEdgeMask) nextSoftEdgeMaskAlphaByLayerId.set(layer.id, next.softEdgeMask);
  });
  return {
    selectedLayerIds: selectedLayers.map((layer) => layer.id),
    destinationLayerId: destinationLayer.id,
    removedSourceLayerIds: selectedLayers.filter((layer) => layer.id !== destinationLayer.id).map((layer) => layer.id),
    namespaceRemap: consolidated.remap,
    shapes,
    packing,
    nextDocumentStates,
    nextEraseMaskAlphaByLayerId,
    nextSoftEdgeMaskAlphaByLayerId,
  };
};
