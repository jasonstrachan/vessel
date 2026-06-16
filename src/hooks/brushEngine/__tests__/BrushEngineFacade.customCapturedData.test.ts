import { BrushEngineFacade } from '@/hooks/brushEngine/BrushEngineFacade';
import { BrushShape, type BrushSettings } from '@/types';

const createSettings = (): BrushSettings => ({
  size: 2,
  opacity: 1,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 1,
  rotation: 0,
  antialiasing: true,
  pressureEnabled: false,
  minPressure: 1,
  maxPressure: 100,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 3,
  dashGap: 2,
  gridSnapEnabled: false,
  gridSnapSize: 8,
  shapeEnabled: false,
  useSwatchColor: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: false,
  brushShape: BrushShape.CUSTOM,
  customBrushColorCycle: true,
  customBrushColorCycleMode: 'captured-data',
  customBrushUseCapturedAlphaMask: true,
  colorCycleSpeed: 0,
  colorCycleGradient: [
    { position: 0, color: '#ff0000' },
    { position: 1, color: '#0000ff' },
  ],
});

const countOpaquePixels = (imageData: ImageData): number => {
  const pixels = imageData.data;
  let count = 0;
  for (let i = 3; i < pixels.length; i += 4) {
    if (pixels[i] > 0) {
      count += 1;
    }
  }
  return count;
};

const createCapturedStrokeData = () => {
  const imageData = new ImageData(
    new Uint8ClampedArray([
      255, 0, 0, 255,
    ]),
    1,
    1
  );

  return {
    imageData,
    width: 1,
    height: 1,
    isColorizable: false,
    cacheKey: 'captured-render-path',
    colorCycle: {
      schemaVersion: 2 as const,
      mode: 'captured-data' as const,
      sourceCycleLength: 256,
      mapWidth: 1,
      mapHeight: 1,
      indexMap: new Uint16Array([0]),
      capturedColors: ['#ff0000'],
    },
  };
};

describe('BrushEngineFacade captured custom-brush color cycle', () => {
  const getCapturedPattern = <TPayload extends { schemaVersion: 2; mode: 'captured-data' }>(
    engine: BrushEngineFacade,
    args: {
      imageData: ImageData;
      width: number;
      height: number;
      cacheKey: string;
      colorCycle: TPayload;
      phase: number;
    }
  ): ImageData | null =>
    (
      engine as unknown as {
        getCapturedDataPattern: (
          customBrushData: {
            imageData: ImageData;
            width: number;
            height: number;
            isColorizable: boolean;
            cacheKey: string;
            colorCycle: TPayload;
          },
          phase: number
        ) => ImageData | null;
      }
    ).getCapturedDataPattern(
      {
        imageData: args.imageData,
        width: args.width,
        height: args.height,
        isColorizable: false,
        cacheKey: args.cacheKey,
        colorCycle: args.colorCycle,
      },
      args.phase
    );

  it('cycles preserved captured tip colors instead of replacing them with the active gradient', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 0, 0, 255,
        0, 255, 0, 255,
      ]),
      2,
      1
    );

    const capturedPayload = {
      schemaVersion: 2 as const,
      mode: 'captured-data' as const,
      source: 'color-cycle-layer' as const,
      sourceCycleLength: 256,
      mapWidth: 2,
      mapHeight: 1,
      indexMap: new Uint16Array([0, 1]),
      alphaMask: new Uint8Array([255, 255]),
      capturedColors: ['#ff0000', '#00ff00'],
      gradient: [
        { position: 0, color: '#0000ff' },
        { position: 1, color: '#0000ff' },
      ],
    };

    const engine = new BrushEngineFacade({
      brushSettings: createSettings(),
    });
    const resolvePattern = (phase: number): ImageData => {
      const pattern = getCapturedPattern(
        engine,
        {
          imageData,
          width: 2,
          height: 1,
          cacheKey: 'captured-tip-colors',
          colorCycle: capturedPayload,
          phase,
        }
      );
      expect(pattern).not.toBeNull();
      if (!pattern) {
        throw new Error('Expected captured-data pattern image');
      }
      return pattern;
    };

    const initial = resolvePattern(0);
    expect(Array.from(initial.data.slice(0, 8))).toEqual([
      255, 0, 0, 255,
      0, 255, 0, 255,
    ]);

    const advanced = resolvePattern(0.5);
    expect(Array.from(advanced.data.slice(0, 8))).toEqual([
      0, 255, 0, 255,
      255, 0, 0, 255,
    ]);
  });

  it('does not fall back to gradient replay when captured colors are present but invalid', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 255, 255, 255,
      ]),
      1,
      1
    );

    const engine = new BrushEngineFacade({
      brushSettings: createSettings(),
    });
    const pattern = getCapturedPattern(
      engine,
      {
        imageData,
        width: 1,
        height: 1,
        cacheKey: 'captured-invalid-colors',
        colorCycle: {
          schemaVersion: 2 as const,
          mode: 'captured-data' as const,
          sourceCycleLength: 256,
          mapWidth: 1,
          mapHeight: 1,
          indexMap: new Uint16Array([0]),
          alphaMask: new Uint8Array([255]),
          capturedColors: ['not-a-color'],
          gradient: [
            { position: 0, color: '#0000ff' },
            { position: 1, color: '#0000ff' },
          ],
        },
        phase: 0,
      }
    );

    expect(pattern).toBeNull();
  });

  it('honors captured-data useAlphaMask false', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 0, 0, 255,
      ]),
      1,
      1
    );

    const engine = new BrushEngineFacade({
      brushSettings: createSettings(),
    });
    const pattern = getCapturedPattern(
      engine,
      {
        imageData,
        width: 1,
        height: 1,
        cacheKey: 'captured-alpha-disabled',
        colorCycle: {
          schemaVersion: 2 as const,
          mode: 'captured-data' as const,
          sourceCycleLength: 256,
          mapWidth: 1,
          mapHeight: 1,
          indexMap: new Uint16Array([0]),
          alphaMask: new Uint8Array([0]),
          capturedColors: ['#ff0000'],
          useAlphaMask: false,
        },
        phase: 0,
      }
    );

    expect(pattern).not.toBeNull();
    expect(pattern?.data[3]).toBe(255);
  });

  it('routes captured-data custom brushes through smooth replay even when the custom CC toggle is off', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createSettings(),
        antialiasing: false,
        customBrushColorCycle: false,
      },
    });
    const customBrushData = createCapturedStrokeData();
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) {
      throw new Error('Expected 2d context');
    }

    const renderPixelPerfectSpy = jest.spyOn(
      engine as unknown as { renderPixelPerfectStroke: jest.Mock },
      'renderPixelPerfectStroke'
    ).mockImplementation(jest.fn());
    const renderSmoothSpy = jest.spyOn(
      engine as unknown as { renderSmoothStroke: jest.Mock },
      'renderSmoothStroke'
    ).mockImplementation(jest.fn());

    engine.renderBrushStroke(ctx, {
      from: { x: 1, y: 1 },
      to: { x: 2, y: 1 },
      pressure: 1,
      velocity: 1,
      timestamp: 1,
      customBrushData,
    });

    expect(renderPixelPerfectSpy).not.toHaveBeenCalled();
    expect(renderSmoothSpy).toHaveBeenCalledWith(
      ctx,
      { x: 1, y: 1 },
      { x: 2, y: 1 },
      expect.objectContaining({ shape: BrushShape.CUSTOM }),
      customBrushData
    );
  });

  it('replays captured-data custom brushes in the grid snapping path even when the custom CC toggle is off', () => {
    const engine = new BrushEngineFacade({
      brushSettings: {
        ...createSettings(),
        customBrushColorCycle: false,
        gridSnapEnabled: true,
        gridSnapSize: 1,
      },
    });
    const customBrushData = createCapturedStrokeData();
    const ctx = document.createElement('canvas').getContext('2d');
    if (!ctx) {
      throw new Error('Expected 2d context');
    }
    ctx.canvas.width = 8;
    ctx.canvas.height = 8;

    const capturedPatternSpy = jest.spyOn(
      engine as unknown as {
        getCapturedDataPattern: (data: typeof customBrushData, phase: number) => ImageData | null;
      },
      'getCapturedDataPattern'
    );

    engine.renderBrushStroke(ctx, {
      from: { x: 1, y: 1 },
      to: { x: 2, y: 1 },
      pressure: 1,
      velocity: 1,
      timestamp: 1,
      customBrushData,
    });

    expect(capturedPatternSpy).toHaveBeenCalled();
  });

  it('always applies captured alpha mask', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
        255, 255, 255, 255,
      ]),
      2,
      2
    );

    const capturedPayload = {
      schemaVersion: 2 as const,
      mode: 'captured-data' as const,
      source: 'color-cycle-layer' as const,
      sourceCycleLength: 256,
      mapWidth: 2,
      mapHeight: 2,
      phaseMap: new Uint16Array([0, 64, 128, 255]),
      alphaMask: new Uint8Array([255, 0, 255, 0]),
    };

    const resolvePattern = (): ImageData => {
      const engine = new BrushEngineFacade({
        brushSettings: createSettings(),
      });
      const pattern = (
        engine as unknown as {
          getCapturedDataPattern: (
            customBrushData: {
              imageData: ImageData;
              width: number;
              height: number;
              isColorizable: boolean;
              cacheKey: string;
              colorCycle: typeof capturedPayload;
            },
            phase: number
          ) => ImageData | null;
        }
      ).getCapturedDataPattern(
        {
          imageData,
          width: 2,
          height: 2,
          isColorizable: false,
          cacheKey: 'test-brush',
          colorCycle: capturedPayload,
        },
        0
      );
      expect(pattern).not.toBeNull();
      if (!pattern) {
        throw new Error('Expected captured-data pattern image');
      }
      return pattern;
    };

    const opaqueWithMask = countOpaquePixels(resolvePattern());
    const opaqueWithMaskSettingDisabled = countOpaquePixels(resolvePattern());

    expect(opaqueWithMask).toBeGreaterThan(0);
    expect(opaqueWithMask).toBe(opaqueWithMaskSettingDisabled);
  });

  it('prefers phaseMap over indexMap when both maps exist', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 255, 255, 255,
      ]),
      1,
      1
    );

    const capturedPayload = {
      schemaVersion: 2 as const,
      mode: 'captured-data' as const,
      source: 'color-cycle-layer' as const,
      sourceCycleLength: 256,
      mapWidth: 1,
      mapHeight: 1,
      phaseMap: new Uint16Array([255]),
      indexMap: new Uint16Array([0]),
      alphaMask: new Uint8Array([255]),
    };

    const engine = new BrushEngineFacade({
      brushSettings: createSettings(),
    });
    const pattern = (
      engine as unknown as {
        getCapturedDataPattern: (
          customBrushData: {
            imageData: ImageData;
            width: number;
            height: number;
            isColorizable: boolean;
            cacheKey: string;
            colorCycle: typeof capturedPayload;
          },
          phase: number
        ) => ImageData | null;
      }
    ).getCapturedDataPattern(
      {
        imageData,
        width: 1,
        height: 1,
        isColorizable: false,
        cacheKey: 'test-brush-phase-priority',
        colorCycle: capturedPayload,
      },
      0
    );

    expect(pattern).not.toBeNull();
    if (!pattern) {
      throw new Error('Expected captured-data pattern image');
    }

    const [r, , b] = pattern.data;
    expect(r).toBeLessThan(20);
    expect(b).toBeGreaterThan(200);
  });

  it('prefers captured payload gradient over active brush gradient', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        255, 255, 255, 255,
      ]),
      1,
      1
    );

    const capturedPayload = {
      schemaVersion: 2 as const,
      mode: 'captured-data' as const,
      source: 'color-cycle-layer' as const,
      sourceCycleLength: 256,
      mapWidth: 1,
      mapHeight: 1,
      phaseMap: new Uint16Array([0]),
      alphaMask: new Uint8Array([255]),
      gradient: [
        { position: 0, color: '#00ff00' },
        { position: 1, color: '#00ff00' },
      ],
    };

    const engine = new BrushEngineFacade({
      brushSettings: createSettings(),
    });
    const pattern = (
      engine as unknown as {
        getCapturedDataPattern: (
          customBrushData: {
            imageData: ImageData;
            width: number;
            height: number;
            isColorizable: boolean;
            cacheKey: string;
            colorCycle: typeof capturedPayload;
          },
          phase: number
        ) => ImageData | null;
      }
    ).getCapturedDataPattern(
      {
        imageData,
        width: 1,
        height: 1,
        isColorizable: false,
        cacheKey: 'test-brush-gradient-priority',
        colorCycle: capturedPayload,
      },
      0
    );

    expect(pattern).not.toBeNull();
    if (!pattern) {
      throw new Error('Expected captured-data pattern image');
    }

    const [r, g, b] = pattern.data;
    expect(r).toBeLessThan(20);
    expect(g).toBeGreaterThan(200);
    expect(b).toBeLessThan(20);
  });
});
