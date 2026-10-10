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

  it.each([
    { color: '#ff0000', alpha: 1, premultiplied: [1, 0, 0, 1], straight: [255, 0, 0, 1] },
    { color: '#996633', alpha: 85, premultiplied: [51, 34, 17, 85], straight: [153, 102, 51, 85] },
    { color: '#ff0000', alpha: 128, premultiplied: [128, 0, 0, 128], straight: [255, 0, 0, 128] },
    { color: '#996633', alpha: 255, premultiplied: [153, 102, 51, 255], straight: [153, 102, 51, 255] },
  ])('presents alpha $alpha without changing premultiplied CPU tiles', ({ color, alpha, premultiplied, straight }) => {
    const patchFrame = SequentialCpuMaterializer.prototype.patchFrame;
    const outputs: { data: Uint8ClampedArray; original: Uint8ClampedArray }[] = [];
    const patchSpy = jest.spyOn(SequentialCpuMaterializer.prototype, 'patchFrame')
      .mockImplementation(function (this: SequentialCpuMaterializer, input) {
        const result = patchFrame.call(this, input);
        outputs.push(...result.tiles.map((tile) => ({ data: tile.data, original: tile.data.slice() })));
        return result;
      });
    try {
      const event = createEvent('partial', 8, 8, color);
      event.stamps = [{ ...event.stamps[0], alpha: alpha / 255 }];
      appendSequentialLivePreviewEvents({
        layerId: 'layer-seq', sessionKey: 'partial-session', width: 16, height: 16,
        frameCount: 2, events: [event, createEvent('other-frame', 8, 8, '#0000ff', 1)],
      });
      const options = { layerId: 'layer-seq', sessionKey: 'partial-session', width: 16, height: 16, frameCount: 2 };
      const canvas = getSequentialLivePreviewCanvas({ ...options, frameIndex: 0 })!;
      expect(readPixel(canvas, 0, 0)).toEqual([0, 0, 0, 0]);
      expect(readPixel(getSequentialLivePreviewCanvas({ ...options, frameIndex: 1 })!, 8, 8)).toEqual([0, 0, 255, 255]);
      for (const output of outputs) {
        expect(output.data).toEqual(output.original);
      }
      const sourceIndex = (8 * 16 + 8) * 4;
      expect(Array.from(outputs[0].original.slice(sourceIndex, sourceIndex + 4))).toEqual(premultiplied);
      expect(readPixel(canvas, 8, 8)).toEqual(straight);
    } finally {
      patchSpy.mockRestore();
    }
  });

  it('preserves partial erase overlap, support and session resets in transient CPU presentation', () => {
    const putImageDataSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'putImageData');
    const options = { layerId: 'layer-seq', sessionKey: 'erase-session', width: 16, height: 16, frameCount: 2 };
    const paint = createEvent('paint', 8, 8, '#ff0000');
    paint.brush = { ...paint.brush, brushShape: BrushShape.SQUARE, size: 6 };
    paint.stamps = [{ ...paint.stamps[0], size: 6 }];
    appendSequentialLivePreviewEvents({ ...options, events: [paint] });
    const observed: number[][] = [];
    for (let index = 0; index < 2; index += 1) {
      const erase = createEvent(`erase-${index}`, 8, 8, '#000000');
      erase.brush = { ...erase.brush, tool: 'eraser', brushShape: BrushShape.SQUARE, blendMode: 'destination-out', size: 2 };
      erase.stamps = [{ ...erase.stamps[0], size: 2, alpha: 0.5 }];
      appendSequentialLivePreviewEvents({ ...options, events: [erase] });
      const canvas = getSequentialLivePreviewCanvas({ ...options, frameIndex: 0 })!;
      observed.push(readPixel(canvas, 8, 8));
      expect(readPixel(canvas, 6, 8)).toEqual([255, 0, 0, 255]);
      expect(readPixel(canvas, 0, 0)).toEqual([0, 0, 0, 0]);
    }
    const copies = putImageDataSpy.mock.calls.map(([image]) => image);
    expect(copies).toHaveLength(3);
    expect(copies[1]).toBe(copies[0]);
    expect(copies[2]).toBe(copies[0]);
    clearSequentialLivePreview('layer-seq');
    expect(getSequentialLivePreviewCanvas({ ...options, frameIndex: 0 })).toBeNull();
    const nextOptions = { ...options, sessionKey: 'next-session', width: 8, height: 8 };
    appendSequentialLivePreviewEvents({ ...nextOptions, events: [createEvent('next', 2, 2, '#0000ff')] });
    const next = getSequentialLivePreviewCanvas({ ...nextOptions, frameIndex: 0 })!;
    expect(putImageDataSpy.mock.calls[3][0]).not.toBe(copies[0]);
    expect(readPixel(next, 2, 2)).toEqual([0, 0, 255, 255]);
    expect(readPixel(next, 6, 6)).toEqual([0, 0, 0, 0]);
    expect(getSequentialLivePreviewCanvas({ ...options, frameIndex: 0 })).toBeNull();
    expect(observed).toEqual([[255, 0, 0, 128], [255, 0, 0, 64]]);
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
