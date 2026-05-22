import { BrushShape, type BrushSettings } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import {
  buildCcStrokeShapeGeometry,
  type CcStrokeSample,
} from '@/hooks/canvas/handlers/shapes/ccStrokeShapeGeometry';
import {
  buildCcGradientDrawingGeometry,
  isDragDefinedCcGradientShape,
  isPolygonCcGradientShape,
  type CcGradientDrawingGeometry,
} from '@/hooks/canvas/handlers/shapes/ccGradientDrawingGeometry';

type MutableRef<T> = { current: T };
type Point = { x: number; y: number };

type CcGradientDrawingRefs = {
  shapePointsRef: MutableRef<Point[]>;
  ccStrokeDirectionRef: MutableRef<Point | null>;
  ccGradientDrawingGeometryRef: MutableRef<CcGradientDrawingGeometry | null>;
};

export const isCcGradientStrokeMode = (state: AppState): boolean =>
  state.currentBrushPreset?.id === 'color-cycle-gradient' &&
  state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
  state.tools.brushSettings.colorCycleFillMode === 'stroke' &&
  (state.tools.brushSettings.ccGradientDrawingShape === undefined ||
    state.tools.brushSettings.ccGradientDrawingShape === 'freehand');

export const isCcGradientDragDefinedShapeMode = (state: AppState): boolean =>
  state.currentBrushPreset?.id === 'color-cycle-gradient' &&
  state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
  isDragDefinedCcGradientShape(state.tools.brushSettings.ccGradientDrawingShape);

export const isCcGradientPolygonDrawingShapeMode = (state: AppState): boolean =>
  state.currentBrushPreset?.id === 'color-cycle-gradient' &&
  state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
  isPolygonCcGradientShape(state.tools.brushSettings.ccGradientDrawingShape);

export const rebuildCcStrokeShapeFromSamples = (
  refs: CcGradientDrawingRefs & { ccStrokeSamplesRef: MutableRef<CcStrokeSample[]> },
  brushSettings: BrushSettings
): boolean => {
  const geometry = buildCcStrokeShapeGeometry({
    samples: refs.ccStrokeSamplesRef.current,
    brushSettings,
  });
  if (!geometry) {
    refs.shapePointsRef.current = [];
    refs.ccStrokeDirectionRef.current = null;
    refs.ccGradientDrawingGeometryRef.current = null;
    return false;
  }

  refs.shapePointsRef.current = geometry.shapePoints;
  refs.ccStrokeDirectionRef.current = geometry.direction;
  refs.ccGradientDrawingGeometryRef.current = {
    shapePoints: geometry.shapePoints.map(point => ({ ...point })),
    sampleSourcePoints: geometry.centerline.map(({ x, y }) => ({ x, y })),
    direction: geometry.direction,
    bounds: geometry.bounds,
  };
  return true;
};

export const rebuildCcGradientDragGeometry = ({
  refs,
  brushSettings,
  pressure,
  constrainAspect,
}: {
  refs: CcGradientDrawingRefs & {
    shapeDragStartRef: MutableRef<Point | null>;
    shapeDragLastRef: MutableRef<Point | null>;
  };
  brushSettings: BrushSettings;
  pressure?: number;
  constrainAspect?: boolean;
}): boolean => {
  const drawingShape = brushSettings.ccGradientDrawingShape;
  if (!isDragDefinedCcGradientShape(drawingShape)) {
    return false;
  }

  const geometry = buildCcGradientDrawingGeometry({
    drawingShape,
    start: refs.shapeDragStartRef.current,
    end: refs.shapeDragLastRef.current,
    brushSettings,
    pressure,
    constrainAspect,
  });
  if (!geometry) {
    refs.shapePointsRef.current = [];
    refs.ccStrokeDirectionRef.current = null;
    refs.ccGradientDrawingGeometryRef.current = null;
    return false;
  }

  refs.shapePointsRef.current = geometry.shapePoints.map(point => ({ ...point }));
  refs.ccStrokeDirectionRef.current = geometry.direction ?? null;
  refs.ccGradientDrawingGeometryRef.current = geometry;
  return true;
};

export const rebuildCcGradientPolygonGeometry = (
  refs: CcGradientDrawingRefs,
  brushSettings: BrushSettings
): boolean => {
  if (!isPolygonCcGradientShape(brushSettings.ccGradientDrawingShape)) {
    return false;
  }

  const geometry = buildCcGradientDrawingGeometry({
    drawingShape: 'polygon',
    points: refs.shapePointsRef.current,
    brushSettings,
  });
  if (!geometry) {
    refs.ccGradientDrawingGeometryRef.current = null;
    refs.ccStrokeDirectionRef.current = null;
    return false;
  }

  refs.shapePointsRef.current = geometry.shapePoints.map(point => ({ ...point }));
  refs.ccStrokeDirectionRef.current = geometry.direction ?? null;
  refs.ccGradientDrawingGeometryRef.current = geometry;
  return true;
};

export const resolveFinalSampledShapeSourcePoints = (
  isStrokeFillFinalize: boolean,
  refs: { ccStrokeSamplesRef: MutableRef<CcStrokeSample[]> } &
    Partial<Pick<CcGradientDrawingRefs, 'ccGradientDrawingGeometryRef'>>,
  shapePointsSnapshot: Point[]
): Point[] => {
  const geometrySamplePoints = refs.ccGradientDrawingGeometryRef?.current?.sampleSourcePoints;
  if (geometrySamplePoints && geometrySamplePoints.length > 0) {
    return geometrySamplePoints.map(point => ({ ...point }));
  }

  if (!isStrokeFillFinalize) {
    return shapePointsSnapshot;
  }

  return refs.ccStrokeSamplesRef.current.map(({ x, y }) => ({ x, y }));
};
