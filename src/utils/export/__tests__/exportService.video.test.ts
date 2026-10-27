import { runExport } from '@/utils/export/exportService';
import type { VideoExportRequest, FrameProvider } from '@/utils/export/types';

type MediaRecorderLike = typeof MediaRecorder & {
  supportedMimes: Set<string>;
  emitChunk: boolean;
};

class MockMediaRecorder {
  static supportedMimes = new Set<string>();

  static emitChunk = true;

  static instances: MockMediaRecorder[] = [];

  static constructorFails = false;

  static startFails = false;

  static errorOnStart = false;

  static refineMime = false;

  static onStopped: (() => void) | undefined;

  public state: RecordingState = 'inactive';

  static isTypeSupported(type: string) {
    return MockMediaRecorder.supportedMimes.has(type);
  }

  public mimeType: string;

  public ondataavailable: ((event: BlobEvent) => void) | null = null;

  public onstop: ((event: Event) => void) | null = null;

  public onerror: ((event: Event) => void) | null = null;

  constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
    if (MockMediaRecorder.constructorFails) throw new Error('constructor failed');
    this.mimeType = options?.mimeType ?? '';
    MockMediaRecorder.instances.push(this);
  }

  start() {
    if (MockMediaRecorder.startFails) throw new Error('start failed');
    this.state = 'recording';
    if (MockMediaRecorder.refineMime) this.mimeType = 'video/mp4;codecs=avc1.420020';
    if (MockMediaRecorder.errorOnStart) this.onerror?.(new Event('error'));
  }

  stop = jest.fn(() => {
    this.state = 'inactive';
    if (MockMediaRecorder.emitChunk) {
      this.ondataavailable?.({
        data: new Blob(['video'], { type: this.mimeType }),
      } as BlobEvent);
    }
    this.onstop?.(new Event('stop'));
    MockMediaRecorder.onStopped?.();
  });
}

const createVideoRequest = (mimeType: 'video/mp4' | 'video/webm'): VideoExportRequest => {
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
    MockMediaRecorder.instances = [];
    MockMediaRecorder.constructorFails = false;
    MockMediaRecorder.startFails = false;
    MockMediaRecorder.errorOnStart = false;
    MockMediaRecorder.refineMime = false;
    MockMediaRecorder.onStopped = undefined;
    MockMediaRecorder.supportedMimes = new Set(['video/webm;codecs=vp8']);
  });

  afterEach(() => {
    jest.clearAllTimers();
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

  it('rejects cancellation after a rendered frame instead of returning partial chunks', async () => {
    const controller = new AbortController();
    const request = createVideoRequest('video/webm');
    const finish = jest.fn();
    const composite = jest.fn();
    request.frameProvider.beginAnimationSession = () => ({ finish, stepFrame: jest.fn() });
    request.frameProvider.compositeToCanvas = composite;
    const progress = jest.fn((value: { phase: string }) => { if (value.phase === 'encode') controller.abort(); });
    const promise = runExport(request, progress, controller.signal);
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    jest.runAllTimers();
    await rejected;
    expect(composite).toHaveBeenCalledTimes(1);
    expect(finish).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances[0].state).toBe('inactive');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
    jest.runAllTimers();
    expect(composite).toHaveBeenCalledTimes(1);
  });

  it('rejects cancellation delivered with the final native stop event', async () => {
    const controller = new AbortController();
    MockMediaRecorder.onStopped = () => controller.abort();
    const promise = runExport(createVideoRequest('video/webm'), jest.fn(), controller.signal);
    const rejected = expect(promise).rejects.toMatchObject({ name: 'AbortError' });
    jest.runAllTimers();
    await rejected;
    expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it.each(['composite', 'step'] as const)('rejects a scheduled %s failure and releases the session and recording', async (stage) => {
    const request = createVideoRequest('video/webm');
    const failure = new Error('scheduled frame failed');
    const finish = jest.fn();
    const fail = () => { throw failure; };
    request.frameProvider.beginAnimationSession = () => ({ finish, stepFrame: stage === 'step' ? fail : jest.fn() });
    request.frameProvider.compositeToCanvas = stage === 'composite' ? fail : jest.fn();
    const promise = runExport(request, jest.fn(), new AbortController().signal);
    const rejected = expect(promise).rejects.toBe(failure);
    expect(() => jest.runAllTimers()).not.toThrow();
    await rejected;
    expect(finish).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances[0].stop).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances[0].state).toBe('inactive');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('releases the stream when both recorder constructor attempts fail', async () => {
    MockMediaRecorder.constructorFails = true;
    const request = createVideoRequest('video/webm');
    const begin = jest.fn();
    request.frameProvider.beginAnimationSession = begin;
    await expect(runExport(request, jest.fn(), new AbortController().signal)).rejects.toThrow('constructor failed');
    expect(begin).not.toHaveBeenCalled();
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('releases the stream when animation-session initialization fails', async () => {
    const request = createVideoRequest('video/webm');
    request.frameProvider.beginAnimationSession = () => { throw new Error('session failed'); };
    await expect(runExport(request, jest.fn(), new AbortController().signal)).rejects.toThrow('session failed');
    expect(MockMediaRecorder.instances[0].state).toBe('inactive');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('finishes a created session and releases tracks when native start fails', async () => {
    MockMediaRecorder.startFails = true;
    const request = createVideoRequest('video/webm');
    const finish = jest.fn();
    request.frameProvider.beginAnimationSession = () => ({ finish, stepFrame: jest.fn() });
    await expect(runExport(request, jest.fn(), new AbortController().signal)).rejects.toThrow('start failed');
    expect(finish).toHaveBeenCalledTimes(1);
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('ends recording and cancels future frame work after a native recorder error', async () => {
    MockMediaRecorder.errorOnStart = true;
    const request = createVideoRequest('video/webm');
    const finish = jest.fn();
    const composite = jest.fn();
    request.frameProvider.beginAnimationSession = () => ({ finish, stepFrame: jest.fn() });
    request.frameProvider.compositeToCanvas = composite;
    await expect(runExport(request, jest.fn(), new AbortController().signal)).rejects.toThrow('recorder error');
    jest.runAllTimers();
    expect(composite).not.toHaveBeenCalled();
    expect(finish).toHaveBeenCalledTimes(1);
    expect(MockMediaRecorder.instances[0].state).toBe('inactive');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('preserves the primary export error and still releases tracks when session cleanup throws', async () => {
    MockMediaRecorder.emitChunk = false;
    const request = createVideoRequest('video/webm');
    request.frameProvider.beginAnimationSession = () => ({ stepFrame: jest.fn(), finish: () => { throw new Error('cleanup failed'); } });
    const promise = runExport(request, jest.fn(), new AbortController().signal);
    const rejected = expect(promise).rejects.toThrow('recorder produced no frames');
    jest.runAllTimers();
    await rejected;
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

  it('uses the final native MIME after start refines the constructor MIME', async () => {
    MockMediaRecorder.supportedMimes = new Set(['video/mp4;codecs=avc1.42E01E']);
    MockMediaRecorder.refineMime = true;
    const promise = runExport(createVideoRequest('video/mp4'), jest.fn(), new AbortController().signal);
    jest.runAllTimers();
    const result = await promise;
    expect(result.kind).toBe('video');
    if (result.kind !== 'video') throw new Error('Expected video');
    expect(result.mimeType).toBe('video/mp4;codecs=avc1.420020');
    expect(result.filename).toBe('demo@1x.mp4');
    expect(stopTrackMock).toHaveBeenCalledTimes(1);
  });

});
