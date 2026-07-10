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
}): number | null => {
  const snapshot = readColorCycleBrushLayerSnapshotFromRuntime(brush, layerId);
  if (!snapshot?.gradientIdBuffer || snapshot.paintBuffer.byteLength === 0) {
    return null;
  }

  // Runtime reads materialize owned buffer copies, so these can be edited in place
  // without cloning the full layer a second time.
  const paint = new Uint8Array(snapshot.paintBuffer);
  const gradientId = new Uint8Array(snapshot.gradientIdBuffer);
  if (paint.length !== gradientId.length) {
    return null;
  }

  const gradientDefId = snapshot.gradientDefIdBuffer
    ? new Uint16Array(snapshot.gradientDefIdBuffer)
    : null;
  const speed = snapshot.speedBuffer ? new Uint8Array(snapshot.speedBuffer) : null;
  const flow = snapshot.flowBuffer ? new Uint8Array(snapshot.flowBuffer) : null;
  const phase = snapshot.phaseBuffer ? new Uint8Array(snapshot.phaseBuffer) : null;
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
    paintBuffer: snapshot.paintBuffer,
    gradientIdBuffer: snapshot.gradientIdBuffer,
    gradientDefIdBuffer: snapshot.gradientDefIdBuffer,
    speedBuffer: snapshot.speedBuffer,
    flowBuffer: snapshot.flowBuffer,
    phaseBuffer: snapshot.phaseBuffer,
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

  return applied ? clearedPixels : null;
};
