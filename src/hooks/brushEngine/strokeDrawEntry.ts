import type { BrushStrokeParams, CustomBrushStrokeData } from './BrushEngineFacade';

type StrokePoint = { x: number; y: number };

type RunStrokeDrawCoreArgs = {
  ctx: CanvasRenderingContext2D;
  from: StrokePoint;
  to: StrokePoint;
  rawPressure: number;
  customBrushData?: CustomBrushStrokeData;
  sampleTag: { x: number; y: number; tag: string };
  enableLargeRegionFallback: boolean;
  makeStrokeParams: (smoothedPressure: number) => BrushStrokeParams;
};

export type RunStrokeDrawCore = (args: RunStrokeDrawCoreArgs) => void;

type DrawBrushCursor = {
  pressure?: number;
  customBrushData?: CustomBrushStrokeData;
};

export const runDrawBrushEntry = ({
  ctx,
  from,
  to,
  cursor,
  beginStroke,
  runStrokeDrawCore,
}: {
  ctx: CanvasRenderingContext2D;
  from: StrokePoint;
  to: StrokePoint;
  cursor: DrawBrushCursor;
  beginStroke: (x: number, y: number) => void;
  runStrokeDrawCore: RunStrokeDrawCore;
}): void => {
  beginStroke(to.x, to.y);

  const deltaX = to.x - from.x;
  const deltaY = to.y - from.y;
  const velocity = Math.sqrt(deltaX * deltaX + deltaY * deltaY);

  runStrokeDrawCore({
    ctx,
    from,
    to,
    rawPressure: cursor.pressure ?? 1.0,
    customBrushData: cursor.customBrushData,
    sampleTag: { x: to.x, y: to.y, tag: 'drawBrush' },
    enableLargeRegionFallback: true,
    makeStrokeParams: (smoothedPressure) => ({
      from,
      to,
      pressure: smoothedPressure,
      velocity,
      timestamp: Date.now(),
      customBrushData: cursor.customBrushData,
    }),
  });
};

export const runDrawStampEntry = ({
  ctx,
  x,
  y,
  pressure,
  beginStroke,
  runStrokeDrawCore,
}: {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  pressure: number;
  beginStroke: (x: number, y: number) => void;
  runStrokeDrawCore: RunStrokeDrawCore;
}): void => {
  beginStroke(x, y);

  runStrokeDrawCore({
    ctx,
    from: { x, y },
    to: { x, y },
    rawPressure: pressure ?? 0,
    sampleTag: { x, y, tag: 'drawStamp' },
    enableLargeRegionFallback: false,
    makeStrokeParams: (smoothedPressure) => ({
      from: { x, y },
      to: { x, y },
      pressure: smoothedPressure,
      velocity: 0,
      timestamp: Date.now(),
    }),
  });
};
