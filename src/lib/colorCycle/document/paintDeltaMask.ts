export type ColorCyclePaintMaskRegion = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ColorCyclePaintSnapshot = {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  hasContent?: boolean;
  strokeCounter?: number;
};

export type ColorCyclePaintMask = {
  data: Uint8Array;
  width: number;
  height: number;
  bounds: ColorCyclePaintMaskRegion;
};

export interface ColorCycleSelectionPaintSummary {
  paintWidth: number;
  paintHeight: number;
  totalNonZeroPaint: number;
  selectedNonZeroPaint: number;
  wouldClearAllPaint: boolean;
}

export interface ColorCycleCanonicalSelectionPayload {
  paint: Uint8Array | null;
  gradientIdBuffer?: Uint8Array | null;
  gradientDefIdBuffer?: Uint16Array | null;
  speedBuffer?: Uint8Array | null;
  flowBuffer?: Uint8Array | null;
  phaseBuffer?: Uint8Array | null;
  width: number;
  height: number;
}

export type ColorCycleRuntimePaintSnapshot = {
  paint: Uint8Array;
  gradientIdBuffer: Uint8Array;
  gradientDefIdBuffer: Uint16Array | null;
  speedBuffer: Uint8Array | null;
  flowBuffer: Uint8Array | null;
  phaseBuffer: Uint8Array | null;
  width: number;
  height: number;
  hasContent: boolean;
  strokeCounter: number;
};

export type ColorCyclePaintTransparencyMaskOptions = {
  paintMask?: Uint8Array | null;
  maskAlpha?: Uint8ClampedArray | Uint8Array | null;
};

const clampRange = (start: number, end: number, limit: number): [number, number] => [
  Math.max(0, Math.floor(start)),
  Math.min(limit, Math.ceil(end)),
];

const isSelectedByMask = (
  x: number,
  y: number,
  mask: ImageData | null,
  maskBounds: ColorCyclePaintMaskRegion | null
): boolean => {
  if (!mask || !maskBounds) {
    return true;
  }
  const maskX = x - Math.floor(maskBounds.x);
  const maskY = y - Math.floor(maskBounds.y);
  if (maskX < 0 || maskY < 0 || maskX >= mask.width || maskY >= mask.height) {
    return false;
  }
  return mask.data[(maskY * mask.width + maskX) * 4 + 3] > 0;
};

export const summarizeColorCycleSelectionPaint = (args: {
  paint: Uint8Array;
  paintWidth: number;
  paintHeight: number;
  bounds: ColorCyclePaintMaskRegion;
  selectionMask?: ImageData | null;
  selectionMaskBounds?: ColorCyclePaintMaskRegion | null;
}): ColorCycleSelectionPaintSummary => {
  const { paint, paintWidth, paintHeight, bounds, selectionMask = null, selectionMaskBounds = null } = args;
  let totalNonZeroPaint = 0;
  let selectedNonZeroPaint = 0;

  const [startX, endX] = clampRange(bounds.x, bounds.x + bounds.width, paintWidth);
  const [startY, endY] = clampRange(bounds.y, bounds.y + bounds.height, paintHeight);

  for (let y = 0; y < paintHeight; y += 1) {
    const row = y * paintWidth;
    for (let x = 0; x < paintWidth; x += 1) {
      const index = row + x;
      if (paint[index] === 0) {
        continue;
      }
      totalNonZeroPaint += 1;
      if (
        x >= startX &&
        x < endX &&
        y >= startY &&
        y < endY &&
        isSelectedByMask(x, y, selectionMask, selectionMaskBounds)
      ) {
        selectedNonZeroPaint += 1;
      }
    }
  }

  return {
    paintWidth,
    paintHeight,
    totalNonZeroPaint,
    selectedNonZeroPaint,
    wouldClearAllPaint: totalNonZeroPaint > 0 && selectedNonZeroPaint === totalNonZeroPaint,
  };
};

const copyColorCycleScalarRegion = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  rect: ColorCyclePaintMaskRegion,
): Uint8Array => {
  const destination = new Uint8Array(rect.width * rect.height);
  const startX = Math.floor(rect.x);
  const startY = Math.floor(rect.y);
  const safeWidth = Math.max(0, Math.floor(rect.width));
  const safeHeight = Math.max(0, Math.floor(rect.height));

  for (let row = 0; row < safeHeight; row += 1) {
    const srcRow = startY + row;
    if (srcRow < 0 || srcRow >= sourceHeight) {
      continue;
    }
    for (let col = 0; col < safeWidth; col += 1) {
      const srcCol = startX + col;
      if (srcCol < 0 || srcCol >= sourceWidth) {
        continue;
      }
      destination[row * rect.width + col] = source[srcRow * sourceWidth + srcCol] ?? 0;
    }
  }

  return destination;
};

export const captureColorCyclePaintRegion = ({
  snapshot,
  fallbackBuffer,
  width,
  height,
  rect,
}: {
  snapshot: ColorCyclePaintSnapshot | null | undefined;
  fallbackBuffer?: ArrayBuffer | null;
  width: number;
  height: number;
  rect: ColorCyclePaintMaskRegion;
}): Uint8Array | null => {
  const sourceBuffer = colorCyclePaintSnapshotHasPayload(snapshot) && snapshot.paintBuffer.byteLength > 0
    ? snapshot.paintBuffer
    : fallbackBuffer ?? null;
  if (!sourceBuffer) {
    return null;
  }
  const source = new Uint8Array(sourceBuffer);
  if (source.length !== width * height) {
    return null;
  }
  return copyColorCycleScalarRegion(source, width, height, rect);
};

export const buildColorCycleCanonicalSelectionPayload = ({
  snapshot,
  width,
  height,
  layerClaimsContent,
  hasPersistedPayload,
}: {
  snapshot: ColorCyclePaintSnapshot | null | undefined;
  width: number;
  height: number;
  layerClaimsContent: boolean;
  hasPersistedPayload: boolean;
}): ColorCycleCanonicalSelectionPayload => {
  const paint = colorCyclePaintSnapshotHasPayload(snapshot)
    ? new Uint8Array(snapshot.paintBuffer)
    : null;
  const hasCanonicalPaint = paint?.some((value) => value !== 0) ?? false;
  return {
    paint: (layerClaimsContent || hasPersistedPayload) && !hasCanonicalPaint ? null : paint,
    gradientIdBuffer: snapshot?.gradientIdBuffer ? new Uint8Array(snapshot.gradientIdBuffer) : null,
    gradientDefIdBuffer: snapshot?.gradientDefIdBuffer ? new Uint16Array(snapshot.gradientDefIdBuffer) : null,
    speedBuffer: snapshot?.speedBuffer ? new Uint8Array(snapshot.speedBuffer) : null,
    flowBuffer: snapshot?.flowBuffer ? new Uint8Array(snapshot.flowBuffer) : null,
    phaseBuffer: snapshot?.phaseBuffer ? new Uint8Array(snapshot.phaseBuffer) : null,
    width,
    height,
  };
};

export const buildColorCycleCanonicalSelectionPayloadFromSnapshot = ({
  snapshot,
  width,
  height,
  allowEmptyInitializedPayload = false,
}: {
  snapshot: ColorCyclePaintSnapshot | null | undefined;
  width: number;
  height: number;
  allowEmptyInitializedPayload?: boolean;
}): ColorCycleCanonicalSelectionPayload => {
  const expectedPixels = Math.max(1, width * height);
  const emptyBytes = () => new Uint8Array(expectedPixels);
  const emptyDefBytes = () => new Uint16Array(expectedPixels);
  return {
    paint: colorCyclePaintSnapshotHasPayload(snapshot)
      ? new Uint8Array(snapshot.paintBuffer)
      : (allowEmptyInitializedPayload ? emptyBytes() : null),
    gradientIdBuffer: snapshot?.gradientIdBuffer?.byteLength
      ? new Uint8Array(snapshot.gradientIdBuffer)
      : (allowEmptyInitializedPayload ? emptyBytes() : null),
    gradientDefIdBuffer: snapshot?.gradientDefIdBuffer?.byteLength
      ? new Uint16Array(snapshot.gradientDefIdBuffer)
      : (allowEmptyInitializedPayload ? emptyDefBytes() : null),
    speedBuffer: snapshot?.speedBuffer?.byteLength
      ? new Uint8Array(snapshot.speedBuffer)
      : (allowEmptyInitializedPayload ? emptyBytes() : null),
    flowBuffer: snapshot?.flowBuffer?.byteLength
      ? new Uint8Array(snapshot.flowBuffer)
      : (allowEmptyInitializedPayload ? emptyBytes() : null),
    phaseBuffer: snapshot?.phaseBuffer?.byteLength
      ? new Uint8Array(snapshot.phaseBuffer)
      : (allowEmptyInitializedPayload ? emptyBytes() : null),
    width,
    height,
  };
};

const cloneUint8Array = (buffer?: ArrayBuffer): Uint8Array | null => (
  buffer ? new Uint8Array(buffer).slice() : null
);

const cloneUint16Array = (buffer?: ArrayBuffer): Uint16Array | null => (
  buffer ? new Uint16Array(buffer).slice() : null
);

const cloneUint8ArrayWithLength = (buffer: ArrayBuffer | undefined, length: number): Uint8Array | null => {
  if (!buffer) {
    return null;
  }
  const source = new Uint8Array(buffer);
  if (source.length === length) {
    return source.slice();
  }
  const target = new Uint8Array(length);
  target.set(source.subarray(0, Math.min(source.length, target.length)));
  return target;
};

const cloneUint16ArrayWithLength = (buffer: ArrayBuffer | undefined, length: number): Uint16Array | null => {
  if (!buffer) {
    return null;
  }
  const source = new Uint16Array(buffer);
  if (source.length === length) {
    return source.slice();
  }
  const target = new Uint16Array(length);
  target.set(source.subarray(0, Math.min(source.length, target.length)));
  return target;
};

export const buildColorCycleRuntimePaintSnapshot = ({
  snapshot,
  width,
  height,
  allowEmptyInitializedPayload = false,
  normalizeLength = false,
}: {
  snapshot: ColorCyclePaintSnapshot | null | undefined;
  width: number;
  height: number;
  allowEmptyInitializedPayload?: boolean;
  normalizeLength?: boolean;
}): ColorCycleRuntimePaintSnapshot | null => {
  const expectedLength = width * height;
  const hasPaintPayload = colorCyclePaintSnapshotHasPayload(snapshot);
  if ((!hasPaintPayload && !allowEmptyInitializedPayload) || width <= 0 || height <= 0) {
    return null;
  }

  const cloneU8 = normalizeLength ? cloneUint8ArrayWithLength : cloneUint8Array;
  const cloneU16 = normalizeLength ? cloneUint16ArrayWithLength : cloneUint16Array;
  const paint = hasPaintPayload
    ? cloneU8(snapshot.paintBuffer, expectedLength)
    : new Uint8Array(expectedLength);
  const gradientIdBuffer = cloneU8(snapshot?.gradientIdBuffer, expectedLength) ?? new Uint8Array(expectedLength);
  const gradientDefIdBuffer = cloneU16(snapshot?.gradientDefIdBuffer, expectedLength);
  const speedBuffer = cloneU8(snapshot?.speedBuffer, expectedLength);
  const flowBuffer = cloneU8(snapshot?.flowBuffer, expectedLength);
  const phaseBuffer = cloneU8(snapshot?.phaseBuffer, expectedLength);

  if (!paint || paint.length !== expectedLength || gradientIdBuffer.length !== expectedLength) {
    return null;
  }
  if (gradientDefIdBuffer && gradientDefIdBuffer.length !== expectedLength) {
    return null;
  }
  if (speedBuffer && speedBuffer.length !== expectedLength) {
    return null;
  }
  if (flowBuffer && flowBuffer.length !== expectedLength) {
    return null;
  }
  if (phaseBuffer && phaseBuffer.length !== expectedLength) {
    return null;
  }

  return {
    paint,
    gradientIdBuffer,
    gradientDefIdBuffer,
    speedBuffer,
    flowBuffer,
    phaseBuffer,
    width,
    height,
    hasContent: snapshot?.hasContent ?? paint.some((value) => value !== 0),
    strokeCounter: snapshot?.strokeCounter ?? 0,
  };
};

export const colorCycleRuntimePaintSnapshotToBrushSnapshot = (
  snapshot: ColorCycleRuntimePaintSnapshot,
): Required<Pick<ColorCyclePaintSnapshot, 'paintBuffer' | 'hasContent' | 'strokeCounter'>> &
  Omit<ColorCyclePaintSnapshot, 'paintBuffer' | 'hasContent' | 'strokeCounter'> => ({
    paintBuffer: snapshot.paint.slice().buffer as ArrayBuffer,
    gradientIdBuffer: snapshot.gradientIdBuffer.slice().buffer as ArrayBuffer,
    gradientDefIdBuffer: snapshot.gradientDefIdBuffer?.slice().buffer as ArrayBuffer | undefined,
    speedBuffer: snapshot.speedBuffer?.slice().buffer as ArrayBuffer | undefined,
    flowBuffer: snapshot.flowBuffer?.slice().buffer as ArrayBuffer | undefined,
    phaseBuffer: snapshot.phaseBuffer?.slice().buffer as ArrayBuffer | undefined,
    hasContent: snapshot.hasContent,
    strokeCounter: snapshot.strokeCounter,
  });

const scaleUint8Nearest = (
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint8Array => {
  const scaled = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      scaled[y * width + x] = source[sourceY * sourceWidth + sourceX] ?? 0;
    }
  }
  return scaled;
};

const scaleUint16Nearest = (
  source: Uint16Array,
  sourceWidth: number,
  sourceHeight: number,
  width: number,
  height: number,
): Uint16Array => {
  const scaled = new Uint16Array(width * height);
  for (let y = 0; y < height; y += 1) {
    const sourceY = Math.min(sourceHeight - 1, Math.floor((y * sourceHeight) / height));
    for (let x = 0; x < width; x += 1) {
      const sourceX = Math.min(sourceWidth - 1, Math.floor((x * sourceWidth) / width));
      scaled[y * width + x] = source[sourceY * sourceWidth + sourceX] ?? 0;
    }
  }
  return scaled;
};

export const scaleColorCyclePaintSnapshotNearest = ({
  snapshot,
  sourceWidth,
  sourceHeight,
  width,
  height,
}: {
  snapshot: ColorCyclePaintSnapshot;
  sourceWidth: number;
  sourceHeight: number;
  width: number;
  height: number;
}): ColorCyclePaintSnapshot => {
  const sourcePixels = sourceWidth * sourceHeight;
  const scaleU8 = (buffer?: ArrayBuffer): ArrayBuffer | undefined => {
    if (!buffer) {
      return undefined;
    }
    const source = new Uint8Array(buffer);
    if (source.length !== sourcePixels) {
      return undefined;
    }
    return scaleUint8Nearest(source, sourceWidth, sourceHeight, width, height).buffer.slice(0) as ArrayBuffer;
  };
  const scaleU16 = (buffer?: ArrayBuffer): ArrayBuffer | undefined => {
    if (!buffer) {
      return undefined;
    }
    const source = new Uint16Array(buffer);
    if (source.length !== sourcePixels) {
      return undefined;
    }
    return scaleUint16Nearest(source, sourceWidth, sourceHeight, width, height).buffer.slice(0) as ArrayBuffer;
  };

  const scaledPaint = scaleU8(snapshot.paintBuffer);
  if (!scaledPaint) {
    return snapshot;
  }

  return {
    ...snapshot,
    paintBuffer: scaledPaint,
    gradientIdBuffer: scaleU8(snapshot.gradientIdBuffer),
    gradientDefIdBuffer: scaleU16(snapshot.gradientDefIdBuffer),
    speedBuffer: scaleU8(snapshot.speedBuffer),
    flowBuffer: scaleU8(snapshot.flowBuffer),
    phaseBuffer: scaleU8(snapshot.phaseBuffer),
  };
};

export const rebuildColorCycleSerializedStateRegion = <TState extends {
  layers?: Array<{
    strokeData?: {
      paintBuffer?: ArrayBuffer;
      gradientIdBuffer?: ArrayBuffer;
      gradientDefIdBuffer?: ArrayBuffer;
      speedBuffer?: ArrayBuffer;
      flowBuffer?: ArrayBuffer;
      phaseBuffer?: ArrayBuffer;
    };
  }>;
}>({
  currentState,
  sourceBounds,
  sourceIndices,
  sourceGradientIds,
  sourceGradientDefIds,
  sourceSpeed,
  sourceFlow,
  sourcePhase,
  sourceWidth,
  sourceHeight,
  canvasWidth,
  canvasHeight,
}: {
  currentState: TState;
  sourceBounds: ColorCyclePaintMaskRegion;
  sourceIndices: Uint8Array;
  sourceGradientIds?: Uint8Array | null;
  sourceGradientDefIds?: Uint16Array | null;
  sourceSpeed?: Uint8Array | null;
  sourceFlow?: Uint8Array | null;
  sourcePhase?: Uint8Array | null;
  sourceWidth: number;
  sourceHeight: number;
  canvasWidth: number;
  canvasHeight: number;
}): TState => {
  if (!currentState?.layers?.length) {
    return currentState;
  }
  const layer0 = currentState.layers[0];
  const paint = layer0?.strokeData?.paintBuffer
    ? new Uint8Array(layer0.strokeData.paintBuffer)
    : null;
  const gradientBuffer = layer0?.strokeData?.gradientIdBuffer
    ? new Uint8Array(layer0.strokeData.gradientIdBuffer)
    : null;
  const gradientDefBuffer = layer0?.strokeData?.gradientDefIdBuffer
    ? new Uint16Array(layer0.strokeData.gradientDefIdBuffer)
    : null;
  const speedBuffer = layer0?.strokeData?.speedBuffer
    ? new Uint8Array(layer0.strokeData.speedBuffer)
    : null;
  const flowBuffer = layer0?.strokeData?.flowBuffer
    ? new Uint8Array(layer0.strokeData.flowBuffer)
    : null;
  const phaseBuffer = layer0?.strokeData?.phaseBuffer
    ? new Uint8Array(layer0.strokeData.phaseBuffer)
    : null;
  if (!paint || paint.length !== canvasWidth * canvasHeight) {
    return currentState;
  }

  const restored = paint.slice();
  const startX = Math.max(0, Math.floor(sourceBounds.x));
  const startY = Math.max(0, Math.floor(sourceBounds.y));
  const endX = Math.min(canvasWidth, Math.ceil(sourceBounds.x + sourceBounds.width));
  const endY = Math.min(canvasHeight, Math.ceil(sourceBounds.y + sourceBounds.height));

  for (let y = startY; y < endY; y += 1) {
    for (let x = startX; x < endX; x += 1) {
      const localX = x - startX;
      const localY = y - startY;
      if (localX < 0 || localY < 0 || localX >= sourceWidth || localY >= sourceHeight) {
        continue;
      }
      const srcIndex = localY * sourceWidth + localX;
      const dstIndex = y * canvasWidth + x;
      restored[dstIndex] = sourceIndices[srcIndex] ?? 0;
      if (gradientBuffer && gradientBuffer.length === canvasWidth * canvasHeight) {
        gradientBuffer[dstIndex] = sourceGradientIds?.[srcIndex] ?? 0;
      }
      if (gradientDefBuffer && gradientDefBuffer.length === canvasWidth * canvasHeight) {
        gradientDefBuffer[dstIndex] = sourceGradientDefIds?.[srcIndex] ?? 0;
      }
      if (speedBuffer && speedBuffer.length === canvasWidth * canvasHeight) {
        speedBuffer[dstIndex] = sourceSpeed?.[srcIndex] ?? 0;
      }
      if (flowBuffer && flowBuffer.length === canvasWidth * canvasHeight) {
        flowBuffer[dstIndex] = sourceFlow?.[srcIndex] ?? 0;
      }
      if (phaseBuffer && phaseBuffer.length === canvasWidth * canvasHeight) {
        phaseBuffer[dstIndex] = sourcePhase?.[srcIndex] ?? 0;
      }
    }
  }

  const nextLayer0 = {
    ...layer0,
    strokeData: layer0.strokeData
      ? {
          ...layer0.strokeData,
          paintBuffer: restored.buffer,
          gradientIdBuffer: gradientBuffer?.buffer ?? layer0.strokeData.gradientIdBuffer,
          gradientDefIdBuffer: gradientDefBuffer?.buffer ?? layer0.strokeData.gradientDefIdBuffer,
          speedBuffer: speedBuffer?.buffer ?? layer0.strokeData.speedBuffer,
          flowBuffer: flowBuffer?.buffer ?? layer0.strokeData.flowBuffer,
          phaseBuffer: phaseBuffer?.buffer ?? layer0.strokeData.phaseBuffer,
        }
      : layer0.strokeData,
  };

  return {
    ...currentState,
    layers: [nextLayer0, ...currentState.layers.slice(1)],
  };
};

export const colorCyclePaintSnapshotHasPayload = (
  snapshot: ColorCyclePaintSnapshot | null | undefined,
): snapshot is ColorCyclePaintSnapshot => Boolean(snapshot?.paintBuffer);

export const cloneColorCyclePaintSnapshotPaintMask = (
  snapshot: ColorCyclePaintSnapshot | null | undefined,
): Uint8Array | null => (
  colorCyclePaintSnapshotHasPayload(snapshot)
    ? new Uint8Array(snapshot.paintBuffer).slice()
    : null
);

export const getColorCycleSerializedStatePaintByteLength = (
  serializedState: unknown,
  layerIndex = 0,
): number => {
  if (!serializedState || typeof serializedState !== 'object') {
    return -1;
  }
  const layers = (serializedState as { layers?: unknown }).layers;
  if (!Array.isArray(layers)) {
    return -1;
  }
  const layer = layers[layerIndex];
  if (!layer || typeof layer !== 'object') {
    return -1;
  }
  const strokeData = (layer as { strokeData?: unknown }).strokeData;
  if (!strokeData || typeof strokeData !== 'object') {
    return -1;
  }
  const paintBuffer = (strokeData as { paintBuffer?: unknown }).paintBuffer;
  if (paintBuffer instanceof ArrayBuffer) {
    return paintBuffer.byteLength;
  }
  if (ArrayBuffer.isView(paintBuffer)) {
    return paintBuffer.byteLength;
  }
  return -1;
};

const clampMaskRoi = (
  roi: ColorCyclePaintMaskRegion | undefined,
  width: number,
  height: number
): ColorCyclePaintMaskRegion | null => {
  const maxWidth = Math.max(0, Math.floor(width));
  const maxHeight = Math.max(0, Math.floor(height));
  if (maxWidth <= 0 || maxHeight <= 0) {
    return null;
  }
  const source = roi ?? { x: 0, y: 0, width: maxWidth, height: maxHeight };
  const x = Math.max(0, Math.floor(source.x));
  const y = Math.max(0, Math.floor(source.y));
  const right = Math.min(maxWidth, Math.ceil(source.x + source.width));
  const bottom = Math.min(maxHeight, Math.ceil(source.y + source.height));
  if (right <= x || bottom <= y) {
    return null;
  }
  return { x, y, width: right - x, height: bottom - y };
};

const getU8 = (data: Uint8Array | null, index: number): number => {
  if (!data || index < 0 || index >= data.length) {
    return 0;
  }
  return data[index] ?? 0;
};

const getU16 = (data: Uint16Array | null, index: number): number => {
  if (!data || index < 0 || index >= data.length) {
    return 0;
  }
  return data[index] ?? 0;
};

export const buildColorCyclePaintDeltaMask = ({
  before,
  after,
  roi,
  width,
  height,
}: {
  before: ColorCyclePaintSnapshot | null | undefined;
  after: ColorCyclePaintSnapshot | null | undefined;
  roi?: ColorCyclePaintMaskRegion;
  width: number;
  height: number;
}): ColorCyclePaintMask | null => {
  if (!after?.paintBuffer) {
    return null;
  }
  const bounds = clampMaskRoi(roi, width, height);
  if (!bounds) {
    return null;
  }
  const beforePaint = before?.paintBuffer ? new Uint8Array(before.paintBuffer) : null;
  const beforeGradientId = before?.gradientIdBuffer ? new Uint8Array(before.gradientIdBuffer) : null;
  const beforeSpeed = before?.speedBuffer ? new Uint8Array(before.speedBuffer) : null;
  const beforeFlow = before?.flowBuffer ? new Uint8Array(before.flowBuffer) : null;
  const beforePhase = before?.phaseBuffer ? new Uint8Array(before.phaseBuffer) : null;
  const beforeGradientDefId = before?.gradientDefIdBuffer
    ? new Uint16Array(before.gradientDefIdBuffer)
    : null;
  const afterPaint = new Uint8Array(after.paintBuffer);
  const afterGradientId = after.gradientIdBuffer ? new Uint8Array(after.gradientIdBuffer) : null;
  const afterSpeed = after.speedBuffer ? new Uint8Array(after.speedBuffer) : null;
  const afterFlow = after.flowBuffer ? new Uint8Array(after.flowBuffer) : null;
  const afterPhase = after.phaseBuffer ? new Uint8Array(after.phaseBuffer) : null;
  const afterGradientDefId = after.gradientDefIdBuffer
    ? new Uint16Array(after.gradientDefIdBuffer)
    : null;
  const mask = new Uint8Array(bounds.width * bounds.height);
  let changedPixels = 0;
  for (let row = 0; row < bounds.height; row += 1) {
    const y = bounds.y + row;
    const fullRowOffset = y * width;
    const maskRowOffset = row * bounds.width;
    for (let col = 0; col < bounds.width; col += 1) {
      const x = bounds.x + col;
      const index = fullRowOffset + x;
      if (index < 0 || index >= afterPaint.length || afterPaint[index] === 0) {
        continue;
      }
      const changed =
        getU8(beforePaint, index) !== getU8(afterPaint, index) ||
        getU8(beforeGradientId, index) !== getU8(afterGradientId, index) ||
        getU8(beforeSpeed, index) !== getU8(afterSpeed, index) ||
        getU8(beforeFlow, index) !== getU8(afterFlow, index) ||
        getU8(beforePhase, index) !== getU8(afterPhase, index) ||
        getU16(beforeGradientDefId, index) !== getU16(afterGradientDefId, index);
      if (!changed) {
        continue;
      }
      mask[maskRowOffset + col] = 255;
      changedPixels += 1;
    }
  }
  if (changedPixels === 0) {
    return null;
  }
  return {
    data: mask,
    width: bounds.width,
    height: bounds.height,
    bounds,
  };
};

export const applyColorCycleTransparencyMaskToPaintSnapshot = (
  snapshot: ColorCyclePaintSnapshot,
  options: ColorCyclePaintTransparencyMaskOptions,
): ColorCyclePaintSnapshot | null => {
  const paint = new Uint8Array(snapshot.paintBuffer);
  const gid = snapshot.gradientIdBuffer ? new Uint8Array(snapshot.gradientIdBuffer) : null;
  const gdef = snapshot.gradientDefIdBuffer ? new Uint16Array(snapshot.gradientDefIdBuffer) : null;
  const spd = snapshot.speedBuffer ? new Uint8Array(snapshot.speedBuffer) : null;
  const flow = snapshot.flowBuffer ? new Uint8Array(snapshot.flowBuffer) : null;
  const phase = snapshot.phaseBuffer ? new Uint8Array(snapshot.phaseBuffer) : null;
  const paintMask =
    options.paintMask && options.paintMask.length === paint.length
      ? options.paintMask
      : null;
  const maskAlpha = paintMask ? null : options.maskAlpha ?? null;
  const pixelCount = paintMask
    ? Math.min(paint.length, paintMask.length)
    : Math.min(paint.length, Math.floor((maskAlpha?.length ?? 0) / 4));
  let changed = false;
  let hasContent = false;

  for (let i = 0; i < pixelCount; i += 1) {
    const isLockedOut = paintMask ? paintMask[i] === 0 : (maskAlpha?.[i * 4 + 3] ?? 0) === 0;
    if (isLockedOut) {
      if (paint[i] !== 0) {
        paint[i] = 0;
        changed = true;
      }
      if (gid && gid[i] !== 0) {
        gid[i] = 0;
        changed = true;
      }
      if (gdef && gdef[i] !== 0) {
        gdef[i] = 0;
        changed = true;
      }
      if (spd && spd[i] !== 0) {
        spd[i] = 0;
        changed = true;
      }
      if (flow && flow[i] !== 0) {
        flow[i] = 0;
        changed = true;
      }
      if (phase && phase[i] !== 0) {
        phase[i] = 0;
        changed = true;
      }
      continue;
    }
    if (paint[i] !== 0) {
      hasContent = true;
    }
  }

  if (!changed) {
    return null;
  }

  return {
    paintBuffer: paint.buffer,
    gradientIdBuffer: gid?.buffer,
    gradientDefIdBuffer: gdef?.buffer,
    speedBuffer: spd?.buffer,
    flowBuffer: flow?.buffer,
    phaseBuffer: phase?.buffer,
    hasContent,
    strokeCounter: snapshot.strokeCounter ?? 0,
  };
};
