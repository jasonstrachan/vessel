import { TEMP_SAMPLE_SLOT } from '@/constants/colorCycle';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  readColorCycleBrushLayerSnapshotFromRuntime,
  type ColorCycleBrushLayerSnapshot,
  type ColorCycleBrushLayerSnapshotRuntimeReader,
  type ColorCycleBrushLayerSnapshotRuntimeWriter,
} from '@/lib/colorCycle/document';

type SampledShapeTempSlotBrush = ColorCycleBrushLayerSnapshotRuntimeReader
  & ColorCycleBrushLayerSnapshotRuntimeWriter;

const cloneOptionalU8Buffer = (buffer: ArrayBuffer | undefined): Uint8Array | null => (
  buffer ? new Uint8Array(buffer.slice(0)) : null
);

const cloneOptionalU16Buffer = (buffer: ArrayBuffer | undefined): Uint16Array | null => (
  buffer ? new Uint16Array(buffer.slice(0)) : null
);

const toBuffer = (view: Uint8Array | Uint16Array | null): ArrayBuffer | undefined => (
  view ? view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer : undefined
);

/**
 * Removes abandoned sampled-mark pixels before a shape claims the shared temp slot.
 * Committed pixels use allocated slots and are left untouched.
 */
export const discardAbandonedSampledShapeTempPixels = ({
  brush,
  layerId,
}: {
  brush: SampledShapeTempSlotBrush | null | undefined;
  layerId: string;
}): number => {
  const snapshot = readColorCycleBrushLayerSnapshotFromRuntime(brush, layerId);
  if (!snapshot?.gradientIdBuffer || snapshot.paintBuffer.byteLength === 0) {
    return 0;
  }

  const paint = new Uint8Array(snapshot.paintBuffer.slice(0));
  const gradientId = new Uint8Array(snapshot.gradientIdBuffer.slice(0));
  if (paint.length !== gradientId.length) {
    return 0;
  }

  const gradientDefId = cloneOptionalU16Buffer(snapshot.gradientDefIdBuffer);
  const speed = cloneOptionalU8Buffer(snapshot.speedBuffer);
  const flow = cloneOptionalU8Buffer(snapshot.flowBuffer);
  const phase = cloneOptionalU8Buffer(snapshot.phaseBuffer);
  let clearedPixels = 0;
  let clearedEntries = 0;

  for (let index = 0; index < paint.length; index += 1) {
    if (gradientId[index] !== TEMP_SAMPLE_SLOT) {
      continue;
    }
    if (paint[index] !== 0) {
      clearedPixels += 1;
    }
    paint[index] = 0;
    gradientId[index] = 0;
    if (gradientDefId && index < gradientDefId.length) gradientDefId[index] = 0;
    if (speed && index < speed.length) speed[index] = 0;
    if (flow && index < flow.length) flow[index] = 0;
    if (phase && index < phase.length) phase[index] = 0;
    clearedEntries += 1;
  }

  if (clearedEntries === 0) {
    return 0;
  }

  const nextSnapshot: ColorCycleBrushLayerSnapshot = {
    paintBuffer: toBuffer(paint) ?? new ArrayBuffer(0),
    gradientIdBuffer: toBuffer(gradientId),
    gradientDefIdBuffer: toBuffer(gradientDefId),
    speedBuffer: toBuffer(speed),
    flowBuffer: toBuffer(flow),
    phaseBuffer: toBuffer(phase),
    hasContent: paint.some((value) => value !== 0),
    strokeCounter: snapshot.strokeCounter,
  };
  const applied = applyColorCycleBrushLayerSnapshotToRuntime(
    brush,
    layerId,
    nextSnapshot,
    undefined,
    'discard-abandoned-sampled-shape-temp-slot',
    { suppressClearAudit: true },
  );

  return applied ? clearedPixels : 0;
};
