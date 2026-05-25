import { BrushShape, type BrushSettings } from '@/types';
import type { AppState } from '@/stores/useAppStore';
import {
  buildCcStrokeShapeGeometry,
  type CcStrokeSample,
} from '@/hooks/canvas/handlers/shapes/ccStrokeShapeGeometry';
import {
  arePointsDistinct,
  buildCcGradientDrawingGeometry,
  isClickLineCcGradientShape,
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

export type CcGradientClickLineSession = {
  active: boolean;
  points: Point[];
  previewPoint: Point | null;
  pressure?: number;
  rawPressure?: number;
};

export const createCcGradientClickLineSession = (): CcGradientClickLineSession => ({
  active: false,
  points: [],
  previewPoint: null,
});

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

export const isCcGradientClickLineDrawingShapeMode = (state: AppState): boolean =>
  state.currentBrushPreset?.id === 'color-cycle-gradient' &&
  state.tools.shapeMode &&
  state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE &&
  isClickLineCcGradientShape(state.tools.brushSettings.ccGradientDrawingShape);

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

export const rebuildCcGradientClickLineGeometry = ({
  refs,
  session,
  brushSettings,
  previewPoint = null,
  pressure,
}: {
  refs: CcGradientDrawingRefs;
  session: CcGradientClickLineSession;
  brushSettings: BrushSettings;
  previewPoint?: Point | null;
  pressure?: number;
}): boolean => {
  if (!isClickLineCcGradientShape(brushSettings.ccGradientDrawingShape)) {
    return false;
  }

  const geometry = buildCcGradientDrawingGeometry({
    drawingShape: 'click-line',
    points: session.points,
    previewPoint,
    brushSettings,
    pressure,
  });
  if (!geometry) {
    const previewShapePoints = previewPoint
      ? [...session.points, previewPoint]
      : session.points;
    refs.shapePointsRef.current = previewShapePoints.map(point => ({ ...point }));
    refs.ccGradientDrawingGeometryRef.current = null;
    refs.ccStrokeDirectionRef.current = null;
    return false;
  }

  refs.shapePointsRef.current = geometry.shapePoints.map(point => ({ ...point }));
  refs.ccStrokeDirectionRef.current = geometry.direction ?? null;
  refs.ccGradientDrawingGeometryRef.current = geometry;
  return true;
};

export const appendCcGradientClickLinePoint = ({
  refs,
  session,
  point,
  brushSettings,
  pressure,
  rawPressure,
}: {
  refs: CcGradientDrawingRefs;
  session: CcGradientClickLineSession;
  point: Point;
  brushSettings: BrushSettings;
  pressure?: number;
  rawPressure?: number;
}): boolean => {
  if (!isClickLineCcGradientShape(brushSettings.ccGradientDrawingShape)) {
    return false;
  }

  if (!session.active) {
    session.points = [];
  }
  session.active = true;
  session.previewPoint = null;
  session.pressure = pressure;
  session.rawPressure = rawPressure;
  const lastPoint = session.points[session.points.length - 1];
  if (lastPoint && !arePointsDistinct(lastPoint, point)) {
    return rebuildCcGradientClickLineGeometry({
      refs,
      session,
      brushSettings,
      pressure,
    });
  }
  session.points = [...session.points, { x: point.x, y: point.y }];
  return rebuildCcGradientClickLineGeometry({
    refs,
    session,
    brushSettings,
    pressure,
  });
};

export const previewCcGradientClickLinePoint = ({
  refs,
  session,
  point,
  brushSettings,
  pressure,
  rawPressure,
}: {
  refs: CcGradientDrawingRefs;
  session: CcGradientClickLineSession;
  point: Point;
  brushSettings: BrushSettings;
  pressure?: number;
  rawPressure?: number;
}): boolean => {
  if (!session.active || !isClickLineCcGradientShape(brushSettings.ccGradientDrawingShape)) {
    return false;
  }

  session.previewPoint = { x: point.x, y: point.y };
  session.pressure = pressure;
  session.rawPressure = rawPressure;
  return rebuildCcGradientClickLineGeometry({
    refs,
    session,
    brushSettings,
    previewPoint: session.previewPoint,
    pressure,
  });
};

export const prepareCcGradientClickLineFinalize = ({
  refs,
  session,
  brushSettings,
}: {
  refs: CcGradientDrawingRefs;
  session: CcGradientClickLineSession;
  brushSettings: BrushSettings;
}): boolean => {
  if (!session.active || session.points.length < 3 || !isClickLineCcGradientShape(brushSettings.ccGradientDrawingShape)) {
    return false;
  }

  const hasGeometry = rebuildCcGradientClickLineGeometry({
    refs,
    session,
    brushSettings,
    pressure: session.pressure,
  });
  if (!hasGeometry) {
    return false;
  }

  session.active = false;
  session.points = [];
  session.previewPoint = null;
  return true;
};

export const cancelCcGradientClickLineSession = (
  refs: CcGradientDrawingRefs,
  session: CcGradientClickLineSession
): boolean => {
  if (!session.active && session.points.length === 0 && !refs.ccGradientDrawingGeometryRef.current) {
    return false;
  }

  session.active = false;
  session.points = [];
  session.previewPoint = null;
  refs.shapePointsRef.current = [];
  refs.ccStrokeDirectionRef.current = null;
  refs.ccGradientDrawingGeometryRef.current = null;
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
