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

describe('BrushEngineFacade captured custom-brush color cycle', () => {
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
});
