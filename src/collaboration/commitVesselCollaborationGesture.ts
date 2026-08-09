import type React from 'react';

import type { VesselCollaborationPoint } from './vesselCollaborationProtocol';

export interface VesselCanonicalGestureHandlers {
  startDrawing: (point: { x: number; y: number }, pressure?: number) => void;
  continueDrawing: (point: { x: number; y: number }, pressure?: number) => void;
  finalizeDrawing: (options?: boolean | { skipSave?: boolean }) => Promise<void>;
  startShapeDrawing: (
    point: { x: number; y: number },
    pressure?: number,
    timestamp?: number,
    rawPressure?: number,
    options?: { renderPreview?: boolean; constrainAspect?: boolean },
  ) => boolean;
  continueShapeDrawing: (
    point: { x: number; y: number },
    pressure?: number,
    timestamp?: number,
    rawPressure?: number,
    options?: { renderPreview?: boolean; constrainAspect?: boolean },
  ) => void;
  finalizeShapeDrawing: () => Promise<void>;
  isSelectingDirectionRef?: React.MutableRefObject<boolean>;
  directionPreviewRef?: React.MutableRefObject<{ x: number; y: number } | null>;
  ccStrokeDirectionRef?: React.MutableRefObject<{ x: number; y: number } | null>;
}

export type VesselCanonicalGesture =
  | { kind: 'stroke'; points: VesselCollaborationPoint[] }
  | {
      kind: 'shape';
      points: VesselCollaborationPoint[];
      direction?: VesselCollaborationPoint[];
    };

const pointPressure = (point: VesselCollaborationPoint) => point.pressure ?? 1;
const MAX_CANONICAL_SHAPE_START_ATTEMPTS = 300;

const waitForCanonicalShapeReadiness = () => new Promise<void>((resolve) => {
  requestAnimationFrame(() => resolve());
});

const startCanonicalShapeStage = async ({
  handlers,
  point,
  failureMessage,
}: {
  handlers: VesselCanonicalGestureHandlers;
  point: VesselCollaborationPoint;
  failureMessage: string;
}) => {
  for (let attempt = 0; attempt < MAX_CANONICAL_SHAPE_START_ATTEMPTS; attempt += 1) {
    const pressure = pointPressure(point);
    if (handlers.startShapeDrawing(
      point,
      pressure,
      performance.now(),
      pressure,
      { renderPreview: false },
    )) {
      return;
    }
    await waitForCanonicalShapeReadiness();
  }
  throw new Error(failureMessage);
};

export const commitVesselCollaborationGesture = async ({
  gesture,
  handlers,
}: {
  gesture: VesselCanonicalGesture;
  handlers: VesselCanonicalGestureHandlers;
}) => {
  const first = gesture.points[0];
  if (!first) throw new Error('Canonical gesture requires at least one point');

  if (gesture.kind === 'shape' && gesture.direction && !handlers.isSelectingDirectionRef) {
    throw new Error('Canonical shape direction runtime is unavailable');
  }

  if (gesture.kind === 'stroke') {
    handlers.startDrawing(first, pointPressure(first));
    for (const point of gesture.points.slice(1)) {
      handlers.continueDrawing(point, pointPressure(point));
    }
    await handlers.finalizeDrawing();
    return;
  }

  await startCanonicalShapeStage({
    handlers,
    point: first,
    failureMessage: 'Vessel refused to begin the canonical shape',
  });
  for (const point of gesture.points.slice(1)) {
    handlers.continueShapeDrawing(
      point,
      pointPressure(point),
      performance.now(),
      pointPressure(point),
      { renderPreview: false },
    );
  }

  if (gesture.direction) {
    const directionStart = gesture.direction[0];
    const directionEnd = gesture.direction.at(-1);
    if (!directionStart || !directionEnd || !handlers.isSelectingDirectionRef) {
      throw new Error('Canonical shape direction runtime is unavailable');
    }
    handlers.isSelectingDirectionRef.current = true;
    if (handlers.ccStrokeDirectionRef) {
      handlers.ccStrokeDirectionRef.current = {
        x: directionEnd.x - directionStart.x,
        y: directionEnd.y - directionStart.y,
      };
    }
    await startCanonicalShapeStage({
      handlers,
      point: directionEnd,
      failureMessage: 'Vessel refused to commit the canonical shape direction',
    });
  }

  await handlers.finalizeShapeDrawing();
};
