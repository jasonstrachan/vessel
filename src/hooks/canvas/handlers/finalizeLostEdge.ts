import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings } from '@/types';
import { applyPolygonLostEdgeErosion } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';

export const applyFinalizePolygonLostEdge = ({
  isColorCycleLayer,
  drawingCtxRef,
  drawingCanvasRef,
  storeRef,
  activeSettings,
  shapePointsRef,
  logDevStats = false,
}: {
  isColorCycleLayer: boolean;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  storeRef: React.MutableRefObject<AppState>;
  activeSettings: BrushSettings;
  shapePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  logDevStats?: boolean;
}): void => {
  if (isColorCycleLayer || !drawingCanvasRef.current || !drawingCtxRef.current) {
    return;
  }

  const polyState = storeRef.current.polygonGradientState;
  applyPolygonLostEdgeErosion({
    ctx: drawingCtxRef.current,
    canvas: drawingCanvasRef.current,
    brushShape: activeSettings.brushShape,
    lostEdge: activeSettings.lostEdge,
    thickness: activeSettings.thickness,
    spacing: activeSettings.spacing,
    polygonVertices: polyState.vertices,
    polygonPoints: polyState.points,
    fallbackPoints: shapePointsRef.current,
    logDevStats,
  });
};
