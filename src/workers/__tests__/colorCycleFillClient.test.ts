/* eslint-disable @typescript-eslint/no-explicit-any */
import { runPerceptualDitherJob, runConcentricFillJob } from '../colorCycleFillClient';

class FakeWorker implements Worker {
  onmessage: ((this: Worker, ev: MessageEvent<any>) => any) | null = null;
  onmessageerror: ((this: Worker, ev: MessageEvent<any>) => any) | null = null;
  onerror: ((this: AbstractWorker, ev: ErrorEvent) => any) | null = null;
  private listeners: Record<'message' | 'error', Set<EventListener>> = {
    message: new Set(),
    error: new Set(),
  };

  postMessage = jest.fn((payload: any) => {
    const { id, job } = payload;
    if (!job) return;
    const base = { id, type: job.type, ok: true };
    if (job.type === 'perceptual-dither') {
      const response = { ...base, result: { width: 1, height: 1, indices: new ArrayBuffer(4) } };
      this.emit('message', { data: response } as any);
    } else if (job.type === 'concentric-fill') {
      const response = { ...base, result: { width: 1, height: 1, indices: new ArrayBuffer(3) } };
      this.emit('message', { data: response } as any);
    }
  });
  terminate = jest.fn();
  addEventListener = (type: 'message' | 'error', listener: EventListener) => {
    this.listeners[type].add(listener);
  };
  removeEventListener = (type: 'message' | 'error', listener: EventListener) => {
    this.listeners[type].delete(listener);
  };
  dispatchEvent = () => true;

  emit(type: 'message' | 'error', event: any) {
    this.listeners[type].forEach((l) => l(event));
  }
}

// Hook the FakeWorker before module code runs
(global as any).Worker = FakeWorker as unknown as typeof Worker;

describe('colorCycleFillClient', () => {
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
});
