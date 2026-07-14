import fs from 'node:fs';

import {
  applyDisplayFilterStack,
  createDisplayFilterPipelineState,
  createTileableNoiseGrid,
  ensureDisplayNoiseOverlay,
  getNoiseOnlyDisplayFilter,
  getNextFilterWorkCanvas,
  getSeamlessNoisePatternSize,
} from '@/lib/displayFilterPipeline';
import type { DisplayFilterConfig } from '@/types';
import {
  fillCanvasFrameBackdrop,
  shouldRequestCompositeBitmapRecomposition,
} from '@/components/canvas/useDrawingCanvasBaseRenderer';

describe('fillCanvasFrameBackdrop', () => {
  it('fills the full render canvas with the selected frame color', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;
    const ctx = canvas.getContext('2d');
    expect(ctx).not.toBeNull();

    fillCanvasFrameBackdrop(ctx as CanvasRenderingContext2D, canvas.width, canvas.height, '#224466');

    const pixel = (ctx as CanvasRenderingContext2D).getImageData(3, 2, 1, 1).data;
    expect(Array.from(pixel)).toEqual([34, 68, 102, 255]);
  });
});

describe('shouldRequestCompositeBitmapRecomposition', () => {
  it('only requests recomposition for the first invalid bitmap still owned by the store', () => {
    const bitmap = {} as ImageBitmap;
    const previous = {} as ImageBitmap;

    expect(shouldRequestCompositeBitmapRecomposition(bitmap, null, bitmap)).toBe(true);
    expect(shouldRequestCompositeBitmapRecomposition(bitmap, bitmap, bitmap)).toBe(false);
    expect(shouldRequestCompositeBitmapRecomposition(bitmap, null, previous)).toBe(false);
    expect(shouldRequestCompositeBitmapRecomposition(null, null, null)).toBe(false);
  });
});

describe('getNextFilterWorkCanvas', () => {
  it('alternates away from the canvas that just became current', () => {
    const sourceCanvas = document.createElement('canvas');
    const workCanvasA = document.createElement('canvas');
    const workCanvasB = document.createElement('canvas');

    expect(getNextFilterWorkCanvas(workCanvasA, workCanvasA, workCanvasB)).toBe(workCanvasB);
    expect(getNextFilterWorkCanvas(workCanvasB, workCanvasA, workCanvasB)).toBe(workCanvasA);

    // The first pass starts from the source canvas and writes into work A.
    // The second pass must target work B, not clear work A in place.
    let currentCanvas = sourceCanvas;
    currentCanvas = workCanvasA;
    const nextCanvas = getNextFilterWorkCanvas(currentCanvas, workCanvasA, workCanvasB);
    expect(nextCanvas).toBe(workCanvasB);
  });
});

describe('getSeamlessNoisePatternSize', () => {
  it('always returns a pattern size that tiles cleanly for the requested noise step', () => {
    expect(getSeamlessNoisePatternSize(3) % 3).toBe(0);
    expect(getSeamlessNoisePatternSize(7) % 7).toBe(0);
    expect(getSeamlessNoisePatternSize(19) % 19).toBe(0);
  });

  it('keeps the pattern at a practical size while staying aligned to the tile step', () => {
    expect(getSeamlessNoisePatternSize(1)).toBe(128);
    expect(getSeamlessNoisePatternSize(8)).toBe(256);
    expect(getSeamlessNoisePatternSize(32)).toBe(256);
  });
});

describe('createTileableNoiseGrid', () => {
  it('wraps opposite edges so repeated noise tiles do not show a boundary seam', () => {
    const grid = createTileableNoiseGrid(6, 5, 3);

    for (let y = 0; y < grid.length; y += 1) {
      expect(grid[y][grid[y].length - 1]).toBe(grid[y][0]);
    }

    for (let x = 0; x < grid[0].length; x += 1) {
      expect(grid[grid.length - 1][x]).toBe(grid[0][x]);
    }
  });
});

describe('Noise-only display filter fast path', () => {
  const createNoiseFilter = (
    enabled = true,
    opacity = 0.2,
    scale = 2,
  ): Extract<DisplayFilterConfig, { id: 'noise' }> => ({
    id: 'noise',
    enabled,
    settings: { opacity, scale },
  });

  it('selects only an enabled Noise filter with a non-zero effect', () => {
    expect(getNoiseOnlyDisplayFilter([createNoiseFilter()])).toEqual(createNoiseFilter());
    expect(getNoiseOnlyDisplayFilter([createNoiseFilter(false)])).toBeNull();
    expect(getNoiseOnlyDisplayFilter([createNoiseFilter(true, 0)])).toBeNull();
  });

  it('rejects enabled non-Noise filters and mixed stacks', () => {
    const bloom: Extract<DisplayFilterConfig, { id: 'bloom' }> = {
      id: 'bloom',
      enabled: true,
      settings: { blurRadius: 4, intensity: 0.5 },
    };

    expect(getNoiseOnlyDisplayFilter([bloom])).toBeNull();
    expect(getNoiseOnlyDisplayFilter([createNoiseFilter(), bloom])).toBeNull();
    expect(getNoiseOnlyDisplayFilter([
      createNoiseFilter(),
      { ...bloom, enabled: false },
    ])).not.toBeNull();
  });

  it('applies Noise directly without allocating filter or ping-pong surfaces', () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 32;
    sourceCanvas.height = 24;
    const targetCtx = sourceCanvas.getContext('2d');
    const filterState = createDisplayFilterPipelineState();
    expect(targetCtx).not.toBeNull();
    const drawImageSpy = jest.spyOn(targetCtx as CanvasRenderingContext2D, 'drawImage');

    applyDisplayFilterStack({
      sourceCanvas,
      displayFilters: [createNoiseFilter()],
      filterState,
      noiseOnlyTarget: {
        ctx: targetCtx as CanvasRenderingContext2D,
        rect: { x: 2, y: 3, width: 20, height: 12 },
      },
    });

    expect(filterState.filterSurfaceCanvas).toBeNull();
    expect(filterState.workCanvasA).toBeNull();
    expect(filterState.workCanvasB).toBeNull();
    expect(drawImageSpy).toHaveBeenCalledTimes(1);
  });

  it('reuses the overlay until scale, target size, or document phase changes', () => {
    const filterState = createDisplayFilterPipelineState();
    const initialArgs = {
      noiseFilter: createNoiseFilter(),
      filterState,
      width: 40,
      height: 30,
      originX: 7,
      originY: 9,
    };
    const overlayCanvas = ensureDisplayNoiseOverlay(initialArgs);
    const overlayCtx = overlayCanvas?.getContext('2d');
    expect(overlayCanvas).not.toBeNull();
    expect(overlayCtx).not.toBeNull();
    const clearRectSpy = jest.spyOn(overlayCtx as CanvasRenderingContext2D, 'clearRect');
    const initialKey = filterState.noiseOverlayKey;

    expect(ensureDisplayNoiseOverlay(initialArgs)).toBe(overlayCanvas);
    expect(filterState.noiseOverlayKey).toBe(initialKey);
    expect(clearRectSpy).not.toHaveBeenCalled();

    ensureDisplayNoiseOverlay({ ...initialArgs, noiseFilter: createNoiseFilter(true, 0.2, 3) });
    const scaleKey = filterState.noiseOverlayKey;
    expect(scaleKey).not.toBe(initialKey);

    ensureDisplayNoiseOverlay({ ...initialArgs, width: 41 });
    const sizeKey = filterState.noiseOverlayKey;
    expect(sizeKey).not.toBe(scaleKey);

    ensureDisplayNoiseOverlay({ ...initialArgs, originX: 8 });
    expect(filterState.noiseOverlayKey).not.toBe(sizeKey);
    expect(clearRectSpy).toHaveBeenCalledTimes(3);
  });

  it('fills the cached overlay with the expected document-space phase', () => {
    const createPatternSpy = jest
      .spyOn(CanvasRenderingContext2D.prototype, 'createPattern')
      .mockReturnValue({} as CanvasPattern);
    const fillRectSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'fillRect');
    const translateSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'translate');
    const getContextSpy = jest.spyOn(HTMLCanvasElement.prototype, 'getContext');

    try {
      const filterState = createDisplayFilterPipelineState();
      const overlayCanvas = ensureDisplayNoiseOverlay({
        noiseFilter: createNoiseFilter(),
        filterState,
        width: 40,
        height: 30,
        originX: 7,
        originY: 9,
      });
      const patternCanvas = filterState.noisePatternCanvas;

      expect(overlayCanvas).not.toBeNull();
      expect(patternCanvas).not.toBeNull();
      expect(createPatternSpy).toHaveBeenCalledWith(patternCanvas, 'repeat');
      expect(translateSpy).toHaveBeenLastCalledWith(-7, -9);
      expect(fillRectSpy).toHaveBeenLastCalledWith(
        0,
        0,
        (overlayCanvas?.width ?? 0) + (patternCanvas?.width ?? 0),
        (overlayCanvas?.height ?? 0) + (patternCanvas?.height ?? 0),
      );
      expect(getContextSpy.mock.calls.every((call) => call.length === 1)).toBe(true);
    } finally {
      createPatternSpy.mockRestore();
      fillRectSpy.mockRestore();
      translateSpy.mockRestore();
      getContextSpy.mockRestore();
    }
  });

  it('keeps the direct compositor background-first before applying Noise', () => {
    const rendererSource = fs.readFileSync(
      'src/components/canvas/useDrawingCanvasBaseRenderer.ts',
      'utf8',
    );
    const backgroundAt = rendererSource.indexOf(
      'renderCanvasBackground(canvasBackgroundOptions);',
    );
    const compositeAt = rendererSource.indexOf('drawVisibleCompositeStack({', backgroundAt);
    const noiseAt = rendererSource.indexOf('ctx.canvas,', compositeAt);
    const overlaysAt = rendererSource.indexOf('drawCanvasOverlayLayer({', noiseAt);

    expect(backgroundAt).toBeGreaterThan(-1);
    expect(compositeAt).toBeGreaterThan(backgroundAt);
    expect(noiseAt).toBeGreaterThan(compositeAt);
    expect(overlaysAt).toBeGreaterThan(noiseAt);
    expect(rendererSource).not.toContain("ctx.globalCompositeOperation = 'destination-over';");
  });
});
