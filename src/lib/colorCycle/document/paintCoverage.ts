export type ColorCyclePaintCoverage = {
  width: number;
  height: number;
  alpha: Uint8ClampedArray;
};

export type ColorCyclePaintCoverageFallbackDimensions = {
  width?: number | null;
  height?: number | null;
};

type ColorCyclePaintCoverageSerializedLayer = {
  layerId?: string;
  id?: string;
  dimensions?: { width?: unknown; height?: unknown };
  width?: unknown;
  height?: unknown;
  strokeData?: { paintBuffer?: unknown };
  paintBuffer?: unknown;
};

type ColorCyclePaintCoverageSerializedState = {
  layers?: ColorCyclePaintCoverageSerializedLayer[];
};

const bufferLikeToUint8Array = (value: unknown): Uint8Array | null => {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value);
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
};

const resolveDimension = (
  primary: unknown,
  fallback: number | null | undefined,
): number => Math.max(1, Math.floor(Number(primary) || Number(fallback) || 0));

export const resolveColorCyclePaintCoverageFromSerializedState = (
  serializedState: unknown,
  layerId: string,
  fallbackDimensions: ColorCyclePaintCoverageFallbackDimensions = {},
): ColorCyclePaintCoverage | null => {
  const candidate = (
    serializedState &&
    typeof serializedState === 'object' &&
    Array.isArray((serializedState as ColorCyclePaintCoverageSerializedState).layers)
  )
    ? serializedState as ColorCyclePaintCoverageSerializedState
    : null;
  const serializedLayer = candidate?.layers?.find((entry) => (
    entry.layerId === layerId || entry.id === layerId
  )) ?? candidate?.layers?.[0];
  const paintBuffer = bufferLikeToUint8Array(
    serializedLayer?.strokeData?.paintBuffer ?? serializedLayer?.paintBuffer,
  );
  if (!paintBuffer || paintBuffer.length === 0) {
    return null;
  }
  const width = resolveDimension(
    serializedLayer?.dimensions?.width ?? serializedLayer?.width,
    fallbackDimensions.width,
  );
  const height = resolveDimension(
    serializedLayer?.dimensions?.height ?? serializedLayer?.height,
    fallbackDimensions.height,
  );
  if (paintBuffer.length < width * height) {
    return null;
  }
  const alpha = new Uint8ClampedArray(width * height);
  for (let index = 0; index < alpha.length; index += 1) {
    alpha[index] = (paintBuffer[index] ?? 0) > 0 ? 255 : 0;
  }
  return { width, height, alpha };
};
