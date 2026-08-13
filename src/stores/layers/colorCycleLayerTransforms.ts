import type { ColorCycleBrushLayerSnapshot } from '@/lib/colorCycle/document';
import { AUTHORED_SPEED_SOURCE_VERSION } from '@/lib/colorCycle/persistence/colorCyclePersistenceTypes';
import type { Layer } from '@/types';

import {
  extractTransferredColorCycleGradientDefs,
  extractTransferredColorCycleSlotPalettes,
  mergeTransferredColorCycleGradientDefs,
  mergeTransferredColorCycleSlotPalettes,
} from '@/stores/helpers/colorCycleGradientDefTransfer';
import { cloneColorCycleData } from '@/stores/layers/layerColorCycleState';

export type ColorCycleLayerMergeSource = {
  layer: Layer;
  snapshot: ColorCycleBrushLayerSnapshot;
  renderedImageData: ImageData;
};

export type ColorCycleLayerMergeResult = {
  layer: Layer;
  snapshot: ColorCycleBrushLayerSnapshot;
};

export const bakeColorCycleLayerMasks = ({
  layer,
  sourceCanvas,
  createCanvas,
}: {
  layer: Layer;
  sourceCanvas: HTMLCanvasElement | OffscreenCanvas;
  createCanvas: (width: number, height: number) => HTMLCanvasElement | OffscreenCanvas | null;
}): HTMLCanvasElement | OffscreenCanvas | null => {
  const colorCycleData = layer.colorCycleData;
  const createCanvasFromImageData = (
    imageData: ImageData | null | undefined,
  ): HTMLCanvasElement | OffscreenCanvas | null => {
    if (!imageData) {
      return null;
    }
    const canvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
    const context = canvas?.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings,
    ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!canvas || !context) {
      return null;
    }
    try {
      context.clearRect(0, 0, canvas.width, canvas.height);
      context.putImageData(imageData, 0, 0);
    } catch {
      return null;
    }
    return canvas;
  };

  const hasEraseMask = Boolean(colorCycleData?.eraseMask || colorCycleData?.eraseMaskImageData);
  const hasEnabledSoftEdgeMask = colorCycleData?.softEdgeMaskEnabled !== false
    && Boolean(colorCycleData?.softEdgeMask || colorCycleData?.softEdgeMaskImageData);
  if (!hasEraseMask && !hasEnabledSoftEdgeMask) {
    return sourceCanvas;
  }

  const eraseMask = hasEraseMask
    ? colorCycleData?.eraseMask ?? createCanvasFromImageData(colorCycleData?.eraseMaskImageData)
    : null;
  const softEdgeMask = hasEnabledSoftEdgeMask
    ? colorCycleData?.softEdgeMask ?? createCanvasFromImageData(colorCycleData?.softEdgeMaskImageData)
    : null;
  if (
    (hasEraseMask && !eraseMask)
    || (hasEnabledSoftEdgeMask && !softEdgeMask)
  ) {
    return null;
  }

  const maskedCanvas = createCanvas(sourceCanvas.width, sourceCanvas.height);
  const maskedContext = maskedCanvas?.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings,
  ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!maskedCanvas || !maskedContext) {
    return null;
  }

  try {
    maskedContext.clearRect(0, 0, maskedCanvas.width, maskedCanvas.height);
    maskedContext.drawImage(sourceCanvas as CanvasImageSource, 0, 0);
    if (eraseMask) {
      maskedContext.save();
      maskedContext.globalCompositeOperation = 'destination-out';
      maskedContext.globalAlpha = 1;
      maskedContext.drawImage(eraseMask as CanvasImageSource, 0, 0);
      maskedContext.restore();
    }
    if (hasEnabledSoftEdgeMask && softEdgeMask) {
      maskedContext.save();
      maskedContext.globalCompositeOperation = 'destination-in';
      maskedContext.globalAlpha = 1;
      maskedContext.drawImage(softEdgeMask as CanvasImageSource, 0, 0);
      maskedContext.restore();
    }
  } catch {
    return null;
  }
  return maskedCanvas;
};

const hasExactLength = (
  buffer: ArrayBuffer | undefined,
  expectedByteLength: number,
): buffer is ArrayBuffer => Boolean(buffer && buffer.byteLength === expectedByteLength);

type ColorCycleStops = Array<{
  position: number;
  color: string;
  opacity?: number;
}>;

const stopsSignature = (stops: ColorCycleStops): string => JSON.stringify(
  stops.map((stop) => ({
    position: stop.position,
    color: stop.color,
    opacity: Number.isFinite(stop.opacity) ? stop.opacity : 1,
  })),
);

const paletteSignature = (
  palette: NonNullable<NonNullable<Layer['colorCycleData']>['slotPalettes']>[number],
): string => JSON.stringify({
  stops: stopsSignature(palette.stops),
  seamProfile: palette.seamProfile ?? 'hard',
});

const gradientDefSignature = (
  definition: NonNullable<NonNullable<Layer['colorCycleData']>['gradientDefStore']>[number],
): string => JSON.stringify({
  kind: definition.kind,
  stops: stopsSignature(definition.stops),
  sourceStops: definition.sourceStops ? stopsSignature(definition.sourceStops) : null,
  seamProfile: definition.seamProfile ?? 'hard',
  speedCps: definition.speedCps ?? null,
});

const hasResolvablePaintMetadata = (
  layer: Layer,
  snapshot: ColorCycleBrushLayerSnapshot,
): boolean => {
  const paint = new Uint8Array(snapshot.paintBuffer);
  const gradientIds = new Uint8Array(snapshot.gradientIdBuffer as ArrayBuffer);
  const gradientDefIds = new Uint16Array(snapshot.gradientDefIdBuffer as ArrayBuffer);
  const palettesBySlot = new Map(
    (layer.colorCycleData?.slotPalettes ?? []).map((entry) => [entry.slot, entry]),
  );
  const definitionsById = new Map(
    (layer.colorCycleData?.gradientDefStore ?? []).map((entry) => [entry.id, entry]),
  );

  for (let pixelIndex = 0; pixelIndex < paint.length; pixelIndex += 1) {
    if ((paint[pixelIndex] ?? 0) === 0) {
      continue;
    }
    const definitionId = gradientDefIds[pixelIndex] ?? 0;
    if (definitionId > 0) {
      if (!definitionsById.has(definitionId)) {
        return false;
      }
      continue;
    }
    if (!palettesBySlot.has(gradientIds[pixelIndex] ?? 0)) {
      return false;
    }
  }
  return true;
};

const transferredPaintMetadataMatches = ({
  sourceLayer,
  targetLayer,
  sourcePaint,
  sourceGradientIds,
  sourceGradientDefIds,
  targetGradientIds,
  targetGradientDefIds,
}: {
  sourceLayer: Layer;
  targetLayer: Layer;
  sourcePaint: Uint8Array;
  sourceGradientIds: Uint8Array;
  sourceGradientDefIds: Uint16Array;
  targetGradientIds: Uint8Array;
  targetGradientDefIds: Uint16Array;
}): boolean => {
  const sourcePalettes = new Map(
    (sourceLayer.colorCycleData?.slotPalettes ?? []).map((entry) => [entry.slot, entry]),
  );
  const targetPalettes = new Map(
    (targetLayer.colorCycleData?.slotPalettes ?? []).map((entry) => [entry.slot, entry]),
  );
  const sourceDefinitions = new Map(
    (sourceLayer.colorCycleData?.gradientDefStore ?? []).map((entry) => [entry.id, entry]),
  );
  const targetDefinitions = new Map(
    (targetLayer.colorCycleData?.gradientDefStore ?? []).map((entry) => [entry.id, entry]),
  );

  for (let pixelIndex = 0; pixelIndex < sourcePaint.length; pixelIndex += 1) {
    if ((sourcePaint[pixelIndex] ?? 0) === 0) {
      continue;
    }
    const sourceDefinitionId = sourceGradientDefIds[pixelIndex] ?? 0;
    const targetDefinitionId = targetGradientDefIds[pixelIndex] ?? 0;
    if (sourceDefinitionId > 0) {
      const sourceDefinition = sourceDefinitions.get(sourceDefinitionId);
      const targetDefinition = targetDefinitions.get(targetDefinitionId);
      if (
        !sourceDefinition ||
        !targetDefinition ||
        gradientDefSignature(sourceDefinition) !== gradientDefSignature(targetDefinition)
      ) {
        return false;
      }
      continue;
    }

    const sourcePalette = sourcePalettes.get(sourceGradientIds[pixelIndex] ?? 0);
    const targetPalette = targetPalettes.get(targetGradientIds[pixelIndex] ?? 0);
    if (
      !sourcePalette ||
      !targetPalette ||
      paletteSignature(sourcePalette) !== paletteSignature(targetPalette)
    ) {
      return false;
    }
  }
  return true;
};

const eraseMaskHasContent = (layer: Layer): boolean => {
  const eraseMask = layer.colorCycleData?.eraseMask;
  let imageData = layer.colorCycleData?.eraseMaskImageData;
  if (eraseMask) {
    try {
      const context = eraseMask.getContext(
        '2d',
        { willReadFrequently: true } as CanvasRenderingContext2DSettings,
      ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
      if (!context) {
        return true;
      }
      imageData = context.getImageData(0, 0, eraseMask.width, eraseMask.height);
    } catch {
      return true;
    }
  }
  if (!imageData) {
    return false;
  }
  for (let index = 3; index < imageData.data.length; index += 4) {
    if ((imageData.data[index] ?? 0) > 0) {
      return true;
    }
  }
  return false;
};

const hasLosslessLayerSettings = (layer: Layer): boolean => {
  const colorCycleData = layer.colorCycleData;
  const hasEraseMask = eraseMaskHasContent(layer);
  const hasEnabledSoftEdgeMask = colorCycleData?.softEdgeMaskEnabled !== false
    && Boolean(
      colorCycleData?.softEdgeMaskImageData
      || (colorCycleData?.softEdgeMask && (colorCycleData.softEdgeMaskVersion ?? 0) > 0),
  );
  return (
    layer.visible
    && layer.opacity === 1
    && layer.blendMode === 'source-over'
    && !hasEraseMask
    && !hasEnabledSoftEdgeMask
  );
};

const isValidSource = (
  source: ColorCycleLayerMergeSource,
  width: number,
  height: number,
): boolean => {
  const pixelCount = width * height;
  return (
    source.layer.layerType === 'color-cycle' &&
    Boolean(source.layer.colorCycleData) &&
    source.renderedImageData.width === width &&
    source.renderedImageData.height === height &&
    hasLosslessLayerSettings(source.layer) &&
    source.snapshot.paintBuffer.byteLength === pixelCount &&
    hasExactLength(source.snapshot.gradientIdBuffer, pixelCount) &&
    hasExactLength(source.snapshot.gradientDefIdBuffer, pixelCount * Uint16Array.BYTES_PER_ELEMENT) &&
    hasExactLength(source.snapshot.speedBuffer, pixelCount) &&
    hasExactLength(source.snapshot.flowBuffer, pixelCount) &&
    hasExactLength(source.snapshot.phaseBuffer, pixelCount) &&
    hasResolvablePaintMetadata(source.layer, source.snapshot)
  );
};

const hasDisjointCanonicalPaint = (
  sources: ColorCycleLayerMergeSource[],
  pixelCount: number,
): boolean => {
  const paintBuffers = sources.map((source) => new Uint8Array(source.snapshot.paintBuffer));
  for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
    let paintedSourceCount = 0;
    for (const paint of paintBuffers) {
      if ((paint[pixelIndex] ?? 0) === 0) {
        continue;
      }
      paintedSourceCount += 1;
      if (paintedSourceCount > 1) {
        return false;
      }
    }
  }
  return true;
};

const hasUniformPlaybackState = (sources: ColorCycleLayerMergeSource[]): boolean => {
  const firstPlaybackState = Boolean(sources[0]?.layer.colorCycleData?.isAnimating);
  return sources.every((source) => (
    Boolean(source.layer.colorCycleData?.isAnimating) === firstPlaybackState
  ));
};

export const mergeColorCycleLayerPayloads = ({
  sources,
  targetLayerId,
  width,
  height,
}: {
  sources: ColorCycleLayerMergeSource[];
  targetLayerId: string;
  width: number;
  height: number;
}): ColorCycleLayerMergeResult | null => {
  if (
    sources.length < 2 ||
    width <= 0 ||
    height <= 0 ||
    sources.some((source) => !isValidSource(source, width, height)) ||
    !hasUniformPlaybackState(sources) ||
    !hasDisjointCanonicalPaint(sources, width * height)
  ) {
    return null;
  }

  const pixelCount = width * height;
  const paint = new Uint8Array(pixelCount);
  const gradientId = new Uint8Array(pixelCount);
  const gradientDefId = new Uint16Array(pixelCount);
  const speed = new Uint8Array(pixelCount);
  const flow = new Uint8Array(pixelCount);
  const phase = new Uint8Array(pixelCount);
  const baseLayer = sources[0].layer;
  let mergedLayer: Layer = {
    ...baseLayer,
    id: targetLayerId,
    colorCycleData: cloneColorCycleData(baseLayer.colorCycleData, { stripSurfaces: false }),
  };
  let hasContent = false;
  let strokeCounter = 0;

  for (let sourceIndex = 0; sourceIndex < sources.length; sourceIndex += 1) {
    const source = sources[sourceIndex] as ColorCycleLayerMergeSource;
    const sourcePaint = new Uint8Array(source.snapshot.paintBuffer);
    const originalGradientId = source.snapshot.gradientIdBuffer
      ? new Uint8Array(source.snapshot.gradientIdBuffer)
      : new Uint8Array(pixelCount);
    const originalGradientDefId = source.snapshot.gradientDefIdBuffer
      ? new Uint16Array(source.snapshot.gradientDefIdBuffer)
      : new Uint16Array(pixelCount);
    let sourceGradientId = originalGradientId;
    let sourceGradientDefId = originalGradientDefId;
    const sourceSpeed = source.snapshot.speedBuffer
      ? new Uint8Array(source.snapshot.speedBuffer)
      : new Uint8Array(pixelCount);
    const sourceFlow = source.snapshot.flowBuffer
      ? new Uint8Array(source.snapshot.flowBuffer)
      : new Uint8Array(pixelCount);
    const sourcePhase = source.snapshot.phaseBuffer
      ? new Uint8Array(source.snapshot.phaseBuffer)
      : new Uint8Array(pixelCount);

    if (sourceIndex > 0) {
      const paletteMerge = mergeTransferredColorCycleSlotPalettes({
        layer: mergedLayer,
        palettes: extractTransferredColorCycleSlotPalettes(
          source.layer,
          sourceGradientId,
          sourceGradientDefId,
        ),
        gradientIds: sourceGradientId,
      });
      mergedLayer = paletteMerge.layer;
      sourceGradientId = paletteMerge.remappedGradientIds
        ? new Uint8Array(paletteMerge.remappedGradientIds)
        : sourceGradientId;

      const sourceDefs = extractTransferredColorCycleGradientDefs(
        source.layer,
        sourceGradientDefId,
      )?.map((entry) => ({
        ...entry,
        slot: typeof entry.slot === 'number'
          ? (paletteMerge.slotRemap.get(entry.slot) ?? entry.slot)
          : entry.slot,
      }));
      const defMerge = mergeTransferredColorCycleGradientDefs({
        layer: mergedLayer,
        defs: sourceDefs,
        defIds: sourceGradientDefId,
      });
      mergedLayer = defMerge.layer;
      sourceGradientDefId = defMerge.remappedDefIds
        ? new Uint16Array(defMerge.remappedDefIds)
        : sourceGradientDefId;
    }

    if (!transferredPaintMetadataMatches({
      sourceLayer: source.layer,
      targetLayer: mergedLayer,
      sourcePaint,
      sourceGradientIds: originalGradientId,
      sourceGradientDefIds: originalGradientDefId,
      targetGradientIds: sourceGradientId,
      targetGradientDefIds: sourceGradientDefId,
    })) {
      return null;
    }

    for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex += 1) {
      if ((sourcePaint[pixelIndex] ?? 0) === 0) {
        continue;
      }
      paint[pixelIndex] = sourcePaint[pixelIndex] ?? 0;
      gradientId[pixelIndex] = sourceGradientId[pixelIndex] ?? 0;
      gradientDefId[pixelIndex] = sourceGradientDefId[pixelIndex] ?? 0;
      speed[pixelIndex] = sourceSpeed[pixelIndex] ?? 0;
      flow[pixelIndex] = sourceFlow[pixelIndex] ?? 0;
      phase[pixelIndex] = sourcePhase[pixelIndex] ?? 0;
      hasContent = true;
    }
    strokeCounter = Math.max(strokeCounter, source.snapshot.strokeCounter);
  }

  return {
    layer: {
      ...mergedLayer,
      colorCycleData: {
        ...mergedLayer.colorCycleData,
        hasContent,
      },
    },
    snapshot: {
      paintBuffer: paint.buffer,
      gradientIdBuffer: gradientId.buffer,
      gradientDefIdBuffer: gradientDefId.buffer,
      speedBuffer: speed.buffer,
      speedSourceVersion: AUTHORED_SPEED_SOURCE_VERSION,
      flowBuffer: flow.buffer,
      phaseBuffer: phase.buffer,
      hasContent,
      strokeCounter,
    },
  };
};
