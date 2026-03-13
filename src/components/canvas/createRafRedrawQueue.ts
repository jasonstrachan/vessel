export interface RafRedrawQueue {
  schedule: () => void;
  cancel: () => void;
}

export const createRafRedrawQueue = (onRedraw: () => void): RafRedrawQueue => {
  let frameId: number | null = null;

  return {
    schedule: () => {
      if (frameId !== null) {
        return;
      }

      frameId = requestAnimationFrame(() => {
        frameId = null;
        onRedraw();
      });
    },
    cancel: () => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
    },
  };
};
