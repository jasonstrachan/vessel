import { useAppStore } from '@/stores/useAppStore';
import type { CanvasSnapshot } from '@/types';

export const applyViewStateFromSnapshot = (snapshot: CanvasSnapshot): void => {
  const store = useAppStore.getState();

  if (snapshot.projectSize) {
    store.setProjectDimensions(snapshot.projectSize.width, snapshot.projectSize.height);
  }

  if (snapshot.canvasState) {
    store.setCanvasDimensions(
      snapshot.canvasState.canvasWidth,
      snapshot.canvasState.canvasHeight
    );
  }
};

