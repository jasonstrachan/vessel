import { renderLiveStrokePreview } from '../liveStrokePreview';
import { finalizeStrokeAfterEngine } from '../strokeFinalizeController';
import { ditherRegionWithCurrentPressure } from '../strokeDitherRegion';
import { inflateRect, type Rect } from '../engineShared';
import { applyLostEdgeMaskInRegion, applyLostEdgeToStrokeAlphaData } from '../strokeDitherUtils';
import type { BrushSettings } from '@/types';

describe('cumulative eraser mask composition', () => {
  it.each([
    ['destination-out', false],
    ['source-over', true],
    ['source-over', false],
  ] as const)('restores cumulative %s strokes (explicit restore: %s) before preview and finalization', (composite, restoreBase) => {
    const previews = 3;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 10;
    const ctx = canvas.getContext('2d')!;
    const raw = document.createElement('canvas');
    const base = document.createElement('canvas');
    raw.width = raw.height = base.width = base.height = 10;
    const bounds = { x: 2, y: 2, width: 4, height: 4 };
    const operations: Array<{ source: CanvasImageSource; op: string; alpha: number }> = [];
    // The shared canvas mock does not implement composition or save/restore.
    const saved: Array<{ op: GlobalCompositeOperation; alpha: number }> = [];
    jest.spyOn(ctx, 'save').mockImplementation(() => { saved.push({ op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }); });
    jest.spyOn(ctx, 'restore').mockImplementation(() => {
      const state = saved.pop()!;
      ctx.globalCompositeOperation = state.op;
      ctx.globalAlpha = state.alpha;
    });
    jest.spyOn(ctx, 'drawImage').mockImplementation((source) => {
      operations.push({ source, op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha });
    });
    ctx.globalCompositeOperation = composite;
    ctx.globalAlpha = 1;
    const withAlphaLock = (_ctx: CanvasRenderingContext2D, draw: (target: CanvasRenderingContext2D) => void) => draw(_ctx);
    for (let i = 0; i < previews; i++) {
      renderLiveStrokePreview({
        restoreBase,
        visibleCtx: ctx, liveRenderScheduledRef: { current: true },
        liveStrokeRawRef: { current: raw }, liveStrokeDitherRef: { current: null },
        liveStrokeBaseRef: { current: base }, liveStrokeBoundsRef: { current: bounds },
        strokeBoundsRef: { current: bounds }, liveDirtyRectRef: { current: bounds },
        shouldApplyStrokeDither: false, brushSettings: {} as BrushSettings,
        isPixelDitherNoBg: false, warnIfDitherStrokePath: jest.fn(),
        withAlphaLock, applyStrokeDither: jest.fn(), applyStrokeRisographOverlay: jest.fn(),
      });
    }
    finalizeStrokeAfterEngine({
      restoreBase,
      ctx, strokeBounds: bounds, region: bounds, rawCanvas: raw, baseCanvas: base,
      ditherCanvas: null, rawCtx: raw.getContext('2d'), ditherCtx: null,
      shouldApplyStrokeDither: false, settings: {}, applyLostEdgeMaskInRegion: jest.fn(),
      withAlphaLock, committedPixelSizeRef: { current: null }, lastPressureDitherPixelSizeRef: { current: null },
      getStrokeDitherPixelSize: () => 1, ditherRegionWithCurrentPressure: jest.fn(),
      applyStrokeDither: jest.fn(), applyStrokeRisographOverlay: jest.fn(),
      isDitherStrokeBrush: false, warnIfDitherStrokePath: jest.fn(), finalizeAndReset: () => bounds,
    });
    expect(operations).toEqual(Array.from({ length: previews + 1 }, () => [
      { source: base, op: 'copy', alpha: 1 },
      { source: raw, op: composite, alpha: 1 },
    ]).flat());
    expect(ctx.globalCompositeOperation).toBe(composite);
  });

  it.each(['destination-out', 'source-over'] as const)('keeps %s dither preview coverage identical to finalization after a local dirty update', (composite) => {
    const makeCanvas = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 128;
      canvas.height = 64;
      return canvas;
    };
    const visible = makeCanvas();
    const raw = makeCanvas();
    const base = makeCanvas();
    const dither = makeCanvas();
    const ctx = visible.getContext('2d')!;
    const rawCtx = raw.getContext('2d')!;
    const ditherCtx = dither.getContext('2d')!;
    const source = new ImageData(128, 64);
    for (let y = 20; y < 44; y += 1) {
      for (let x = 8; x < 120; x += 1) {
        source.data.set([255, 255, 255, x % 16 < 4 ? 128 : 192], (y * 128 + x) * 4);
      }
    }
    rawCtx.putImageData(source, 0, 0);
    const bounds = { x: 0, y: 0, width: 128, height: 64 };
    const settings = {
      color: '#ffffff', ditherEnabled: true, ditherAlgorithm: 'sierra-lite',
      ditherBackgroundFill: false, fillResolution: 4,
    } as BrushSettings;
    const ditherRegion = (target: CanvasRenderingContext2D, region: Rect, sampleCtx?: CanvasRenderingContext2D) => {
      ditherRegionWithCurrentPressure({
        ctx: target, region, sampleCtx, signal: 'alpha', toolsBrushSettings: settings,
        strokeDitherPalette: ['#000000', '#ffffff'], transparentInk: [0, 0, 0],
        computeStrokeDitherPaletteForSettings: () => ['#000000', '#ffffff'],
        pickTransparentInk: () => [0, 0, 0], computePressureScaledResolution: () => 4,
        getStrokeDitherPixelSize: () => 4, applyLostEdgeToStrokeAlpha: jest.fn(),
        ensureBgOffTemp: () => null, ensureBgOffHole: () => null,
        bgOffMaskImageRef: { current: null }, strokePhaseOriginRef: { current: null }, DD: jest.fn(),
      });
    };
    const masks: Uint8ClampedArray[] = [];
    const restored: number[][] = [];
    const blits: number[][] = [];
    // Keep only canvas I/O mocked; coverage uses the production dither and finalizer.
    const saved: Array<{ op: GlobalCompositeOperation; alpha: number }> = [];
    jest.spyOn(ctx, 'save').mockImplementation(() => { saved.push({ op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }); });
    jest.spyOn(ctx, 'restore').mockImplementation(() => {
      const state = saved.pop()!;
      ctx.globalCompositeOperation = state.op;
      ctx.globalAlpha = state.alpha;
    });
    jest.spyOn(ctx, 'drawImage').mockImplementation((image, ...args: number[]) => {
      if (image === base) restored.push(args);
      if (image === dither) {
        blits.push(args);
        masks.push(ditherCtx.getImageData(0, 0, 128, 64).data);
      }
    });
    ctx.globalCompositeOperation = composite;
    ctx.globalAlpha = 1;
    const withAlphaLock = (target: CanvasRenderingContext2D, draw: (context: CanvasRenderingContext2D) => void) => draw(target);
    for (const dirty of [bounds, { x: 64, y: 8, width: 64, height: 48 }]) {
      renderLiveStrokePreview({
        restoreBase: composite === 'source-over', visibleCtx: ctx,
        liveRenderScheduledRef: { current: true }, liveStrokeRawRef: { current: raw },
        liveStrokeDitherRef: { current: dither }, liveStrokeBaseRef: { current: base },
        liveStrokeBoundsRef: { current: bounds }, strokeBoundsRef: { current: bounds },
        liveDirtyRectRef: { current: dirty }, shouldApplyStrokeDither: true,
        brushSettings: settings, isPixelDitherNoBg: false, warnIfDitherStrokePath: jest.fn(),
        withAlphaLock, applyStrokeDither: (target, region, sample) => {
          if (region) ditherRegion(target, region, sample);
        }, applyStrokeRisographOverlay: jest.fn(),
      });
    }
    finalizeStrokeAfterEngine({
      restoreBase: composite === 'source-over', ctx, strokeBounds: bounds, region: bounds,
      rawCanvas: raw, baseCanvas: base, ditherCanvas: dither, rawCtx, ditherCtx,
      shouldApplyStrokeDither: true, settings, applyLostEdgeMaskInRegion: jest.fn(),
      withAlphaLock, committedPixelSizeRef: { current: null }, lastPressureDitherPixelSizeRef: { current: null },
      getStrokeDitherPixelSize: () => 4, ditherRegionWithCurrentPressure: ditherRegion,
      applyStrokeDither: jest.fn(), applyStrokeRisographOverlay: jest.fn(),
      isDitherStrokeBrush: false, warnIfDitherStrokePath: jest.fn(), finalizeAndReset: () => bounds,
    });
    expect(masks).toHaveLength(3);
    expect(masks[1].every((value, i) => value === masks[2][i])).toBe(true);
    expect(masks[0].every((value, i) => value === masks[1][i])).toBe(true);
    expect(restored).toEqual(Array.from({ length: 3 }, () => [0, 0, 128, 64, 0, 0, 128, 64]));
    expect(blits).toEqual(Array.from({ length: 3 }, () => [0, 0, 128, 64, 0, 0, 128, 64]));
  });

  it('rebuilds cumulative color dithering and restores its base after a local update', () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 64;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over';
    const bounds = { x: 4, y: 8, width: 48, height: 32 };
    const dirty = { x: 32, y: 16, width: 16, height: 16 };
    const dither = document.createElement('canvas');
    dither.width = dither.height = 64;
    const applyStrokeDither = jest.fn();
    const drawImage = jest.spyOn(ctx, 'drawImage');
    renderLiveStrokePreview({
      visibleCtx: ctx, liveRenderScheduledRef: { current: true },
      liveStrokeRawRef: { current: canvas }, liveStrokeDitherRef: { current: dither },
      liveStrokeBaseRef: { current: canvas },
      liveStrokeBoundsRef: { current: { x: 0, y: 0, width: 64, height: 64 } },
      strokeBoundsRef: { current: bounds }, liveDirtyRectRef: { current: dirty },
      shouldApplyStrokeDither: true, brushSettings: { ditherBackgroundFill: false } as BrushSettings,
      isPixelDitherNoBg: false, warnIfDitherStrokePath: jest.fn(),
      withAlphaLock: (target, draw) => draw(target), applyStrokeDither, applyStrokeRisographOverlay: jest.fn(),
    });
    expect(applyStrokeDither).toHaveBeenCalledWith(dither.getContext('2d'), bounds, ctx, { mergeExisting: false });
    expect(drawImage).toHaveBeenCalledTimes(2);
    expect(drawImage.mock.calls[0][0]).toBe(canvas);
    expect(drawImage).toHaveBeenCalledWith(dither, 4, 8, 48, 32, 4, 8, 48, 32);
  });
});

describe('prepared pressure eraser finalization', () => {
  it('commits the prepared run mask without re-dithering earlier runs at the final pressure', () => {
    const make = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 16;
      return canvas;
    };
    const raw = make(), dither = make(), base = make(), visible = make();
    const rawCtx = raw.getContext('2d')!, ditherCtx = dither.getContext('2d')!, ctx = visible.getContext('2d')!;
    const prepared = new ImageData(16, 16);
    prepared.data.set([255, 255, 255, 255], (8 * 16 + 8) * 4);
    ditherCtx.putImageData(prepared, 0, 0);
    const ditherRegion = jest.fn();
    const blitted: Uint8ClampedArray[] = [];
    jest.spyOn(ctx, 'drawImage').mockImplementation((canvas) => {
      if (canvas === dither) blitted.push(ditherCtx.getImageData(0, 0, 16, 16).data);
    });
    const bounds = { x: 0, y: 0, width: 16, height: 16 };
    finalizeStrokeAfterEngine({
      restoreBase: true, preparedPressureMask: true,
      ctx, strokeBounds: bounds, region: bounds, rawCanvas: raw, baseCanvas: base,
      ditherCanvas: dither, rawCtx, ditherCtx, shouldApplyStrokeDither: true,
      settings: { pressureLinkedFillResolution: true, ditherBackgroundFill: false },
      applyLostEdgeMaskInRegion: jest.fn(),
      withAlphaLock: (target, draw) => draw(target),
      committedPixelSizeRef: { current: 1 }, lastPressureDitherPixelSizeRef: { current: 1 },
      getStrokeDitherPixelSize: () => 1, ditherRegionWithCurrentPressure: ditherRegion,
      applyStrokeDither: jest.fn(), applyStrokeRisographOverlay: jest.fn(),
      isDitherStrokeBrush: false, warnIfDitherStrokePath: jest.fn(), finalizeAndReset: () => bounds,
    });
    expect(ditherRegion).not.toHaveBeenCalled();
    expect(blitted).toEqual([prepared.data]);
  });
});

describe('presentation-only deferred endpoint source', () => {
  it.each([
    [true, false, 'destination-out', true],
    [true, true, 'destination-out', true],
    [false, false, 'source-over', false],
    [false, false, 'destination-out', true],
  ] as const)('keeps composition ownership with restore=%s dither=%s composite=%s', (restoreBase, shouldApplyStrokeDither, composite, usesPreview) => {
    const make = () => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = 32;
      return canvas;
    };
    const raw = make(), preview = make(), base = make(), visible = make();
    const ctx = visible.getContext('2d')!;
    const bounds = { x: 12, y: 12, width: 4, height: 4 };
    const presentationBounds = { x: 8, y: 8, width: 12, height: 12 };
    const saved: Array<{ op: GlobalCompositeOperation; alpha: number }> = [];
    jest.spyOn(ctx, 'save').mockImplementation(() => saved.push({ op: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }));
    jest.spyOn(ctx, 'restore').mockImplementation(() => {
      const state = saved.pop()!;
      ctx.globalCompositeOperation = state.op;
      ctx.globalAlpha = state.alpha;
    });
    const blits: Array<{ source: CanvasImageSource; args: number[]; composite: string }> = [];
    jest.spyOn(ctx, 'drawImage').mockImplementation((source, ...args: number[]) => {
      blits.push({ source, args, composite: ctx.globalCompositeOperation });
    });
    const withAlphaLock = jest.fn((target: CanvasRenderingContext2D, draw: (context: CanvasRenderingContext2D) => void) => draw(target));
    const scheduled = { current: true };
    const strokeBounds = { current: bounds as Rect | null };
    ctx.globalCompositeOperation = composite;
    renderLiveStrokePreview({
      restoreBase, previewSource: { canvas: preview, bounds: presentationBounds },
      visibleCtx: ctx, liveRenderScheduledRef: scheduled,
      liveStrokeRawRef: { current: raw }, liveStrokeDitherRef: { current: null },
      liveStrokeBaseRef: { current: base }, liveStrokeBoundsRef: strokeBounds,
      strokeBoundsRef: strokeBounds, liveDirtyRectRef: { current: bounds },
      shouldApplyStrokeDither, brushSettings: {} as BrushSettings,
      isPixelDitherNoBg: false, warnIfDitherStrokePath: jest.fn(),
      withAlphaLock, applyStrokeDither: jest.fn(), applyStrokeRisographOverlay: jest.fn(),
    });
    const expectedBounds = usesPreview ? presentationBounds : bounds;
    expect(blits.at(-1)?.source).toBe(usesPreview ? preview : raw);
    expect(withAlphaLock).toHaveBeenCalledWith(ctx, expect.any(Function), expectedBounds);
    if (restoreBase || composite === 'destination-out') {
      expect(blits[0]).toEqual({
        source: base,
        args: [expectedBounds.x, expectedBounds.y, expectedBounds.width, expectedBounds.height, expectedBounds.x, expectedBounds.y, expectedBounds.width, expectedBounds.height],
        composite: 'copy',
      });
    }
    expect(scheduled.current).toBe(false);
    strokeBounds.current = null;
    const count = blits.length;
    renderLiveStrokePreview({
      restoreBase, previewSource: { canvas: preview, bounds: presentationBounds },
      visibleCtx: ctx, liveRenderScheduledRef: scheduled,
      liveStrokeRawRef: { current: raw }, liveStrokeDitherRef: { current: null },
      liveStrokeBaseRef: { current: base }, liveStrokeBoundsRef: strokeBounds,
      strokeBoundsRef: strokeBounds, liveDirtyRectRef: { current: bounds },
      shouldApplyStrokeDither, brushSettings: {} as BrushSettings,
      isPixelDitherNoBg: false, warnIfDitherStrokePath: jest.fn(),
      withAlphaLock, applyStrokeDither: jest.fn(), applyStrokeRisographOverlay: jest.fn(),
    });
    expect(blits).toHaveLength(count);
  });
});


describe('deterministic eraser release effects', () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean }).__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__ = true;
  });
  afterEach(() => {
    delete (globalThis as typeof globalThis & { __VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__?: boolean }).__VESSEL_RASTERIZE_CANVAS_DRAW_IMAGE__;
    jest.restoreAllMocks();
  });

  it.each([
    [false, false, false, false, 0], [false, true, false, false, 0], [false, false, true, false, 0],
    [true, false, false, false, 0], [true, true, false, false, 0],
    [false, false, false, true, 0], [false, true, false, true, 0],
    [true, false, false, true, 0], [true, true, false, true, 0],
    [false, false, false, false, 100], [false, true, false, false, 100],
    [false, false, true, false, 100], [false, true, true, false, 100],
    [false, false, false, true, 100], [false, true, false, true, 100],
    [false, false, true, true, 100], [false, true, true, true, 100],
  ] as const)('matches final effect domain with dither=%s CC=%s noCap=%s edge=%s Riso=%s', (ditherEnabled, cc, noCap, edge, risographIntensity) => {
    const make = () => {
      const canvas = document.createElement('canvas');
      canvas.width = 64;
      canvas.height = 48;
      return canvas;
    };
    const raw = make(), completed = make(), dither = make(), base = make(), visible = make(), finalRaw = make();
    const ctx = visible.getContext('2d')!;
    const rawCtx = raw.getContext('2d')!;
    const completedCtx = completed.getContext('2d')!;
    const finalCtx = finalRaw.getContext('2d')!;
    const ditherCtx = dither.getContext('2d')!;
    const initial = new ImageData(64, 48);
    // Completed Riso output has nonuniform coverage before the final Lost Edge pass.
    const stampPixel = (x: number, y: number): [number, number, number, number] =>
      [255, 255, 255, risographIntensity > 0 ? 64 + (x * 17 + y * 29) % 160 : 128];
    for (let y = 20; y < 25; y++) {
      for (let x = 8; x < 44; x++) initial.data.set(stampPixel(x, y), (y * 64 + x) * 4);
    }
    // This border is sampled by final Lost Edge but never belongs to its blit.
    initial.data.set([255, 255, 255, 128], (11 * 64 + 3) * 4);
    initial.data.set([255, 255, 255, 128], (20 * 64 + 55) * 4);
    rawCtx.putImageData(initial, 0, 0);
    const released = new ImageData(new Uint8ClampedArray(initial.data), 64, 48);
    if (!noCap) {
      for (let y = 20; y < 25; y++) {
        for (let x = 44; x < 48; x++) released.data.set(stampPixel(x, y), (y * 64 + x) * 4);
      }
    }
    completedCtx.putImageData(released, 0, 0);
    finalCtx.putImageData(released, 0, 0);
    const beforeRaw = rawCtx.getImageData(0, 0, 64, 48).data;
    const beforeCompleted = completedCtx.getImageData(0, 0, 64, 48).data;
    const bounds = edge ? { x: 0, y: 0, width: 52, height: 36 } : { x: 4, y: 12, width: 48, height: 24 };
    const redraw = { x: 0, y: 0, width: 64, height: 48 };
    const settings = {
      color: '#ffffff', ditherEnabled, ditherAlgorithm: 'sierra-lite',
      ditherBackgroundFill: false, fillResolution: 4, pressureLinkedFillResolution: false,
      lostEdge: ditherEnabled ? 0 : 100, risographIntensity,
    } as BrushSettings;
    const lostSamples: Uint8ClampedArray[] = [];
    const lost = jest.fn((target: CanvasRenderingContext2D, region: Rect | null, intensity?: number) => {
      if (region) {
        lostSamples.push(target.getImageData(Math.max(0, region.x), Math.max(0, region.y), region.width, region.height).data);
      }
      applyLostEdgeMaskInRegion(target, region, intensity, applyLostEdgeToStrokeAlphaData);
    });
    const sampleDomains: Rect[] = [];
    const runDither = (target: CanvasRenderingContext2D, region: Rect, sampleCtx?: CanvasRenderingContext2D) => {
      sampleDomains.push(region);
      ditherRegionWithCurrentPressure({
        ctx: target, region, sampleCtx, signal: 'alpha', toolsBrushSettings: settings,
        strokeDitherPalette: ['#000000', '#ffffff'], transparentInk: [0, 0, 0],
        computeStrokeDitherPaletteForSettings: () => ['#000000', '#ffffff'],
        pickTransparentInk: () => [0, 0, 0], computePressureScaledResolution: () => 4,
        getStrokeDitherPixelSize: () => 4, applyLostEdgeToStrokeAlpha: applyLostEdgeToStrokeAlphaData,
        ensureBgOffTemp: () => null, ensureBgOffHole: () => null,
        bgOffMaskImageRef: { current: null }, strokePhaseOriginRef: { current: null }, DD: jest.fn(),
      });
    };
    const blits: Array<{ pixels: Uint8ClampedArray; args: number[] }> = [];
    const restores: number[][] = [];
    const saved: Array<{ composite: GlobalCompositeOperation; alpha: number }> = [];
    jest.spyOn(ctx, 'save').mockImplementation(() => { saved.push({ composite: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }); });
    jest.spyOn(ctx, 'restore').mockImplementation(() => {
      const previous = saved.pop()!;
      ctx.globalCompositeOperation = previous.composite;
      ctx.globalAlpha = previous.alpha;
    });
    jest.spyOn(ctx, 'drawImage').mockImplementation((source, ...args: number[]) => {
      if (source === base) restores.push(args);
      else blits.push({
        pixels: (source as HTMLCanvasElement).getContext('2d')!.getImageData(bounds.x, bounds.y, bounds.width, bounds.height).data,
        args,
      });
    });
    ctx.globalCompositeOperation = cc ? 'source-over' : 'destination-out';
    const withAlphaLock = (target: CanvasRenderingContext2D, draw: (target: CanvasRenderingContext2D) => void) => draw(target);
    for (let index = 0; index < 3; index++) {
      renderLiveStrokePreview({
        restoreBase: cc, previewSource: noCap ? null : { canvas: completed, bounds: redraw },
        visibleCtx: ctx, liveRenderScheduledRef: { current: true }, liveStrokeRawRef: { current: raw },
        liveStrokeDitherRef: { current: dither }, liveStrokeBaseRef: { current: base },
        liveStrokeBoundsRef: { current: redraw }, strokeBoundsRef: { current: bounds },
        liveDirtyRectRef: { current: { x: 40, y: 20, width: 8, height: 5 } },
        shouldApplyStrokeDither: ditherEnabled, brushSettings: settings, isPixelDitherNoBg: false,
        warnIfDitherStrokePath: jest.fn(), withAlphaLock, applyLostEdgeMaskInRegion: lost,
        applyStrokeDither: (target, region, sample) => { if (region) runDither(target, region, sample); },
        applyStrokeRisographOverlay: jest.fn(),
      });
      expect(rawCtx.getImageData(0, 0, 64, 48).data).toEqual(beforeRaw);
      expect(completedCtx.getImageData(0, 0, 64, 48).data).toEqual(beforeCompleted);
    }
    finalizeStrokeAfterEngine({
      restoreBase: cc, ctx, strokeBounds: bounds, region: bounds, rawCanvas: finalRaw, baseCanvas: base,
      ditherCanvas: dither, rawCtx: finalCtx, ditherCtx, shouldApplyStrokeDither: ditherEnabled,
      settings, applyLostEdgeMaskInRegion: lost, withAlphaLock,
      committedPixelSizeRef: { current: null }, lastPressureDitherPixelSizeRef: { current: null },
      getStrokeDitherPixelSize: () => 4, ditherRegionWithCurrentPressure: runDither,
      applyStrokeDither: jest.fn(), applyStrokeRisographOverlay: jest.fn(),
      isDitherStrokeBrush: false, warnIfDitherStrokePath: jest.fn(), finalizeAndReset: () => bounds,
    });
    expect(blits).toHaveLength(4);
    for (const held of blits.slice(0, 3)) {
      expect(held.pixels).toEqual(blits[3].pixels);
      expect(held.args).toEqual([bounds.x, bounds.y, bounds.width, bounds.height, bounds.x, bounds.y, bounds.width, bounds.height]);
    }
    if (ditherEnabled) expect(sampleDomains).toEqual(Array.from({ length: 4 }, () => bounds));
    else {
      expect(lost.mock.calls.map(([, domain]) => domain)).toEqual(Array.from({ length: 4 }, () => inflateRect(bounds, 2)));
      for (const sample of lostSamples.slice(0, 3)) expect(sample).toEqual(lostSamples[3]);
    }
    const expectedRestore = noCap
      ? [bounds.x, bounds.y, bounds.width, bounds.height, bounds.x, bounds.y, bounds.width, bounds.height]
      : [0, 0, 64, 48, 0, 0, 64, 48];
    expect(restores.slice(0, 3)).toEqual(Array.from({ length: 3 }, () => expectedRestore));
  });
});
