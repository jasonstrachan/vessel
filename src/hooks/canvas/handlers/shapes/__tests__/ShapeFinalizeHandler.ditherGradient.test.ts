import type React from 'react';

import {
  finalizeDitherGradientShape,
  finalizeRasterShapeFill,
} from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import { boundingBoxToCaptureRegion } from '@/hooks/canvas/utils/captureRegions';
import { applyLostEdgeErosionToContext } from '@/shapeFill/lostEdgeErosion';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, ShapePoint } from '@/types';
import { BrushShape } from '@/types';

jest.mock('@/shapeFill/lostEdgeErosion', () => ({
  applyLostEdgeErosionToContext: jest.fn(),
}));

const mockApplyLostEdgeErosionToContext =
  applyLostEdgeErosionToContext as jest.MockedFunction<typeof applyLostEdgeErosionToContext>;

describe('Dither Gradient finalization', () => {
  beforeEach(() => {
    mockApplyLostEdgeErosionToContext.mockClear();
  });

  it('applies opacity and Lostedge exactly once across the finalization flow', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 64;
    const drawCtx = canvas.getContext('2d') as CanvasRenderingContext2D;
    let alphaAtDraw = -1;
    jest.spyOn(drawCtx, 'drawImage').mockImplementation(() => {
      alphaAtDraw = drawCtx.globalAlpha;
    });
    const points: ShapePoint[] = [
      { x: 4, y: 4 },
      { x: 40, y: 4 },
      { x: 40, y: 40 },
      { x: 4, y: 40 },
    ];
    const liveBrushSettings = {
      brushShape: BrushShape.DITHER_GRADIENT,
      opacity: 0.25,
      color: '#000000',
      ditherEnabled: true,
      ditherAlgorithm: 'bayer',
      ditherGradStops: ['#000000', '#ffffff'],
      ditherGradBgFill: true,
      fillResolution: 1,
      lostEdge: 30,
    } as unknown as BrushSettings;
    const latestShapePixelSizeRef = { current: null };

    const result = finalizeDitherGradientShape({
      drawCtx,
      canvas,
      drawingCanvasHasContent: { current: false },
      liveBrushSettings,
      polygonState: {
        vertices: points,
        points: [],
      } as unknown as AppState['polygonGradientState'],
      shapePoints: points,
      palette: {
        foregroundColor: '#000000',
        backgroundColor: '#ffffff',
      } as AppState['palette'],
      project: {
        width: 64,
        height: 64,
        ccCustomTilePatterns: [],
      } as unknown as AppState['project'],
      strokeBoundingBoxRef: { current: null },
      strokeCapturePaddingRef: { current: 0 },
      roiPadding: 2,
      lastStablePressure: 0.5,
      latestShapePixelSizeRef,
      computeShapePixelSize: () => 1,
    });

    expect(result).toEqual(points);
    expect(alphaAtDraw).toBe(0.25);
    expect(mockApplyLostEdgeErosionToContext).toHaveBeenCalledTimes(1);

    finalizeRasterShapeFill({
      drawCtx,
      brushRuntime: {},
      storeRef: {
        current: {
          layers: [],
          activeLayerId: null,
          tools: { brushSettings: liveBrushSettings },
        },
      } as unknown as React.MutableRefObject<AppState>,
      liveBrushSettings,
      shapePoints: points,
      ditherGradPoints: points,
      strokeBoundingBox: null,
      project: { width: 64, height: 64 },
      roiPadding: 2,
      computeAutoSampleStops: jest.fn(() => null),
      setSharedColorCycleGradient: jest.fn(),
      computeShapePixelSize: () => 1,
      hadValidShapePressureRef: { current: false },
      lastStablePressureRef: { current: 0.5 },
      latestShapePixelSizeRef,
      boundingBoxToCaptureRegion,
      logError: jest.fn(),
    });

    expect(mockApplyLostEdgeErosionToContext).toHaveBeenCalledTimes(1);
  });
});
