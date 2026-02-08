import type React from 'react';

type Point = { x: number; y: number };

export const resetShapeDragRefs = ({
  shapeDragStartRef,
  shapeDragLastRef,
  shapeDragMovedRef,
}: {
  shapeDragStartRef: React.MutableRefObject<Point | null>;
  shapeDragLastRef: React.MutableRefObject<Point | null>;
  shapeDragMovedRef: React.MutableRefObject<boolean>;
}): void => {
  shapeDragStartRef.current = null;
  shapeDragLastRef.current = null;
  shapeDragMovedRef.current = false;
};

export const createResetShapeDragRefsDispatcher = ({
  shapeDragStartRef,
  shapeDragLastRef,
  shapeDragMovedRef,
}: {
  shapeDragStartRef: React.MutableRefObject<Point | null>;
  shapeDragLastRef: React.MutableRefObject<Point | null>;
  shapeDragMovedRef: React.MutableRefObject<boolean>;
}): (() => void) => () =>
  resetShapeDragRefs({
    shapeDragStartRef,
    shapeDragLastRef,
    shapeDragMovedRef,
  });
