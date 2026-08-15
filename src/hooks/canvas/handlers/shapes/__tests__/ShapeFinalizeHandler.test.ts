import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import type { BrushSettings, ShapePoint } from '@/types';
import { BrushShape } from '@/types';
import {
  applyRasterShapeOpacity,
  applyTransparencyLockMaskToContext,
  finalizeRasterShapeFill,
  resolveDitherGradientFinalizeBrushSettings,
} from '@/hooks/canvas/handlers/shapes/ShapeFinalizeHandler';
import { boundingBoxToCaptureRegion } from '@/hooks/canvas/utils/captureRegions';

describe('ShapeFinalizeHandler', () => {
  it('applies brush opacity to finalized raster alpha without filling holes', () => {
    const image = {
      data: new Uint8ClampedArray([
        10, 20, 30, 255,
        40, 50, 60, 128,
        70, 80, 90, 0,
      ]),
    } as ImageData;
    const ctx = {
      getImageData: jest.fn(() => image),
      putImageData: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const region = { x: 2, y: 3, width: 3, height: 1 };

    applyRasterShapeOpacity(ctx, region, 0.25);

    expect(Array.from(image.data)).toEqual([
      10, 20, 30, 64,
      40, 50, 60, 32,
      70, 80, 90, 0,
    ]);
    expect(ctx.putImageData).toHaveBeenCalledWith(image, 2, 3);
  });

  it('uses current dither gradient settings over stale session settings on finalize', () => {
    const sessionBrushSettings = {
      brushShape: BrushShape.DITHER_GRADIENT,
      color: '#000000',
      ditherGradStops: ['#111111', '#111111'],
      ditherGradSampleEnabled: false,
      ditherGradBgFill: true,
      gradientLength: 50,
      trans: 0,
    } as unknown as BrushSettings;

    const currentBrushSettings = {
      ...sessionBrushSettings,
      brushShape: BrushShape.SQUARE,
      color: '#FF00AA',
      ditherGradStops: ['#0033FF', '#00FF66', '#FFEE00'],
      ditherGradSampleEnabled: true,
      ditherGradBgFill: false,
      gradientLength: 125,
      trans: 1,
    } as unknown as BrushSettings;

    const resolved = resolveDitherGradientFinalizeBrushSettings(
      sessionBrushSettings,
      currentBrushSettings
    );

    expect(resolved.brushShape).toBe(BrushShape.DITHER_GRADIENT);
    expect(resolved.color).toBe('#FF00AA');
    expect(resolved.ditherGradStops).toEqual(['#0033FF', '#00FF66', '#FFEE00']);
    expect(resolved.ditherGradSampleEnabled).toBe(true);
    expect(resolved.ditherGradBgFill).toBe(false);
    expect(resolved.gradientLength).toBe(125);
    expect(resolved.trans).toBe(1);
  });

  it('uses latest brush color from store for dither-shape finalize override', () => {
    const applyStrokeDither = jest.fn();
    const setBrushSettings = jest.fn();

    const liveBrushSettings = {
      brushShape: BrushShape.PIXEL_DITHER,
      color: '#000000',
      ditherEnabled: true,
      ditherBackgroundFill: true,
      fillResolution: 4,
      ditherPaletteSpread: 55,
      ditherPatternDiversity: 72,
      pressureLinkedFillResolution: false,
      antialiasing: false,
      opacity: 1,
      blendMode: 'source-over',
    } as unknown as BrushSettings;

    const latestStoreBrushSettings = {
      ...liveBrushSettings,
      color: '#FF00AA',
      opacity: 0.5,
    } as BrushSettings;
    const opacityImage = {
      data: new Uint8ClampedArray([255, 0, 170, 255]),
    } as ImageData;

    const storeRef = {
      current: {
        layers: [],
        activeLayerId: null,
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
      getImageData: jest.fn(() => opacityImage),
      putImageData: jest.fn(),
    } as unknown as CanvasRenderingContext2D;

    const shapePoints: ShapePoint[] = [
      { x: 10, y: 10 },
      { x: 20, y: 10 },
      { x: 10, y: 20 },
    ];

    finalizeRasterShapeFill(
      {
        drawCtx,
        brushRuntime: {
          applyStrokeDither,
        } as unknown as Parameters<typeof finalizeRasterShapeFill>[0]['brushRuntime'],
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
    expect(ditherArgs.settingsOverride.ditherPaletteSpread).toBe(55);
    expect(ditherArgs.settingsOverride.ditherPatternDiversity).toBe(72);
    expect(ditherArgs.quantizeSourceAlpha).toBe(true);
    expect(ditherArgs).not.toHaveProperty('regularDitherVariety');
    expect(opacityImage.data[3]).toBe(128);
    expect(drawCtx.putImageData).toHaveBeenCalled();
  });

  it('does not persist temporary pressure-linked dither overrides back to the store on finalize', () => {
    const applyStrokeDither = jest.fn();
    const setBrushSettings = jest.fn();

    const liveBrushSettings = {
      brushShape: BrushShape.PIXEL_DITHER,
      color: '#000000',
      ditherEnabled: true,
      ditherBackgroundFill: true,
      fillResolution: 11,
      pressureLinkedFillResolution: true,
      antialiasing: false,
      opacity: 1,
      blendMode: 'source-over',
    } as unknown as BrushSettings;

    const storeRef = {
      current: {
        layers: [],
        activeLayerId: null,
        tools: {
          brushSettings: liveBrushSettings,
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

    finalizeRasterShapeFill({
      drawCtx,
      brushRuntime: {
        applyStrokeDither,
      } as unknown as Parameters<typeof finalizeRasterShapeFill>[0]['brushRuntime'],
      storeRef,
      liveBrushSettings,
      shapePoints: [
        { x: 10, y: 10 },
        { x: 20, y: 10 },
        { x: 10, y: 20 },
      ],
      ditherGradPoints: null,
      strokeBoundingBox: null,
      project: { width: 64, height: 64 },
      roiPadding: 4,
      computeAutoSampleStops: jest.fn(() => null),
      setSharedColorCycleGradient: jest.fn(),
      computeShapePixelSize: jest.fn(() => 5),
      hadValidShapePressureRef: { current: true },
      lastStablePressureRef: { current: 1 },
      latestShapePixelSizeRef: { current: null },
      boundingBoxToCaptureRegion: jest.fn(() => ({ x: 0, y: 0, width: 64, height: 64 })),
      logError: jest.fn(),
      ccDebug: { on: false, verbose: false },
    });

    expect(setBrushSettings).not.toHaveBeenCalled();
    const ditherArgs = applyStrokeDither.mock.calls[0]?.[3];
    expect(ditherArgs.overridePixelSize).toBe(5);
    expect(ditherArgs.settingsOverride.fillResolution).toBe(5);
    expect(ditherArgs.settingsOverride.pressureLinkedFillResolution).toBe(false);
  });

  it('dithers the full shape bounds when the stroke bbox is stale or too small', () => {
    const applyStrokeDither = jest.fn();
    const liveBrushSettings = {
      brushShape: BrushShape.PIXEL_DITHER,
      color: '#336699',
      ditherEnabled: true,
      ditherBackgroundFill: true,
      fillResolution: 4,
      pressureLinkedFillResolution: false,
      antialiasing: false,
      opacity: 1,
      blendMode: 'source-over',
    } as unknown as BrushSettings;
    const storeRef = {
      current: {
        layers: [],
        activeLayerId: null,
        tools: { brushSettings: liveBrushSettings },
      },
    } as unknown as React.MutableRefObject<AppState>;
    const drawCtx = {
      canvas: { width: 80, height: 80 },
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

    finalizeRasterShapeFill({
      drawCtx,
      brushRuntime: {
        applyStrokeDither,
      } as unknown as Parameters<typeof finalizeRasterShapeFill>[0]['brushRuntime'],
      storeRef,
      liveBrushSettings,
      shapePoints: [
        { x: 10, y: 10 },
        { x: 50, y: 10 },
        { x: 50, y: 50 },
        { x: 10, y: 50 },
      ],
      ditherGradPoints: null,
      strokeBoundingBox: { minX: 10, minY: 10, maxX: 20, maxY: 20 },
      project: { width: 80, height: 80 },
      roiPadding: 4,
      computeAutoSampleStops: jest.fn(() => null),
      setSharedColorCycleGradient: jest.fn(),
      computeShapePixelSize: jest.fn(() => 4),
      hadValidShapePressureRef: { current: false },
      lastStablePressureRef: { current: 0.5 },
      latestShapePixelSizeRef: { current: null },
      boundingBoxToCaptureRegion,
      logError: jest.fn(),
      ccDebug: { on: false, verbose: false },
    });

    expect(applyStrokeDither).toHaveBeenCalled();
    expect(applyStrokeDither.mock.calls[0]?.[1]).toEqual({
      x: 0,
      y: 0,
      width: 62,
      height: 62,
    });
  });

  it('applies transparency-lock mask from layer framebuffer', () => {
    const target = document.createElement('canvas');
    target.width = 2;
    target.height = 1;
    const targetCtx = target.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D;
    targetCtx.fillStyle = 'rgba(255,0,0,1)';
    targetCtx.fillRect(0, 0, 2, 1);

    const framebuffer = document.createElement('canvas');
    framebuffer.width = 2;
    framebuffer.height = 1;

    const drawImageSpy = jest.spyOn(targetCtx, 'drawImage');

    applyTransparencyLockMaskToContext({
      targetCtx,
      layer: {
        transparencyLocked: true,
        imageData: null,
        framebuffer,
      } as unknown as AppState['layers'][number],
    });

    expect(drawImageSpy).toHaveBeenCalledWith(framebuffer, 0, 0, 2, 1);
    drawImageSpy.mockRestore();
  });
});
