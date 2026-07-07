import {
  readColorCycleBrushLayerSnapshotFromRuntime,
  readColorCycleBrushSerializedStateFromRuntime,
  type ColorCycleBrushLayerSnapshot,
  type ColorCycleBrushLayerSnapshotRuntimeReader,
  type ColorCycleBrushSerializedStateRuntimeReader,
} from '@/lib/colorCycle/document';

type LegacyColorCycleSnapshotReader = {
  getLayerSnapshot?: (layerId: string) => Partial<ColorCycleBrushLayerSnapshot> | null | undefined;
};

const isSerializedColorCycleState = (
  value: unknown,
): value is { layers?: Array<{ layerId?: string; strokeData?: ColorCycleBrushLayerSnapshot }> } => (
  typeof value === 'object' && value !== null && (
    !('layers' in value) || Array.isArray((value as { layers?: unknown }).layers)
  )
);

const normalizeLegacySnapshot = (
  snapshot: Partial<ColorCycleBrushLayerSnapshot> | null | undefined,
): ColorCycleBrushLayerSnapshot | null => {
  if (!snapshot) {
    return null;
  }
  return {
    paintBuffer: snapshot.paintBuffer ?? new ArrayBuffer(0),
    gradientIdBuffer: snapshot.gradientIdBuffer,
    gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
    speedBuffer: snapshot.speedBuffer,
    flowBuffer: snapshot.flowBuffer,
    phaseBuffer: snapshot.phaseBuffer,
    hasContent: snapshot.hasContent ?? Boolean(snapshot.paintBuffer && snapshot.paintBuffer.byteLength > 0),
    strokeCounter: snapshot.strokeCounter ?? 0,
  };
};

export const readTestColorCycleBrushLayerSnapshot = (
  brush: (
    ColorCycleBrushLayerSnapshotRuntimeReader
    & ColorCycleBrushSerializedStateRuntimeReader
    & LegacyColorCycleSnapshotReader
  ) | null | undefined,
  layerId: string,
): ColorCycleBrushLayerSnapshot | null => {
  const serialized = readColorCycleBrushSerializedStateFromRuntime(brush);
  const serializedSnapshot = isSerializedColorCycleState(serialized)
    ? serialized.layers?.find((layer) => layer.layerId === layerId)?.strokeData
    : undefined;
  const documentSnapshot = readColorCycleBrushLayerSnapshotFromRuntime(brush, layerId);
  if (documentSnapshot) {
    return {
      ...documentSnapshot,
      strokeCounter: serializedSnapshot?.strokeCounter ?? documentSnapshot.strokeCounter,
    };
  }
  if (isSerializedColorCycleState(serialized)) {
    if (serializedSnapshot) {
      return serializedSnapshot;
    }
  }
  return normalizeLegacySnapshot(brush?.getLayerSnapshot?.(layerId));
};
