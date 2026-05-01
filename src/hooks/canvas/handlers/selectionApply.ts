import { getAppStoreState } from '@/stores/appStoreAccess';
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
  selectionLastAction: {
    action: 'set-bounds' as const,
    source: vectorPath?.mode === 'freehand' ? 'selection-freehand' : 'selection-mask',
    ownerKind: 'mask-selection' as const,
    restoredFromHistory: false,
    t: Date.now(),
    activeLayerId: layerId,
    maskLayerId: layerId,
    bounds,
  },
});

export const applyMaskSelectionResult = ({
  append,
  mask,
  bounds,
  layerId = null,
  vectorPath = null,
}: ApplyMaskSelectionResultArgs): void => {
  if (append) {
    getAppStoreState().appendSelectionMask({
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
