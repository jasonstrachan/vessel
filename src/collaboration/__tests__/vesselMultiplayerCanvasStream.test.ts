import { captureVesselMultiplayerCanvasFrame } from '../vesselMultiplayerCanvasStream';

describe('vesselMultiplayerCanvasStream', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('downscales the canonical canvas without smoothing and returns a local frame payload', async () => {
    const sourceCanvas = {
      width: 1024,
      height: 512,
    } as HTMLCanvasElement;
    const drawImage = jest.fn();
    const context = {
      imageSmoothingEnabled: true,
      drawImage,
    } as unknown as CanvasRenderingContext2D;
    const arrayBuffer = jest.fn(async () => Uint8Array.from([1, 2, 3]).buffer);
    const frameCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => context),
      toBlob: jest.fn((callback: BlobCallback, type?: string) => callback({
        type: type ?? 'image/png',
        arrayBuffer,
      } as unknown as Blob)),
    } as unknown as HTMLCanvasElement;
    jest.spyOn(document, 'createElement').mockReturnValue(frameCanvas);

    const frame = await captureVesselMultiplayerCanvasFrame({
      canvas: sourceCanvas,
      projectId: 'project-1',
      projectRevision: 7,
      aiLayerType: 'color-cycle',
      sessionId: 'pixel-together',
      gestureId: 'human-gesture-1',
      gesturePhase: 'move',
      gesturePointCount: 4,
      maxSize: 512,
    });

    expect(frameCanvas.width).toBe(512);
    expect(frameCanvas.height).toBe(256);
    expect(context.imageSmoothingEnabled).toBe(false);
    expect(drawImage).toHaveBeenCalledWith(sourceCanvas, 0, 0, 512, 256);
    expect(frame).toEqual({
      frameId: expect.any(String),
      sessionId: 'pixel-together',
      projectId: 'project-1',
      projectRevision: 7,
      aiLayerType: 'color-cycle',
      capturedAt: expect.any(Number),
      width: 512,
      height: 256,
      sourceWidth: 1024,
      sourceHeight: 512,
      mimeType: 'image/webp',
      gestureId: 'human-gesture-1',
      gesturePhase: 'move',
      gesturePointCount: 4,
      blob: expect.any(Object),
    });
    expect(arrayBuffer).not.toHaveBeenCalled();
  });

  it('timestamps the pixel snapshot before asynchronous encoding completes', async () => {
    let finishEncoding: BlobCallback = () => undefined;
    const context = {
      imageSmoothingEnabled: true,
      drawImage: jest.fn(),
    } as unknown as CanvasRenderingContext2D;
    const frameCanvas = {
      width: 0,
      height: 0,
      getContext: jest.fn(() => context),
      toBlob: jest.fn((callback: BlobCallback) => {
        finishEncoding = callback;
      }),
    } as unknown as HTMLCanvasElement;
    jest.spyOn(document, 'createElement').mockReturnValue(frameCanvas);
    const now = jest.spyOn(Date, 'now').mockReturnValue(1000);

    const pending = captureVesselMultiplayerCanvasFrame({
      canvas: { width: 100, height: 100 } as HTMLCanvasElement,
      projectId: 'project-1',
      projectRevision: 4,
      aiLayerType: 'normal',
      sessionId: 'session-1',
    });
    now.mockReturnValue(2000);
    finishEncoding({ type: 'image/webp' } as Blob);

    await expect(pending).resolves.toMatchObject({ capturedAt: 1000 });
  });
});
