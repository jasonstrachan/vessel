import { floodSelect } from '@/utils/floodSelect';
import { resolveLayerImageData } from '@/stores/helpers/selectionCapture';
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
  clearSelection,
}: ApplyMagicWandSelectionArgs): boolean => {
  if (!activeLayer || !activeLayerId) {
    return false;
  }

  const currentImageData = resolveLayerImageData(activeLayer);
  if (!currentImageData) {
    clearSelection();
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
    clearSelection();
    return true;
  }

  const { bounds, mask } = selection;
  applyMaskSelectionResult({
    append,
    mask,
    bounds,
    layerId: activeLayerId,
  });
  return true;
};
