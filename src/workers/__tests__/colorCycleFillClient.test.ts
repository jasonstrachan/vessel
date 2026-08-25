/* eslint-disable @typescript-eslint/no-explicit-any */
jest.mock('../colorCycleFillWorkerFactory', () => ({
  createColorCycleFillWorker: () => new Worker('color-cycle-fill-worker-test'),
}));

import {
  runAutoConvertRegionsJob,
  runPerceptualDitherJob,
  runConcentricFillJob,
  sampleShapeGradientFromCanvases,
  runShapeGradientSampleJob,
} from '../colorCycleFillClient';

class FakeWorker implements Worker {
  static shouldRespond = true;
  static queueResponses = false;
  static queuedMessages: Array<{ worker: FakeWorker; payload: any }> = [];
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent<any>) => any) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;
  private terminated = false;
  private listeners: Record<'message' | 'error', Set<EventListener>> = {
    message: new Set(),
    error: new Set(),
  };

  postMessage = jest.fn((payload: any) => {
    if (!FakeWorker.shouldRespond) {
      return;
    }
    if (FakeWorker.queueResponses) {
      FakeWorker.queuedMessages.push({ worker: this, payload });
      return;
    }
    this.respond(payload);
  });
  terminate = jest.fn(() => {
    this.terminated = true;
  });
  addEventListener = (type: 'message' | 'error', listener: EventListener) => {
    this.listeners[type].add(listener);
  };
  removeEventListener = (type: 'message' | 'error', listener: EventListener) => {
    this.listeners[type].delete(listener);
  };
  dispatchEvent = () => true;

  respond(payload: any) {
    if (this.terminated) {
      return;
    }
    const { id, job } = payload;
    if (!job) return;
    const base = { id, type: job.type, ok: true };
    if (job.type === 'perceptual-dither') {
      const response = { ...base, result: { width: 1, height: 1, indices: new ArrayBuffer(4) } };
      this.emit('message', { data: response } as any);
    } else if (job.type === 'concentric-fill') {
      const response = { ...base, result: { width: 1, height: 1, indices: new ArrayBuffer(3) } };
      this.emit('message', { data: response } as any);
    } else if (job.type === 'shape-gradient-sample') {
      const response = {
        ...base,
        result: {
          stops: [{ position: 0, color: '#ff0000' }, { position: 1, color: '#0000ff' }],
          dominantColor: '#ff0000',
          stats: { sampledPixels: 2, uniqueColorBins: 2, outputColors: 2, alphaWeight: 2 },
        },
      };
      this.emit('message', { data: response } as any);
    } else if (job.type === 'auto-convert-regions') {
      const response = {
        ...base,
        result: {
          regions: [],
          analysisWidth: job.width,
          analysisHeight: job.height,
        },
      };
      this.emit('message', { data: response } as any);
    }
  }

  emit(type: 'message' | 'error', event: any) {
    this.listeners[type].forEach((l) => l(event));
  }
}

// Hook the FakeWorker before module code runs
(global as any).Worker = FakeWorker as unknown as typeof Worker;

describe('colorCycleFillClient', () => {
  beforeEach(() => {
    FakeWorker.shouldRespond = true;
    FakeWorker.queueResponses = false;
    FakeWorker.queuedMessages = [];
    jest.useRealTimers();
  });

  it('resolves perceptual dither job', async () => {
    const result = await runPerceptualDitherJob({
      type: 'perceptual-dither',
      pixels: new ArrayBuffer(4),
      width: 1,
      height: 1,
      quantLevels: 2,
      ditherPixelSize: 1,
      paletteCss: ['#000', '#fff'],
      paletteMapEntries: [{ rgb: [0, 0, 0], index: 1 }],
      baseOffset: 0,
    });
    expect(result.width).toBe(1);
  });

  it('resolves concentric fill job', async () => {
    const result = await runConcentricFillJob({
      type: 'concentric-fill',
      vertices: new Float32Array([0, 0, 1, 0, 1, 1]),
      bbox: { x: 0, y: 0, width: 1, height: 1 },
      bands: [],
      baseOffset: 0,
      maxDist: 1,
      ditherEnabled: false,
      ditherStrength: 0,
      ditherPixelSize: 1,
      noiseSeed: 1,
    });
    expect(result.width).toBe(1);
  });

  it('resolves a shape-gradient sample job', async () => {
    const result = await runShapeGradientSampleJob({
      type: 'shape-gradient-sample',
      width: 2,
      height: 1,
      originX: 0,
      originY: 0,
      sampleScaleX: 1,
      sampleScaleY: 1,
      vertices: new Float32Array([0, 0, 2, 0, 2, 1, 0, 1]),
      compositePixels: new ArrayBuffer(8),
      maxColors: 2,
      mode: 'linear',
      directionX: 1,
      directionY: 0,
    });

    expect(result.stops).toEqual([
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#0000ff' },
    ]);
    expect(result.stats.outputColors).toBe(2);
    expect(result.dominantColor).toBe('#ff0000');
  });

  it('resolves an auto-convert regions job', async () => {
    const result = await runAutoConvertRegionsJob({
      type: 'auto-convert-regions',
      width: 2,
      height: 2,
      targetShapes: 24,
      detail: 50,
      maxColors: 5,
      pixels: new ArrayBuffer(16),
    });

    expect(result).toEqual({ regions: [], analysisWidth: 2, analysisHeight: 2 });
  });

  it('captures a shape sample from a canvas without a readable 2D context', async () => {
    const compositeCanvas = document.createElement('canvas');
    compositeCanvas.width = 2;
    compositeCanvas.height = 2;
    const referenceCanvas = document.createElement('canvas');
    referenceCanvas.width = 2;
    referenceCanvas.height = 2;
    const referenceGetContext = jest
      .spyOn(referenceCanvas, 'getContext')
      .mockReturnValue(null);

    const result = await sampleShapeGradientFromCanvases({
      compositeCanvas,
      referenceCanvas,
      shapePoints: [
        { x: 0, y: 0 },
        { x: 2, y: 0 },
        { x: 2, y: 2 },
        { x: 0, y: 2 },
      ],
      maxColors: 2,
      mode: 'linear',
    });

    expect(referenceGetContext).toHaveBeenCalledWith('2d', { willReadFrequently: true });
    expect(result?.stops).toEqual([
      { position: 0, color: '#ff0000' },
      { position: 1, color: '#0000ff' },
    ]);
  });

  it('rejects a concentric fill job when the worker never responds', async () => {
    jest.useFakeTimers();
    FakeWorker.shouldRespond = false;

    const pending = runConcentricFillJob({
      type: 'concentric-fill',
      vertices: new Float32Array([0, 0, 1, 0, 1, 1]),
      bbox: { minX: 0, minY: 0, width: 1, height: 1 },
      bands: 4,
      baseOffset: 0,
      maxDist: 1,
      ditherEnabled: false,
      ditherStrength: 0,
      ditherPixelSize: 1,
      noiseSeed: 1,
    });

    const rejection = expect(pending).rejects.toThrow(/timed out/);

    await jest.advanceTimersByTimeAsync(10_001);
    await rejection;
  });

  it('does not terminate the shared worker when one in-flight job times out', async () => {
    jest.useFakeTimers();
    FakeWorker.queueResponses = true;

    const timedOut = runConcentricFillJob({
      type: 'concentric-fill',
      vertices: new Float32Array([0, 0, 1, 0, 1, 1]),
      bbox: { minX: 0, minY: 0, width: 1, height: 1 },
      bands: 4,
      baseOffset: 0,
      maxDist: 1,
      ditherEnabled: false,
      ditherStrength: 0,
      ditherPixelSize: 1,
      noiseSeed: 1,
    });
    const timedOutRejection = expect(timedOut).rejects.toThrow(/timed out/);

    await jest.advanceTimersByTimeAsync(5_000);

    const stillValid = runConcentricFillJob({
      type: 'concentric-fill',
      vertices: new Float32Array([0, 0, 1, 0, 1, 1]),
      bbox: { minX: 0, minY: 0, width: 1, height: 1 },
      bands: 4,
      baseOffset: 0,
      maxDist: 1,
      ditherEnabled: false,
      ditherStrength: 0,
      ditherPixelSize: 1,
      noiseSeed: 1,
    });

    await jest.advanceTimersByTimeAsync(5_001);
    await timedOutRejection;

    const secondMessage = FakeWorker.queuedMessages[1];
    expect(secondMessage).toBeTruthy();
    secondMessage.worker.respond(secondMessage.payload);

    await expect(stillValid).resolves.toEqual(expect.objectContaining({ width: 1 }));
  });
});
