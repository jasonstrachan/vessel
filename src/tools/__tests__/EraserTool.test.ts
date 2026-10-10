import { EraserTool } from '@/tools/EraserTool';
import { BrushShape, type Layer } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { MaskManager } from '@/layers/MaskManager';
import { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { drawShape } from '@/hooks/brushEngine/shapes';
import { getColorCycleBrushEraserSettings } from '@/hooks/canvas/handlers/colorCycle/colorCycleEraserSettings';
import type { AppState } from '@/stores/useAppStore';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { resolvePressureSizing } from '@/utils/pressureSizing';
import * as risographTexture from '@/utils/risographTexture';

describe('EraserTool', () => {
  it.each([
    { name: 'large raster square', layerType: 'normal', brushShape: BrushShape.SQUARE, size: 500, intensity: 100, random: 1 },
    { name: 'large CC square', layerType: 'color-cycle', brushShape: BrushShape.SQUARE, size: 500, intensity: 100, random: 0 },
    { name: 'large sequential square', layerType: 'sequential', brushShape: BrushShape.SQUARE, size: 500, intensity: 100, random: 1 },
    { name: 'backtracking round', layerType: 'normal', brushShape: BrushShape.ROUND, size: 20, intensity: 100, random: 0 },
    { name: 'Diamond5 texture', layerType: 'sequential', brushShape: BrushShape.PIXEL_DITHER, size: 20, intensity: 100, random: 0 },
    { name: 'pressure expanded round', layerType: 'color-cycle', brushShape: BrushShape.ROUND, size: 100, intensity: 100, random: 1, pressure: true },
    { name: 'rotated square', layerType: 'normal', brushShape: BrushShape.SQUARE, size: 64, intensity: 100, random: 1, rotation: true },
    { name: 'rotated pressure Diamond5', layerType: 'sequential', brushShape: BrushShape.PIXEL_DITHER, size: 64, intensity: 100, random: 0, rotation: true, pressure: true },
    { name: 'minimum Diamond5', layerType: 'color-cycle', brushShape: BrushShape.PIXEL_DITHER, size: 1, intensity: 100, random: 0 },
    { name: 'no texture', layerType: 'sequential', brushShape: BrushShape.SQUARE, size: 100, intensity: 0, random: 1 },
  ] as const)('contains actual native primitives for $name in the capture ROI', (testCase) => {
    const state = {
      currentBrushPreset: null,
      globalBrushSize: testCase.size,
      tools: {
        currentTool: 'eraser',
        brushSettings: { size: testCase.size, brushShape: BrushShape.SQUARE },
        eraserSettings: {
          brushShape: testCase.brushShape,
          ditherStrokeTipShape: testCase.brushShape === BrushShape.PIXEL_DITHER ? 'diamond5' : 'round',
          risographIntensity: testCase.intensity,
          pressureEnabled: 'pressure' in testCase,
          minPressure: 50,
          maxPressure: 200,
          rotationEnabled: 'rotation' in testCase,
        },
      },
    } as unknown as AppState;
    const rawCtx = document.createElement('canvas').getContext('2d')!;
    rawCtx.fillStyle = '#ffffff';
    const fill = jest.spyOn(rawCtx, 'fillRect');
    const arc = jest.spyOn(rawCtx, 'arc');
    const image = jest.spyOn(rawCtx, 'drawImage');
    const pattern = jest.spyOn(risographTexture, 'getRisographPattern').mockReturnValue({} as CanvasPattern);
    const random = jest.fn(() => testCase.random);
    let settings = state.tools.brushSettings;
    const source = new BrushStampSource({
      getState: () => state,
      brushRuntime: {
        updateConfig: (config) => { settings = config.brushSettings; },
        drawBrush: (_ctx, _from, to, options) => {
          const range = resolveBrushPressureRange(settings);
          const sizing = resolvePressureSizing(settings.size, {
            enabled: range.enabled, minPercent: range.minPercent, maxPercent: range.maxPercent,
          });
          const size = Math.max(1, Math.round(sizing.sample(options?.pressure ?? 1) * 2));
          drawShape(rawCtx, to.x, to.y, size, settings.brushShape ?? BrushShape.SQUARE, false,
            settings.rotationEnabled ? Math.PI / 4 : 0, settings.risographIntensity,
            undefined, undefined, undefined, { brushSettings: settings }, { risographRandom: random });
        },
      },
      userBrushEngine: {
        isUserBrush: () => false, setActiveBrush: jest.fn(), startStroke: jest.fn(),
        continueStroke: jest.fn(), endStroke: jest.fn(),
      },
      resolveCustomBrush: () => undefined,
    });
    const mask = document.createElement('canvas');
    const tool = new EraserTool({ id: 'native-riso-roi', layerType: testCase.layerType } as Layer, { opacity: 1 }, {
      overlayCtx: document.createElement('canvas').getContext('2d')!,
      maskManager: { getMask: () => mask, bumpVersion: jest.fn() } as unknown as MaskManager,
      createStampSource: () => source,
      brushHalfSize: () => testCase.size / 2,
      getBrushSettings: () => getColorCycleBrushEraserSettings({ state }),
    });
    try {
      tool.begin({ x: 512, y: 512 }, 1);
      tool.move({ x: 600, y: 512 }, 1);
      tool.move({ x: 512, y: 512 }, 1);
      tool.end();
      const roi = tool.getROI()!;
      const rectangles = fill.mock.calls.map(([x, y, width, height]) => ({ x, y, width, height }));
      for (const [x, y, radius] of arc.mock.calls) {
        rectangles.push({ x: x - radius, y: y - radius, width: radius * 2, height: radius * 2 });
      }
      for (const [canvas, x, y] of image.mock.calls) {
        rectangles.push({ x, y, width: (canvas as HTMLCanvasElement).width, height: (canvas as HTMLCanvasElement).height });
      }
      expect(rectangles.length).toBeGreaterThan(0);
      for (const rectangle of rectangles) {
        expect(rectangle.x).toBeGreaterThanOrEqual(roi.x);
        expect(rectangle.y).toBeGreaterThanOrEqual(roi.y);
        expect(rectangle.x + rectangle.width).toBeLessThanOrEqual(roi.x + roi.width);
        expect(rectangle.y + rectangle.height).toBeLessThanOrEqual(roi.y + roi.height);
      }
      expect(random).toHaveBeenCalledTimes(testCase.intensity > 0 ? 6 : 0);
      if (testCase.intensity === 0) {
        expect(roi).toEqual({ x: 460, y: 460, width: 192, height: 104 });
      }
    } finally {
      pattern.mockRestore();
      fill.mockRestore();
      arc.mockRestore();
      image.mockRestore();
    }
  });

  it.each(['normal', 'sequential', 'color-cycle'] as const)(
    'captures the rotated geometric support on a %s layer',
    (layerType) => {
      for (const [brushShape, size, rotationEnabled, padding] of [
        [BrushShape.SQUARE, 64, true, 48],
        [BrushShape.SQUARE, 64, false, 34],
        [BrushShape.PIXEL_DITHER, 64, true, 48],
        [BrushShape.PIXEL_DITHER, 1, true, 6],
        [BrushShape.PIXEL_ROUND, 64, true, 34],
        [BrushShape.ROUND, 64, true, 34],
      ] as const) {
        const overlayCtx = document.createElement('canvas').getContext('2d')!;
        const mask = document.createElement('canvas');
        const tool = new EraserTool({ id: 'rotation', layerType } as Layer, { opacity: 1 }, {
          overlayCtx,
          maskManager: { getMask: () => mask, bumpVersion: jest.fn() } as unknown as MaskManager,
          createStampSource: () => ({
            begin: jest.fn(), draw: jest.fn(), end: jest.fn(),
          } as unknown as BrushStampSource),
          brushHalfSize: () => size / 2,
          getBrushSettings: () => ({
            size, brushShape, rotationEnabled,
            pressureEnabled: false, minPressure: 100, maxPressure: 100,
          }),
        });
        tool.begin({ x: 90, y: 90 });
        tool.move({ x: 166, y: 166 }, 1, { x: 90, y: 90 });

        expect(tool.getROI()).toEqual({
          x: 90 - padding,
          y: 90 - padding,
          width: 76 + padding * 2,
          height: 76 + padding * 2,
        });
        tool.end();
      }
    },
  );

  it('combines rotation support with maximum pressure and latched grid centers', () => {
    const overlayCtx = document.createElement('canvas').getContext('2d')!;
    const tool = new EraserTool({ id: 'rotation-pressure-grid', layerType: 'normal' } as Layer, { opacity: 1 }, {
      overlayCtx,
      maskManager: {} as MaskManager,
      createStampSource: () => ({
        begin: jest.fn(), draw: jest.fn(), end: jest.fn(),
      } as unknown as BrushStampSource),
      brushHalfSize: () => 32,
      getBrushSettings: () => ({
        size: 64, brushShape: BrushShape.SQUARE, rotationEnabled: true,
        pressureEnabled: true, minPressure: 50, maxPressure: 200,
        gridSnapEnabled: true, gridSnapSize: 16,
      }),
    });
    tool.begin({ x: 90, y: 90 }, 1);
    tool.move({ x: 166, y: 166 }, 0, { x: 90, y: 90 });

    expect(tool.getROI()).toEqual({ x: 3, y: 3, width: 250, height: 250 });
    tool.end();
  });

  it.each(['normal', 'sequential', 'color-cycle'] as const)(
    'captures the complete snapped tap and drag on a %s layer',
    (layerType) => {
      const overlayCtx = document.createElement('canvas').getContext('2d')!;
      const mask = document.createElement('canvas');
      const tool = new EraserTool({ id: 'grid', layerType } as Layer, { opacity: 1 }, {
        overlayCtx,
        maskManager: { getMask: () => mask, bumpVersion: jest.fn() } as unknown as MaskManager,
        createStampSource: () => ({
          begin: jest.fn(), draw: jest.fn(), end: jest.fn(),
        } as unknown as BrushStampSource),
        brushHalfSize: () => 2,
        getBrushSettings: () => ({
          size: 4, brushShape: BrushShape.SQUARE,
          pressureEnabled: false, minPressure: 100, maxPressure: 100,
          gridSnapEnabled: true, gridSnapSize: 16,
        }),
      });

      tool.begin({ x: 37, y: 117 });
      expect(tool.getROI()).toEqual({ x: 28, y: 108, width: 8, height: 8 });
      tool.move({ x: 219, y: 117 }, 1, { x: 37, y: 117 });
      expect(tool.getROI()).toEqual({ x: 28, y: 108, width: 200, height: 8 });
      tool.end();
    },
  );

  it('keeps the initial pressure-aware snap spacing until the next stroke', () => {
    const overlayCtx = document.createElement('canvas').getContext('2d')!;
    const tool = new EraserTool({ id: 'grid', layerType: 'normal' } as Layer, { opacity: 1 }, {
      overlayCtx,
      maskManager: {} as MaskManager,
      createStampSource: () => ({
        begin: jest.fn(), draw: jest.fn(), end: jest.fn(),
      } as unknown as BrushStampSource),
      brushHalfSize: () => 2,
      getBrushSettings: () => ({
        size: 4, brushShape: BrushShape.SQUARE,
        pressureEnabled: true, minPressure: 50, maxPressure: 200,
        gridSnapEnabled: true, gridSnapSize: 16,
      }),
    });

    tool.begin({ x: 37, y: 117 }, 1);
    expect(tool.getROI()).toEqual({ x: 26, y: 122, width: 12, height: 12 });
    tool.move({ x: 71, y: 117 }, 0, { x: 37, y: 117 });
    expect(tool.getROI()).toEqual({ x: 26, y: 122, width: 44, height: 12 });
    tool.end();
    tool.begin({ x: 37, y: 117 }, 0);
    expect(tool.getROI()).toEqual({ x: 34, y: 114, width: 12, height: 12 });
  });

  it.each([
    ['normal', false], ['normal', true],
    ['sequential', false], ['sequential', true],
    ['color-cycle', false], ['color-cycle', true],
  ] as const)(
    'ends %s stamps before restoring the authoring context when cancelled=%s',
    (layerType, cancelled) => {
      const overlay = document.createElement('canvas');
      const overlayCtx = overlay.getContext('2d')!;
      const mask = document.createElement('canvas');
      const targetCtx = layerType === 'color-cycle' ? mask.getContext('2d')! : overlayCtx;
      const clip = jest.spyOn(targetCtx, 'clip');
      const restore = jest.spyOn(targetCtx, 'restore');
      const end = jest.fn(() => {
        expect(targetCtx.globalCompositeOperation).toBe(
          layerType === 'color-cycle' ? 'source-over' : 'destination-out');
        expect(targetCtx.globalAlpha).toBe(1);
        expect(clip).toHaveBeenCalledTimes(1);
        expect(restore).not.toHaveBeenCalled();
      });
      const tool = new EraserTool({ id: 'lifecycle', layerType } as Layer, {
        opacity: 0.5,
        selection: {
          selectionStart: { x: 2, y: 4 },
          selectionEnd: { x: 12, y: 10 },
          selectionMask: null,
          selectionMaskBounds: null,
        },
      }, {
        overlayCtx,
        maskManager: { getMask: () => mask, bumpVersion: jest.fn() } as unknown as MaskManager,
        createStampSource: () => ({ begin: jest.fn(), end } as unknown as BrushStampSource),
        brushHalfSize: () => 2,
        getBrushSettings: () => ({
          size: 4,
          pressureEnabled: false,
          minPressure: 0,
          maxPressure: 100,
          brushShape: BrushShape.SQUARE,
        }),
      });
      tool.begin({ x: 8, y: 8 });

      if (cancelled) {
        tool.cancel();
      } else {
        tool.end();
      }

      expect(end).toHaveBeenCalledWith(cancelled);
      expect(restore).toHaveBeenCalledTimes(1);
      expect(end.mock.invocationCallOrder[0]).toBeLessThan(restore.mock.invocationCallOrder[0]);
    },
  );

  it.each(['normal', 'sequential', 'color-cycle'] as const)(
    'clips the %s authoring target before the first erase stamp',
    (layerType) => {
      const overlay = document.createElement('canvas');
      const mask = document.createElement('canvas');
      const overlayCtx = overlay.getContext('2d')!;
      const targetCtx = layerType === 'color-cycle' ? mask.getContext('2d')! : overlayCtx;
      const clip = jest.spyOn(targetCtx, 'clip');
      const rect = jest.spyOn(targetCtx, 'rect');
      const restore = jest.spyOn(targetCtx, 'restore');
      const stamp = jest.fn(() => expect(clip).toHaveBeenCalledTimes(1));
      const tool = new EraserTool({ id: 'selected', layerType } as Layer, {
        opacity: 1,
        selection: {
          selectionStart: { x: 12, y: 10 }, selectionEnd: { x: 2, y: 4 },
          selectionMask: null, selectionMaskBounds: null,
        },
      }, {
        overlayCtx,
        maskManager: { getMask: () => mask, bumpVersion: jest.fn() } as unknown as MaskManager,
        createStampSource: () => ({ begin: stamp, end: jest.fn() } as unknown as BrushStampSource),
        brushHalfSize: () => 2,
        getBrushSettings: () => ({
          size: 4, pressureEnabled: false, minPressure: 0, maxPressure: 100,
          brushShape: BrushShape.SQUARE,
        }),
      });

      tool.begin({ x: 8, y: 8 });
      expect(rect).toHaveBeenCalledWith(2, 4, 10, 6);
      expect(clip).toHaveBeenCalledTimes(1);
      expect(stamp).toHaveBeenCalledTimes(1);
      expect(stamp).toHaveBeenCalledWith(targetCtx, { x: 8, y: 8 }, 1,
        layerType === 'color-cycle' ? { target: 'erase-mask' } : undefined);
      tool.end();
      expect(restore).toHaveBeenCalled();
    },
  );

  it('applies an initial stamp on begin for color-cycle layers', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 24;
    overlayCanvas.height = 24;
    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    expect(overlayCtx).not.toBeNull();
    const overlayFillRectSpy = jest.spyOn(overlayCtx!, 'fillRect');
    const begin = jest.fn();

    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 24;
    maskCanvas.height = 24;
    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: maskCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas: maskCanvas,
        hasContent: true,
        gradient: [],
      },
    };

    const tool = new EraserTool(layer, { opacity: 1 }, {
      overlayCtx: overlayCtx!,
      maskManager: {
        getMask: jest.fn(() => maskCanvas),
        bumpVersion: jest.fn(),
      } as unknown as MaskManager,
      createStampSource: () => ({ begin, end: jest.fn() } as unknown as BrushStampSource),
      brushHalfSize: () => 6,
      getBrushSettings: () => ({
        size: 8,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.COLOR_CYCLE_SHAPE,
      }),
    });

    tool.begin({ x: 10, y: 12 }, 1);

    expect(begin).toHaveBeenCalledTimes(1);
    expect(begin).toHaveBeenCalledWith(maskCanvas.getContext('2d'), { x: 10, y: 12 }, 1,
      { target: 'erase-mask' });
    expect(overlayFillRectSpy).not.toHaveBeenCalled();
    expect(tool.getROI()).toEqual({ x: 2, y: 4, width: 16, height: 16 });
  });

  it('includes the full minimum Diamond5 stamp in the history ROI', () => {
    const overlayCanvas = document.createElement('canvas');
    overlayCanvas.width = 24;
    overlayCanvas.height = 24;
    const overlayCtx = overlayCanvas.getContext('2d', { willReadFrequently: true });
    const maskCanvas = document.createElement('canvas');
    maskCanvas.width = 24;
    maskCanvas.height = 24;
    const layer: Layer = {
      id: 'layer-cc',
      name: 'CC',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: maskCanvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'color-cycle',
      colorCycleData: {
        canvas: maskCanvas,
        hasContent: true,
        gradient: [],
      },
    };
    expect(overlayCtx).not.toBeNull();
    const tool = new EraserTool(layer, { opacity: 1 }, {
      overlayCtx: overlayCtx!,
      maskManager: {
        getMask: jest.fn(() => maskCanvas),
        bumpVersion: jest.fn(),
      } as unknown as MaskManager,
      createStampSource: () => ({ begin: jest.fn(), end: jest.fn() } as unknown as BrushStampSource),
      brushHalfSize: () => 0.5,
      getBrushSettings: () => ({
        size: 1,
        pressureEnabled: false,
        minPressure: 0,
        maxPressure: 1,
        brushShape: BrushShape.PIXEL_DITHER,
      }),
    });

    tool.begin({ x: 10, y: 10 }, 1);

    expect(tool.getROI()).toEqual({ x: 5, y: 5, width: 10, height: 10 });
  });
});
