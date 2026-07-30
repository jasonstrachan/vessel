import { type BrushSettings } from '@/types';
import { drawPixelPerfectLine } from '@/brushes/shapes';
import { debugLog } from '@/utils/debug';
import {
  applyColorCycleBrushLayerSnapshotToRuntime,
  createEmptyColorCycleBrushLayerSnapshot,
  readColorCycleBrushLayerSnapshotFromRuntime,
  type ColorCycleBrushLayerSnapshot,
  type ColorCycleBrushLayerSnapshotRuntimeReader,
  type ColorCycleBrushLayerSnapshotRuntimeWriter,
} from '@/lib/colorCycle/document';

import {
  buildRoundedGridStrokePath,
  getColorCycleGridSnapSpacing,
  rasterizeGridLinePoints,
  rasterizeRectangularGridLinePoints,
  snapPointToColorCycleGrid,
  snapPointToRectangularColorCycleGrid,
  type GridSnapPoint,
} from './colorCycleGridSnap';

export type ColorCycleStrokeRoutingBrush =
  & ColorCycleBrushLayerSnapshotRuntimeReader
  & ColorCycleBrushLayerSnapshotRuntimeWriter
  & {
    startStroke?: (layerId: string, clearBuffer?: boolean) => void;
  };

type StrokePreviewRender = (
  ctx: CanvasRenderingContext2D,
  applyOpacity?: boolean,
  options?: { withOverlay?: boolean },
) => void;

type StrokePreviewRefs = {
  firstStampImmediateRef: { current: boolean };
  mirrorScheduledRef: { current: boolean };
};

type StrokePreviewOptions = StrokePreviewRefs & {
  ctx: CanvasRenderingContext2D;
  renderColorCycle: StrokePreviewRender;
  withOverlay?: boolean;
  immediateWithOverlay?: boolean;
  scheduledWithOverlay?: boolean;
};

export const scheduleColorCycleStrokePreview = ({
  ctx,
  renderColorCycle,
  firstStampImmediateRef,
  mirrorScheduledRef,
  withOverlay = true,
  immediateWithOverlay = withOverlay,
  scheduledWithOverlay = withOverlay,
}: StrokePreviewOptions): void => {
  const renderPreview = (useOverlay: boolean) => {
    mirrorScheduledRef.current = false;
    if (!useOverlay) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);
    }
    renderColorCycle(ctx, true, useOverlay ? undefined : { withOverlay: false });
  };

  if (firstStampImmediateRef.current) {
    firstStampImmediateRef.current = false;
    renderPreview(immediateWithOverlay);
  } else if (!mirrorScheduledRef.current) {
    mirrorScheduledRef.current = true;
    const renderScheduledPreview = () => renderPreview(scheduledWithOverlay);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(renderScheduledPreview);
    } else {
      renderScheduledPreview();
    }
  }
};

type CustomSnapStrokeOptions = StrokePreviewRefs & {
  x: number;
  y: number;
  customSnapSpacing: { x: number; y: number } | null;
  gridSnapStrokePointRef: { current: GridSnapPoint | null };
  ctx: CanvasRenderingContext2D;
  renderColorCycle: StrokePreviewRender;
  paintStrokePoint: (x: number, y: number) => void;
  healPaintedEraseMask: () => void;
};

export const handleCustomSnapColorCycleStroke = ({
  x,
  y,
  customSnapSpacing,
  gridSnapStrokePointRef,
  ctx,
  renderColorCycle,
  paintStrokePoint,
  healPaintedEraseMask,
  firstStampImmediateRef,
  mirrorScheduledRef,
}: CustomSnapStrokeOptions): boolean => {
  if (!customSnapSpacing) {
    return false;
  }

  const snappedPoint = snapPointToRectangularColorCycleGrid(
    { x, y },
    customSnapSpacing.x,
    customSnapSpacing.y,
  );
  const previousPoint = gridSnapStrokePointRef.current;
  const hasAdvancedAnchor = !isSameGridPoint(previousPoint, snappedPoint);
  const pathPoints = hasAdvancedAnchor
    ? (previousPoint
      ? rasterizeRectangularGridLinePoints(
        previousPoint,
        snappedPoint,
        customSnapSpacing.x,
        customSnapSpacing.y,
      ).slice(1)
      : [snappedPoint])
    : [];

  if (hasAdvancedAnchor) {
    paintPathPoints(pathPoints, paintStrokePoint);
    gridSnapStrokePointRef.current = snappedPoint;
  }
  healPaintedEraseMask();
  scheduleColorCycleStrokePreview({
    ctx,
    renderColorCycle,
    firstStampImmediateRef,
    mirrorScheduledRef,
    withOverlay: false,
  });
  return true;
};

type GridSnapStrokeOptions = StrokePreviewRefs & {
  x: number;
  y: number;
  layerId: string;
  brushSettings: Pick<BrushSettings, 'gridSnapEnabled' | 'gridSnapSize' | 'roundedCornersEnabled' | 'cornerRadiusPx'>;
  colorCycleBrush: ColorCycleStrokeRoutingBrush;
  gridSnapStrokePointRef: { current: GridSnapPoint | null };
  roundedCornerAnchorsRef: { current: GridSnapPoint[] };
  roundedCornerBaselineSnapshotRef: { current: ColorCycleBrushLayerSnapshot | null };
  ctx: CanvasRenderingContext2D;
  renderColorCycle: StrokePreviewRender;
  paintStrokePoint: (x: number, y: number) => void;
  healPaintedEraseMask: () => void;
};

export const handleGridSnapColorCycleStroke = ({
  x,
  y,
  layerId,
  brushSettings,
  colorCycleBrush,
  gridSnapStrokePointRef,
  roundedCornerAnchorsRef,
  roundedCornerBaselineSnapshotRef,
  ctx,
  renderColorCycle,
  paintStrokePoint,
  healPaintedEraseMask,
  firstStampImmediateRef,
  mirrorScheduledRef,
}: GridSnapStrokeOptions): boolean => {
  if (!brushSettings.gridSnapEnabled) {
    return false;
  }

  const snappedPoint = snapPointToColorCycleGrid(
    { x, y },
    getColorCycleGridSnapSpacing(brushSettings.gridSnapSize),
  );
  const previousPoint = gridSnapStrokePointRef.current;
  const hasAdvancedAnchor = !isSameGridPoint(previousPoint, snappedPoint);
  let pathPoints: GridSnapPoint[] = hasAdvancedAnchor
    ? (previousPoint ? rasterizeGridLinePoints(previousPoint, snappedPoint).slice(1) : [snappedPoint])
    : [];

  if (brushSettings.roundedCornersEnabled) {
    pathPoints = resolveRoundedGridPath({
      hasAdvancedAnchor,
      snappedPoint,
      colorCycleBrush,
      layerId,
      radiusPx: brushSettings.cornerRadiusPx,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
      fallbackPathPoints: pathPoints,
    });
  } else {
    updateGridAnchors({
      hasAdvancedAnchor,
      snappedPoint,
      roundedCornerAnchorsRef,
      roundedCornerBaselineSnapshotRef,
    });
  }

  if (hasAdvancedAnchor) {
    paintPathPoints(pathPoints, paintStrokePoint);
    gridSnapStrokePointRef.current = snappedPoint;
  }
  healPaintedEraseMask();
  scheduleColorCycleStrokePreview({
    ctx,
    renderColorCycle,
    firstStampImmediateRef,
    mirrorScheduledRef,
    withOverlay: false,
  });
  return true;
};

type FreehandStrokeOptions = StrokePreviewRefs & {
  x: number;
  y: number;
  speedSamplePxPerMs?: number;
  brushSize: number;
  usePixelPerfectLine: boolean;
  ctx: CanvasRenderingContext2D;
  renderColorCycle: StrokePreviewRender;
  paintStrokePoint: (x: number, y: number) => void;
  healPaintedEraseMask: () => void;
  strokePointRef: { current: GridSnapPoint | null };
};

export const handleFreehandColorCycleStroke = ({
  x,
  y,
  speedSamplePxPerMs,
  brushSize,
  usePixelPerfectLine,
  ctx,
  renderColorCycle,
  paintStrokePoint,
  healPaintedEraseMask,
  strokePointRef,
  firstStampImmediateRef,
  mirrorScheduledRef,
}: FreehandStrokeOptions): void => {
  const currentPoint = usePixelPerfectLine
    ? { x: Math.round(x), y: Math.round(y) }
    : { x, y };
  const previousPoint = strokePointRef.current;
  const segDist = previousPoint
    ? Math.hypot(currentPoint.x - previousPoint.x, currentPoint.y - previousPoint.y)
    : 0;

  if (
    process.env.NODE_ENV !== 'production' &&
    typeof globalThis !== 'undefined' &&
    (globalThis as { __CC_NON_DITHER_DEBUG?: boolean }).__CC_NON_DITHER_DEBUG === true
  ) {
    debugLog('raw-console', '[cc-stroke-input]', {
      x,
      y,
      segDist,
      speedSamplePxPerMs: speedSamplePxPerMs ?? null,
      brushSize,
      gridSnapEnabled: false,
    });
  }

  if (usePixelPerfectLine && previousPoint) {
    let isSegmentStart = true;
    drawPixelPerfectLine(
      ctx,
      previousPoint.x,
      previousPoint.y,
      currentPoint.x,
      currentPoint.y,
      (pixelX, pixelY) => {
        if (isSegmentStart) {
          isSegmentStart = false;
          return;
        }
        paintStrokePoint(pixelX, pixelY);
      },
    );
  } else {
    paintStrokePoint(x, y);
  }
  strokePointRef.current = currentPoint;
  healPaintedEraseMask();
  scheduleColorCycleStrokePreview({
    ctx,
    renderColorCycle,
    firstStampImmediateRef,
    mirrorScheduledRef,
    immediateWithOverlay: false,
    scheduledWithOverlay: true,
  });
};

const resolveRoundedGridPath = ({
  hasAdvancedAnchor,
  snappedPoint,
  colorCycleBrush,
  layerId,
  radiusPx,
  roundedCornerAnchorsRef,
  roundedCornerBaselineSnapshotRef,
  fallbackPathPoints,
}: {
  hasAdvancedAnchor: boolean;
  snappedPoint: GridSnapPoint;
  colorCycleBrush: ColorCycleStrokeRoutingBrush;
  layerId: string;
  radiusPx?: number;
  roundedCornerAnchorsRef: { current: GridSnapPoint[] };
  roundedCornerBaselineSnapshotRef: { current: ColorCycleBrushLayerSnapshot | null };
  fallbackPathPoints: GridSnapPoint[];
}): GridSnapPoint[] => {
  if (hasAdvancedAnchor && !roundedCornerBaselineSnapshotRef.current) {
    roundedCornerBaselineSnapshotRef.current = readColorCycleBrushLayerSnapshotFromRuntime(
      colorCycleBrush,
      layerId,
    ) ?? createEmptyColorCycleBrushLayerSnapshot();
  }

  appendGridAnchor(hasAdvancedAnchor, snappedPoint, roundedCornerAnchorsRef);
  if (!hasAdvancedAnchor) {
    return fallbackPathPoints;
  }

  const roundedPath = buildRoundedGridStrokePath(
    roundedCornerAnchorsRef.current,
    Math.max(1, Math.round(radiusPx ?? 8)),
  );
  if (roundedCornerBaselineSnapshotRef.current) {
    applyColorCycleBrushLayerSnapshotToRuntime(
      colorCycleBrush,
      layerId,
      roundedCornerBaselineSnapshotRef.current,
    );
  }
  colorCycleBrush.startStroke?.(layerId, false);
  return roundedPath;
};

const updateGridAnchors = ({
  hasAdvancedAnchor,
  snappedPoint,
  roundedCornerAnchorsRef,
  roundedCornerBaselineSnapshotRef,
}: {
  hasAdvancedAnchor: boolean;
  snappedPoint: GridSnapPoint;
  roundedCornerAnchorsRef: { current: GridSnapPoint[] };
  roundedCornerBaselineSnapshotRef: { current: ColorCycleBrushLayerSnapshot | null };
}): void => {
  appendGridAnchor(hasAdvancedAnchor, snappedPoint, roundedCornerAnchorsRef);
  if (!hasAdvancedAnchor && roundedCornerAnchorsRef.current.length === 0) {
    roundedCornerAnchorsRef.current = [snappedPoint];
  }
  roundedCornerBaselineSnapshotRef.current = null;
};

const appendGridAnchor = (
  hasAdvancedAnchor: boolean,
  snappedPoint: GridSnapPoint,
  roundedCornerAnchorsRef: { current: GridSnapPoint[] },
): void => {
  const anchors = roundedCornerAnchorsRef.current;
  const lastAnchor = anchors[anchors.length - 1];
  if (
    hasAdvancedAnchor &&
    (!lastAnchor || lastAnchor.x !== snappedPoint.x || lastAnchor.y !== snappedPoint.y)
  ) {
    roundedCornerAnchorsRef.current = [...anchors, snappedPoint];
  }
};

const paintPathPoints = (
  pathPoints: GridSnapPoint[],
  paintStrokePoint: (x: number, y: number) => void,
): void => {
  for (const point of pathPoints) {
    paintStrokePoint(point.x, point.y);
  }
};

const isSameGridPoint = (
  previousPoint: GridSnapPoint | null,
  snappedPoint: GridSnapPoint,
): boolean => (
  !!previousPoint &&
  previousPoint.x === snappedPoint.x &&
  previousPoint.y === snappedPoint.y
);
