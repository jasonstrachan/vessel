import { runExport } from '@/utils/export/exportService';
import type { ExportRequest, FrameProvider } from '@/utils/export/types';

type MediaRecorderLike = typeof MediaRecorder & {
  supportedMimes: Set<string>;
  emitChunk: boolean;
};

class MockMediaRecorder {
  static supportedMimes = new Set<string>();

  static emitChunk = true;

  static isTypeSupported(type: string) {
    return MockMediaRecorder.supportedMimes.has(type);
  }

  public mimeType: string;

  public ondataavailable: ((event: BlobEvent) => void) | null = null;

  public onstop: ((event: Event) => void) | null = null;

  public onerror: ((event: Event) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    this.mimeType = options?.mimeType ?? '';
  }

  start() {}

  stop() {
    if (MockMediaRecorder.emitChunk) {
      this.ondataavailable?.({
        data: new Blob(['video'], { type: this.mimeType }),
      } as BlobEvent);
    }
    this.onstop?.(new Event('stop'));
  }
}

const createVideoRequest = (mimeType: 'video/mp4' | 'video/webm'): ExportRequest => {
  const frameProvider: FrameProvider = {
    getDimensions: () => ({ width: 8, height: 8 }),
    compositeToCanvas: () => {},
  };

  return {
    kind: 'video',
    filenameBase: 'demo',
    scale: 1,
    frameProvider,
    options: {
      fps: 1,
      durationSeconds: 1,
      mimeType,
      bitrateKbps: 1000,
    },
  };
};

describe('runExport video mime handling', () => {
  const originalMediaRecorder = (window as typeof window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder;
  const originalCaptureStream = HTMLCanvasElement.prototype.captureStream;
  let stopTrackMock: jest.Mock;

  beforeEach(() => {
    jest.useFakeTimers();
    stopTrackMock = jest.fn();
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      value: jest.fn(() => ({
        getTracks: () => [{ stop: stopTrackMock }],
      })),
    });
    (window as typeof window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder = MockMediaRecorder as unknown as typeof MediaRecorder;
    MockMediaRecorder.emitChunk = true;
  });

  afterEach(() => {
    jest.useRealTimers();
    Object.defineProperty(HTMLCanvasElement.prototype, 'captureStream', {
      configurable: true,
      value: originalCaptureStream,
    });
    (window as typeof window & { MediaRecorder?: typeof MediaRecorder }).MediaRecorder = originalMediaRecorder;
  });

  it('falls back to WebM when MP4 recording is unsupported', async () => {
    const mediaRecorderCtor = MockMediaRecorder as unknown as MediaRecorderLike;
    mediaRecorderCtor.supportedMimes = new Set(['video/webm;codecs=vp8', 'video/webm']);

    const promise = runExport(createVideoRequest('video/mp4'), jest.fn(), new AbortController().signal);
    jest.runAllTimers();
    const result = await promise;

    expect(result.kind).toBe('video');
    if (result.kind !== 'video') {
      throw new Error('Expected video export result');
    }
    expect(result.filename).toBe('demo@1x.webm');
    expect(result.mimeType).toContain('webm');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('keeps MP4 extension when MP4 recording is supported', async () => {
    const mediaRecorderCtor = MockMediaRecorder as unknown as MediaRecorderLike;
    mediaRecorderCtor.supportedMimes = new Set(['video/mp4;codecs=avc1.42E01E', 'video/mp4']);

    const promise = runExport(createVideoRequest('video/mp4'), jest.fn(), new AbortController().signal);
    jest.runAllTimers();
    const result = await promise;

    expect(result.kind).toBe('video');
    if (result.kind !== 'video') {
      throw new Error('Expected video export result');
    }
    expect(result.filename).toBe('demo@1x.mp4');
    expect(result.mimeType).toContain('mp4');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('throws when recorder emits no data and still stops tracks', async () => {
    const mediaRecorderCtor = MockMediaRecorder as unknown as MediaRecorderLike;
    mediaRecorderCtor.supportedMimes = new Set(['video/webm;codecs=vp8', 'video/webm']);
    mediaRecorderCtor.emitChunk = false;

    const promise = runExport(createVideoRequest('video/webm'), jest.fn(), new AbortController().signal);
    jest.runAllTimers();

    await expect(promise).rejects.toThrow('recorder produced no frames');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });
});
