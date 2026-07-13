import type { ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document';
import { recordColorCycleRuntimePerf } from '@/utils/perf/ccPerfProbe';

export const COLOR_CYCLE_FRAME_READY_EVENT = 'colorCycleFrameReady';

export type ColorCycleFrameReadyDetail = {
  sourceLayerId: string;
  dirtyBatches?: ColorCycleLayerDirtyBatch[];
};

export const dispatchColorCycleFrameReady = (
  sourceLayerId: string,
  dirtyBatches?: ColorCycleLayerDirtyBatch[],
): void => {
  recordColorCycleRuntimePerf('frameReadyPublication', { layerId: sourceLayerId });
  window.dispatchEvent(new CustomEvent<ColorCycleFrameReadyDetail>(
    COLOR_CYCLE_FRAME_READY_EVENT,
    { detail: { sourceLayerId, dirtyBatches } },
  ));
};

export const getColorCycleFrameReadySourceLayerId = (
  event: Event,
): string | null => {
  const sourceLayerId = (event as CustomEvent<ColorCycleFrameReadyDetail>).detail?.sourceLayerId;
  return typeof sourceLayerId === 'string' && sourceLayerId.length > 0
    ? sourceLayerId
    : null;
};

export const getColorCycleFrameReadyDirtyBatches = (
  event: Event,
): ColorCycleLayerDirtyBatch[] | undefined => {
  const detail = (event as CustomEvent<ColorCycleFrameReadyDetail>).detail;
  const dirtyBatches = detail?.dirtyBatches;
  return dirtyBatches?.length ? dirtyBatches : undefined;
};
