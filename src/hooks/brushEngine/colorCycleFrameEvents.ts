import type { ColorCycleLayerDirtyBatch } from '@/lib/colorCycle/document';

export const COLOR_CYCLE_FRAME_READY_EVENT = 'colorCycleFrameReady';

export type ColorCycleFrameReadyDetail = {
  dirtyBatches?: ColorCycleLayerDirtyBatch[];
};

export const dispatchColorCycleFrameReady = (
  dirtyBatches?: ColorCycleLayerDirtyBatch[],
): void => {
  window.dispatchEvent(new CustomEvent<ColorCycleFrameReadyDetail>(
    COLOR_CYCLE_FRAME_READY_EVENT,
    { detail: { dirtyBatches } },
  ));
};

export const getColorCycleFrameReadyDirtyBatches = (
  event: Event,
): ColorCycleLayerDirtyBatch[] | undefined => {
  const detail = (event as CustomEvent<ColorCycleFrameReadyDetail>).detail;
  const dirtyBatches = detail?.dirtyBatches;
  return dirtyBatches?.length ? dirtyBatches : undefined;
};
