import { BrushEngineFacade, type CustomBrushStrokeData } from '@/hooks/brushEngine/BrushEngineFacade';
import { captureResamplerSingleSample } from '@/hooks/canvas/handlers/customBrushCapture';
import { startNonColorCycleBrushStroke } from '@/hooks/canvas/handlers/startBrushStroke';
import { defaultBrushSettings } from '@/presets/brushPresets';
import { getAppStoreState } from '@/stores/appStoreAccess';
import { useAppStore, type AppState } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import { captureBrushFromCanvas } from '@/utils/customBrushCapture';

jest.mock('@/stores/appStoreAccess', () => ({ getAppStoreState: jest.fn() }));
jest.mock('@/hooks/canvas/handlers/sequential/sequentialCapture', () => ({
  captureSequentialStampsForActiveLayer: jest.fn(),
  createFallbackSequentialStamp: jest.fn(() => ({ x: 0, y: 0, pressure: 1 })),
}));

type StartArgs = Parameters<typeof startNonColorCycleBrushStroke>[0];

const fixture = (continuousSampling: boolean, brushShape = BrushShape.RESAMPLER) => {
  const source = document.createElement('canvas');
  source.width = 64;
  source.height = 32;
  const sourceCtx = source.getContext('2d')!;
  sourceCtx.fillStyle = '#ff0000';
  sourceCtx.fillRect(0, 0, 32, 32);
  sourceCtx.fillStyle = '#0000ff';
  sourceCtx.fillRect(32, 0, 32, 32);
  const target = document.createElement('canvas');
  target.width = 64;
  target.height = 32;
  const ctx = target.getContext('2d')!;
  const settings = {
    ...defaultBrushSettings, brushShape, continuousSampling, size: 8,
    color: '#ff00ff', opacity: 1, antialiasing: true, spacing: 1,
    rotationEnabled: false, pressureEnabled: false, pressureOpacityEnabled: false,
    gridSnapEnabled: false, customBrushSnapEnabled: false, dashedEnabled: false,
    ditherEnabled: false, risographIntensity: 0,
  };
  const baseline = useAppStore.getState();
  const state: AppState = {
    ...baseline,
    tools: { ...baseline.tools, brushSettings: settings },
    currentOffscreenCanvas: source,
  };
  jest.mocked(getAppStoreState).mockReturnValue(state);
  const engine = new BrushEngineFacade({ brushSettings: settings });
  const ref: { current: CustomBrushStrokeData | undefined } = { current: undefined };
  const capture = jest.fn((args: Parameters<StartArgs['captureResamplerSingleSample']>[0]) =>
    captureResamplerSingleSample(args, { captureBrushFromCanvas }));
  const drawBrush = jest.fn<ReturnType<StartArgs['brushRuntime']['drawBrush']>, Parameters<StartArgs['brushRuntime']['drawBrush']>>((drawCtx, from, to, options) => {
    engine.renderBrushStroke(drawCtx, {
      from, to, pressure: options.pressure, velocity: 0, timestamp: 1,
      customBrushData: options.customBrushData,
    });
  });
  const args: StartArgs = {
    currentState: state, worldPos: { x: 16, y: 16 }, pressure: 0.37, drawCtx: ctx,
    brushRuntime: { drawBrush, consumeRecentStamps: () => engine.consumeRecentStamps() },
    resolveCustomBrushData: jest.fn(() => undefined), captureResamplerSingleSample: capture,
    resamplerBrushDataRef: ref,
  };
  const sample = (x: number) => captureResamplerSingleSample({
    samplePos: { x, y: 16 }, brushSize: 8, compositeCanvas: source, resamplerBrushDataRef: ref,
  }, { captureBrushFromCanvas });
  const pixel = (x: number) => [...ctx.getImageData(x, 16, 1, 1).data];
  return { source, ctx, state, ref, args, capture, drawBrush, sample, pixel };
};

describe('Resampler first contact through the native stroke start owner', () => {
  const rasterWindow = globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean };
  beforeEach(() => { rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true; });
  afterEach(() => { delete rasterWindow.__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__; jest.clearAllMocks(); });

  it.each([false, true])('paints an untinted composite sample on first contact with Continuous %s', (continuous) => {
    const f = fixture(continuous);
    startNonColorCycleBrushStroke(f.args);

    expect(f.pixel(16)).toEqual([255, 0, 0, 255]);
    const raw = f.ctx.getImageData(0, 0, 64, 32).data;
    expect(raw.filter((_, index) => index % 4 === 3 && raw[index] > 0)).toHaveLength(64);
    expect(f.capture).toHaveBeenCalledWith({
      samplePos: { x: 16, y: 16 }, brushSize: 8, compositeCanvas: f.source,
      resamplerBrushDataRef: f.ref,
    });
    expect(f.ref.current).toEqual(expect.objectContaining({ isColorizable: false, isResampler: true, width: 8, height: 8 }));
    expect(f.drawBrush).toHaveBeenCalledWith(f.ctx, { x: 16, y: 16 }, { x: 16, y: 16 }, {
      pressure: 0.37, customBrushData: f.ref.current,
    });
  });

  it.each([false, true])('refreshes an older retained sample before first contact with Continuous %s', (continuous) => {
    const f = fixture(continuous);
    const old = f.sample(16);
    expect([...old!.imageData.data.slice(0, 4)]).toEqual([255, 0, 0, 255]);
    f.args.worldPos = { x: 48, y: 16 };
    startNonColorCycleBrushStroke(f.args);

    expect(f.pixel(48)).toEqual([0, 0, 255, 255]);
    expect(f.ref.current).not.toBe(old);
    expect(f.ref.current?.cacheKey).not.toBe(old?.cacheKey);
    expect(f.capture).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])('preserves custom-tip lookup/fallback with an existing tip (explicit lookup %s)', (explicitLookup) => {
    const f = fixture(true, BrushShape.CUSTOM);
    const tip = f.sample(48)!;
    if (explicitLookup) f.args.resolveCustomBrushData = jest.fn(() => tip);
    startNonColorCycleBrushStroke(f.args);

    expect(f.pixel(16)).toEqual([0, 0, 255, 255]);
    expect(f.ref.current).toBe(tip);
    expect(f.capture).not.toHaveBeenCalled();
    expect(f.drawBrush.mock.calls[0]?.[3].customBrushData).toBe(tip);
  });

  it('does not capture composite material for another regular brush', () => {
    const f = fixture(true, BrushShape.ROUND);
    startNonColorCycleBrushStroke(f.args);

    expect(f.capture).not.toHaveBeenCalled();
    expect(f.ref.current).toBeUndefined();
    expect(f.drawBrush.mock.calls[0]?.[3]).toEqual({ pressure: 0.37, customBrushData: undefined });
  });

  it('keeps the existing retained sample if the initial source is unavailable', () => {
    const f = fixture(true);
    const old = f.sample(16);
    f.state.currentOffscreenCanvas = null;
    startNonColorCycleBrushStroke(f.args);

    expect(f.pixel(16)).toEqual([255, 0, 0, 255]);
    expect(f.ref.current).toBe(old);
    expect(f.drawBrush.mock.calls[0]?.[3].customBrushData).toBe(old);
  });

  it('keeps absent sample state absent on initial source failure', () => {
    const f = fixture(true);
    f.state.currentOffscreenCanvas = null;
    startNonColorCycleBrushStroke(f.args);

    expect(f.ref.current).toBeUndefined();
    expect(f.pixel(16)[3]).toBe(0);
    expect(f.drawBrush.mock.calls[0]?.[3].customBrushData).toBeUndefined();
  });
});
