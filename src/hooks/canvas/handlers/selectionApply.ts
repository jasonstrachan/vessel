import { useAppStore } from '@/stores/useAppStore';
import type { Rectangle } from '@/types';

type Point = { x: number; y: number };

type SelectionVectorPath = {
  mode: 'freehand' | 'click-line';
  points: Point[];
} | null;

type ApplyMaskSelectionResultArgs = {
  append: boolean;
  mask: ImageData;
  bounds: Rectangle;
  layerId?: string | null;
  vectorPath?: SelectionVectorPath;
};

export const buildMaskSelectionState = ({
  mask,
  bounds,
  layerId = null,
  vectorPath = null,
}: Omit<ApplyMaskSelectionResultArgs, 'append'>) => ({
  selectionStart: { x: bounds.x, y: bounds.y },
  selectionEnd: { x: bounds.x + bounds.width, y: bounds.y + bounds.height },
  selectionVectorPath: vectorPath,
  selectionMask: mask,
  selectionMaskBounds: bounds,
  selectionMaskLayerId: layerId,
});

export const applyMaskSelectionResult = ({
  append,
  mask,
  bounds,
  layerId = null,
  vectorPath = null,
}: ApplyMaskSelectionResultArgs): void => {
  if (append) {
    useAppStore.getState().appendSelectionMask({
      mask,
      bounds,
      layerId,
    });
    return;
  }

  useAppStore.setState(
    buildMaskSelectionState({
      mask,
      bounds,
      layerId,
      vectorPath,
    })
  );
};
