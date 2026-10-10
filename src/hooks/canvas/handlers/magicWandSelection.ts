import { floodSelect } from '@/utils/floodSelect';
import { resolveLayerImageData } from '@/stores/helpers/selectionCapture';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { captureSelectionSnapshot, commitSelectionHistory } from '@/history/helpers/selectionHistory';
import type { Layer, ToolState } from '@/types';
import { applyMaskSelectionResult } from './selectionApply';

type Point = { x: number; y: number };

type ApplyMagicWandSelectionArgs = {
  activeLayer: Layer | undefined;
  activeLayerId: string | null;
  worldPos: Point;
  wandSettings: ToolState['wandSettings'];
  append: boolean;
  clearSelection: () => void;
};

export const applyMagicWandSelection = ({
  activeLayer,
  activeLayerId,
  worldPos,
  wandSettings,
  append,
}: ApplyMagicWandSelectionArgs): boolean => {
  if (!activeLayer || !activeLayerId) {
    return false;
  }

  const currentImageData = resolveLayerImageData(activeLayer, getAppStoreState());
  if (!currentImageData) {
    return true;
  }

  const selection = floodSelect(
    currentImageData,
    Math.floor(worldPos.x),
    Math.floor(worldPos.y),
    {
      threshold: wandSettings.threshold,
      contiguous: wandSettings.contiguous,
    }
  );

  if (!selection) {
    return true;
  }

  const before = captureSelectionSnapshot();
  const { bounds, mask } = selection;
  applyMaskSelectionResult({
    append,
    mask,
    bounds,
    layerId: activeLayerId,
  });
  commitSelectionHistory({
    before,
    description: before.start && before.end ? 'Adjust selection' : 'Create selection',
    meta: { source: 'magic-wand', append },
  });
  return true;
};
