import { useMemo } from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { CropState, Rectangle } from '@/types';

type CropSelectors = {
  crop: CropState;
  setCropState: (partial: Partial<CropState>) => void;
  resetCrop: () => void;
  cancelCrop: () => void;
  commitCrop: (overrideRect?: Rectangle | null) => Promise<void>;
};

const selectCrop = (state: ReturnType<typeof useAppStore.getState>) => state.crop;
const selectSetCropState = (state: ReturnType<typeof useAppStore.getState>) => state.setCropState;
const selectResetCrop = (state: ReturnType<typeof useAppStore.getState>) => state.resetCrop;
const selectCancelCrop = (state: ReturnType<typeof useAppStore.getState>) => state.cancelCrop;
const selectCommitCrop = (state: ReturnType<typeof useAppStore.getState>) => state.commitCrop;

export const useCropState = (): CropSelectors => {
  const crop = useAppStore(selectCrop);
  const setCropState = useAppStore(selectSetCropState);
  const resetCrop = useAppStore(selectResetCrop);
  const cancelCrop = useAppStore(selectCancelCrop);
  const commitCrop = useAppStore(selectCommitCrop);

  return useMemo(
    () => ({
      crop,
      setCropState,
      resetCrop,
      cancelCrop,
      commitCrop,
    }),
    [crop, setCropState, resetCrop, cancelCrop, commitCrop]
  );
};
