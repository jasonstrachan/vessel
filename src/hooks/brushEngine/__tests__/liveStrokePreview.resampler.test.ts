import { BrushShape, type BrushSettings } from '@/types';

import { renderLiveStrokePreview } from '../liveStrokePreview';
import { applyStrokeRisographOverlay } from '../liveStrokePreviewController';
import type { Rect } from '../engineShared';

const makeCanvas = (): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 4;
  return canvas;
};

const read = (canvas: HTMLCanvasElement): Uint8ClampedArray =>
  canvas.getContext('2d')!.getImageData(0, 0, 4, 4).data;

// The shared canvas double stores pixels but does not implement compositing or
// save/restore. Model only the Canvas I/O operations used by this publication.
const installCompositeIo = (ctx: CanvasRenderingContext2D): void => {
  const saved: Array<{ operation: GlobalCompositeOperation; alpha: number }> = [];
  jest.spyOn(ctx, 'save').mockImplementation(() => {
    saved.push({ operation: ctx.globalCompositeOperation, alpha: ctx.globalAlpha });
  });
  jest.spyOn(ctx, 'restore').mockImplementation(() => {
    const state = saved.pop()!;
    ctx.globalCompositeOperation = state.operation;
    ctx.globalAlpha = state.alpha;
  });
  jest.spyOn(ctx, 'drawImage').mockImplementation((source, ...args: number[]) => {
    expect(args).toEqual([0, 0, 4, 4, 0, 0, 4, 4]);
    const incoming = read(source as HTMLCanvasElement);
    const output = ctx.getImageData(0, 0, 4, 4);
    const operation = ctx.globalCompositeOperation;
    expect(['copy', 'source-over', 'multiply']).toContain(operation);
    for (let i = 0; i < output.data.length; i += 4) {
      const sourceAlpha = incoming[i + 3] / 255 * ctx.globalAlpha;
      const destinationAlpha = output.data[i + 3] / 255;
      const alpha = operation === 'copy'
        ? sourceAlpha
        : sourceAlpha + destinationAlpha * (1 - sourceAlpha);
      for (let channel = 0; channel < 3; channel += 1) {
        const sourceColor = incoming[i + channel];
        const destinationColor = output.data[i + channel];
        const sourceContribution = operation === 'multiply'
          ? sourceColor * (1 - destinationAlpha) + sourceColor * destinationColor / 255 * destinationAlpha
          : sourceColor;
        const premultiplied = sourceContribution * sourceAlpha +
          (operation === 'copy' ? 0 : destinationColor * destinationAlpha * (1 - sourceAlpha));
        output.data[i + channel] = alpha ? Math.round(premultiplied / alpha) : 0;
      }
      output.data[i + 3] = Math.round(alpha * 255);
    }
    ctx.putImageData(output, 0, 0);
  });
};

const publish = (shape: BrushShape, intensity: number) => {
  const raw = makeCanvas();
  const base = makeCanvas();
  const visible = makeCanvas();
  const rawCtx = raw.getContext('2d')!;
  const baseCtx = base.getContext('2d')!;
  const visibleCtx = visible.getContext('2d')!;
  visibleCtx.globalCompositeOperation = 'source-over';
  baseCtx.fillStyle = '#c08040';
  baseCtx.fillRect(0, 0, 4, 4);
  rawCtx.fillStyle = '#407080';
  rawCtx.fillRect(1, 1, 2, 2);
  const rawBefore = new Uint8ClampedArray(read(raw));
  const baseBefore = new Uint8ClampedArray(read(base));
  const settings = {
    brushShape: shape,
    risographIntensity: intensity,
    risographColorShift: 10,
    risographOutline: true,
  } as BrushSettings;
  const settingsBefore = { ...settings };
  const bounds = { x: 0, y: 0, width: 4, height: 4 };
  const overlay = jest.fn((ctx: CanvasRenderingContext2D, region: Rect | null, source?: HTMLCanvasElement | null) => {
    applyStrokeRisographOverlay({
      ctx, bounds: region, source, risographIntensity: settings.risographIntensity ?? 0,
    });
  });
  const scheduled = { current: true };
  installCompositeIo(visibleCtx);
  renderLiveStrokePreview({
    visibleCtx,
    liveRenderScheduledRef: scheduled,
    liveStrokeRawRef: { current: raw },
    liveStrokeDitherRef: { current: null },
    liveStrokeBaseRef: { current: base },
    liveStrokeBoundsRef: { current: bounds },
    strokeBoundsRef: { current: bounds },
    liveDirtyRectRef: { current: bounds },
    shouldApplyStrokeDither: false,
    brushSettings: settings,
    isPixelDitherNoBg: false,
    warnIfDitherStrokePath: () => { throw new Error('Unexpected dither path'); },
    withAlphaLock: (ctx, draw) => draw(ctx),
    applyStrokeDither: () => { throw new Error('Unexpected dither authoring'); },
    applyStrokeRisographOverlay: overlay,
  });
  expect(scheduled.current).toBe(false);
  expect(read(raw)).toEqual(rawBefore);
  expect(read(base)).toEqual(baseBefore);
  expect(settings).toEqual(settingsBefore);
  expect(visibleCtx.globalAlpha).toBe(1);
  expect(visibleCtx.globalCompositeOperation).toBe('source-over');
  return { pixels: new Uint8ClampedArray(read(visible)), rawBefore, baseBefore, overlay };
};

describe('Resampler ordinary live preview', () => {
  afterEach(() => { jest.restoreAllMocks(); });

  it('publishes sampled midtones and transparent holes identically with retained Riso0/100', () => {
    const off = publish(BrushShape.RESAMPLER, 0);
    const on = publish(BrushShape.RESAMPLER, 100);
    const expected = new Uint8ClampedArray(off.baseBefore);
    for (let i = 0; i < expected.length; i += 4) {
      if (off.rawBefore[i + 3]) expected.set(off.rawBefore.subarray(i, i + 4), i);
    }
    expect(off.pixels).toEqual(expected);
    expect(on.pixels).toEqual(expected);
    expect(off.overlay).not.toHaveBeenCalled();
    expect(on.overlay).not.toHaveBeenCalled();
  });

  it('retains the existing Riso overlay for supported Soft strokes', () => {
    const off = publish(BrushShape.ROUND, 0);
    const on = publish(BrushShape.ROUND, 100);
    expect(off.overlay).toHaveBeenCalledTimes(1);
    expect(on.overlay).toHaveBeenCalledTimes(1);
    const center = (1 * 4 + 1) * 4;
    expect([...off.pixels.subarray(center, center + 4)]).toEqual([64, 112, 128, 255]);
    expect([...on.pixels.subarray(center, center + 4)]).toEqual([16, 49, 64, 255]);
    expect([...on.pixels.subarray(0, 4)]).toEqual([192, 128, 64, 255]);
  });
});
