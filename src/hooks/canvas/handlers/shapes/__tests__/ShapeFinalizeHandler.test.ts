import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, ShapePoint } from '@/types';
import { BrushShape } from '@/types';
import { finalizeRasterShapeFill } from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';

describe('ShapeFinalizeHandler', () => {
  it('uses latest brush color from store for dither-shape finalize override', () => {
    const applyStrokeDither = jest.fn();
    const setBrushSettings = jest.fn();

    const liveBrushSettings = {
      brushShape: BrushShape.PIXEL_DITHER,
      color: '#000000',
      ditherEnabled: true,
      ditherBackgroundFill: true,
      fillResolution: 4,
      pressureLinkedFillResolution: false,
      antialiasing: false,
      opacity: 1,
      blendMode: 'source-over',
    } as unknown as BrushSettings;

    const latestStoreBrushSettings = {
      ...liveBrushSettings,
      color: '#FF00AA',
    } as BrushSettings;

    const storeRef = {
      current: {
        tools: {
          brushSettings: latestStoreBrushSettings,
        },
        setBrushSettings,
      },
    } as unknown as React.MutableRefObject<AppState>;

    const drawCtx = {
      canvas: { width: 64, height: 64 },
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      fillStyle: '',
      beginPath: jest.fn(),
      moveTo: jest.fn(),
      lineTo: jest.fn(),
      closePath: jest.fn(),
      fill: jest.fn(),
      save: jest.fn(),
      restore: jest.fn(),
      clearRect: jest.fn(),
      createPattern: jest.fn(() => null),
      fillRect: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    const shapePoints: ShapePoint[] = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 10, y: 20 },
    ];

    finalizeRasterShapeFill(
      {
        drawCtx,
        brushEngine: {
          applyStrokeDither,
        } as unknown as Parameters<typeof finalizeRasterShapeFill>[0]['brushEngine'],
        storeRef,
        liveBrushSettings,
        shapePoints,
        ditherGradPoints: null,
        strokeBoundingBox: null,
        project: { width: 64, height: 64 },
        roiPadding: 4,
        computeAutoSampleStops: jest.fn(() => null),
        setSharedColorCycleGradient: jest.fn(),
        computeShapePixelSize: jest.fn(() => 5),
        hadValidShapePressureRef: { current: false },
        lastStablePressureRef: { current: 0.5 },
        latestShapePixelSizeRef: { current: null },
        boundingBoxToCaptureRegion: jest.fn(() => ({ x: 0, y: 0, width: 64, height: 64 })),
        logError: jest.fn(),
        ccDebug: { on: false, verbose: false },
      }
    );

    expect(applyStrokeDither).toHaveBeenCalled();
    const ditherArgs = applyStrokeDither.mock.calls[0]?.[3];
    expect(ditherArgs.settingsOverride.color).toBe('#FF00AA');
  });
});
