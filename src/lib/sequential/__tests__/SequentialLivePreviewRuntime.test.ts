import { BrushShape, type SequentialStrokeEvent } from '@/types';
import { SequentialCpuMaterializer } from '@/lib/sequential/materializer/SequentialCpuMaterializer';
import {
  appendSequentialLivePreviewEvents,
  clearSequentialLivePreview,
  getSequentialLivePreviewCanvas,
  getSequentialLivePreviewFrame,
} from '@/lib/sequential/SequentialLivePreviewRuntime';

const createEvent = (
  id: string,
  x: number,
  y: number,
  color: string,
  frameIndex = 0
): SequentialStrokeEvent => ({
  id,
  layerId: 'layer-seq',
  strokeId: 'stroke-1',
  timestampMs: 0,
  frameIndex,
  brush: {
    tool: 'brush',
    brushShape: BrushShape.ROUND,
    size: 4,
    opacity: 1,
    blendMode: 'source-over',
    rotation: 0,
    spacing: 1,
    color,
    customStampId: null,
  },
  stamps: [{ x, y, pressure: 1, rotation: 0, size: 4, alpha: 1 }],
});

const readPixel = (
  canvas: HTMLCanvasElement | OffscreenCanvas,
  x: number,
  y: number
): [number, number, number, number] => {
  const ctx = canvas.getContext('2d') as CanvasRenderingContext2D;
  const data = ctx.getImageData(x, y, 1, 1).data;
  return [data[0], data[1], data[2], data[3]];
};

describe('SequentialLivePreviewRuntime', () => {
  beforeEach(() => {
    clearSequentialLivePreview();
    jest.restoreAllMocks();
  });

  it('keeps a transient preview canvas for the active session', () => {
    appendSequentialLivePreviewEvents({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameCount: 4,
      events: [createEvent('event-1', 8, 8, '#ff0000')],
    });

    const canvas = getSequentialLivePreviewCanvas({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameIndex: 0,
      frameCount: 4,
    });

    expect(canvas).not.toBeNull();
    expect(readPixel(canvas!, 8, 8)).toEqual([255, 0, 0, 255]);
    expect(getSequentialLivePreviewCanvas({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:2000',
      width: 16,
      height: 16,
      frameIndex: 0,
      frameCount: 4,
    })).toBeNull();
  });

  it('patches only newly appended events instead of replaying the whole active session', () => {
    const patchSpy = jest.spyOn(SequentialCpuMaterializer.prototype, 'patchFrame');

    appendSequentialLivePreviewEvents({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameCount: 4,
      events: [createEvent('event-1', 4, 4, '#ff0000')],
    });
    appendSequentialLivePreviewEvents({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameCount: 4,
      events: [createEvent('event-2', 12, 12, '#00ff00')],
    });

    expect(patchSpy).toHaveBeenCalledTimes(2);
    expect(patchSpy.mock.calls.map(([input]) => input.events.map((event) => event.id))).toEqual([
      ['event-1'],
      ['event-2'],
    ]);

    const canvas = getSequentialLivePreviewCanvas({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameIndex: 0,
      frameCount: 4,
    });

    expect(canvas).not.toBeNull();
    expect(readPixel(canvas!, 4, 4)).toEqual([255, 0, 0, 255]);
    expect(readPixel(canvas!, 12, 12)).toEqual([0, 255, 0, 255]);
  });

  it('clears preview canvases on finalize/cancel', () => {
    appendSequentialLivePreviewEvents({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameCount: 4,
      events: [createEvent('event-1', 8, 8, '#ff0000')],
    });

    clearSequentialLivePreview('layer-seq');

    expect(getSequentialLivePreviewCanvas({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameIndex: 0,
      frameCount: 4,
    })).toBeNull();
  });

  it('keeps live preview canvases scoped to their sequence frames', () => {
    appendSequentialLivePreviewEvents({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameCount: 4,
      events: [
        createEvent('event-1', 4, 4, '#ff0000', 0),
        createEvent('event-2', 12, 12, '#00ff00', 2),
      ],
    });

    const frameZeroCanvas = getSequentialLivePreviewCanvas({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameIndex: 0,
      frameCount: 4,
    });
    const frameTwoCanvas = getSequentialLivePreviewCanvas({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 16,
      height: 16,
      frameIndex: 2,
      frameCount: 4,
    });

    expect(frameZeroCanvas).not.toBeNull();
    expect(frameTwoCanvas).not.toBeNull();
    expect(readPixel(frameZeroCanvas!, 4, 4)).toEqual([255, 0, 0, 255]);
    expect(readPixel(frameZeroCanvas!, 12, 12)).toEqual([0, 0, 0, 0]);
    expect(readPixel(frameTwoCanvas!, 4, 4)).toEqual([0, 0, 0, 0]);
    expect(readPixel(frameTwoCanvas!, 12, 12)).toEqual([0, 255, 0, 255]);
  });

  it('exposes the accumulated live preview bounds for bounded blits', () => {
    appendSequentialLivePreviewEvents({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 32,
      height: 32,
      frameCount: 4,
      events: [
        createEvent('event-1', 8, 8, '#ff0000', 0),
        createEvent('event-2', 20, 20, '#00ff00', 0),
      ],
    });

    const frame = getSequentialLivePreviewFrame({
      layerId: 'layer-seq',
      sessionKey: 'layer-seq:1000',
      width: 32,
      height: 32,
      frameIndex: 0,
      frameCount: 4,
    });

    expect(frame).not.toBeNull();
    expect(frame!.bounds.x).toBeLessThanOrEqual(8);
    expect(frame!.bounds.y).toBeLessThanOrEqual(8);
    expect(frame!.bounds.x + frame!.bounds.width).toBeGreaterThan(20);
    expect(frame!.bounds.y + frame!.bounds.height).toBeGreaterThan(20);
  });
});
