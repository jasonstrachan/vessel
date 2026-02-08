import type React from 'react';

export const triggerShapePreviewThrottled = ({
  lastPreviewTsRef,
  rendererRef,
  frameMs = 16,
}: {
  lastPreviewTsRef: React.MutableRefObject<number>;
  rendererRef: React.MutableRefObject<(() => void) | null>;
  frameMs?: number;
}): void => {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (now - lastPreviewTsRef.current < frameMs) {
    return;
  }
  lastPreviewTsRef.current = now;
  rendererRef.current?.();
};

export const setShapePreviewRenderer = ({
  rendererRef,
  renderer,
}: {
  rendererRef: React.MutableRefObject<(() => void) | null>;
  renderer: (() => void) | null;
}): void => {
  rendererRef.current = renderer;
};

export const createShapePreviewDispatchers = ({
  lastPreviewTsRef,
  rendererRef,
}: {
  lastPreviewTsRef: React.MutableRefObject<number>;
  rendererRef: React.MutableRefObject<(() => void) | null>;
}) => ({
  triggerSimpleShapePreview: () => {
    triggerShapePreviewThrottled({
      lastPreviewTsRef,
      rendererRef,
      frameMs: 16,
    });
  },
  setSimpleShapePreviewRenderer: (renderer: (() => void) | null) => {
    setShapePreviewRenderer({
      rendererRef,
      renderer,
    });
  },
});
