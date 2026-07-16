import fs from 'node:fs';

import {
  applyDisplayFilterStack,
  buildFilmGrainFields,
  createFilmGrainPlateModel,
  createDisplayFilterPipelineState,
  createTileableNoiseGrid,
  ensureDisplayNoiseOverlay,
  ensureFilmGrainOverlays,
  getDirectOverlayDisplayFilter,
  getFilmGrainConnectionFieldStrength,
  getFilmGrainWrappedLobePositions,
  hasEnabledDisplayFiltersInList,
  getNoiseOnlyDisplayFilter,
  getNextFilterWorkCanvas,
  getSeamlessNoisePatternSize,
  rasterizeFilmGrainFields,
  type FilmGrainPlateModel,
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

describe('Direct-overlay display filter fast path', () => {
  const createNoiseFilter = (
    enabled = true,
    opacity = 0.2,
    scale = 2,
  ): Extract<DisplayFilterConfig, { id: 'noise' }> => ({
    id: 'noise',
    enabled,
    settings: { opacity, scale },
  });

  const createFilmNoiseFilter = (
    enabled = true,
    opacity = 0.16,
    scale = 1.5,
    shadowBias = 0.62,
  ): Extract<DisplayFilterConfig, { id: 'film-noise' }> => ({
    id: 'film-noise',
    enabled,
    settings: { opacity, scale, shadowBias },
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

  it('selects Film Noise as a direct overlay without accepting mixed stacks', () => {
    const filmNoise = createFilmNoiseFilter();
    const noise = createNoiseFilter();

    expect(getDirectOverlayDisplayFilter([filmNoise])).toEqual(filmNoise);
    expect(getDirectOverlayDisplayFilter([createFilmNoiseFilter(false)])).toBeNull();
    expect(getDirectOverlayDisplayFilter([createFilmNoiseFilter(true, 0)])).toBeNull();
    expect(getDirectOverlayDisplayFilter([filmNoise, noise])).toBeNull();
  });

  it('preserves the legacy Noise-only mode while exposing direct overlays separately', () => {
    const filmNoise = createFilmNoiseFilter();
    const noise = createNoiseFilter();

    expect(hasEnabledDisplayFiltersInList([noise], 'noise-only')).toBe(true);
    expect(hasEnabledDisplayFiltersInList([filmNoise], 'noise-only')).toBe(false);
    expect(hasEnabledDisplayFiltersInList([filmNoise], 'direct-overlay-only')).toBe(true);
  });

  it('builds deterministic organic grain families with varied lobe geometry', () => {
    const options = { plateSize: 244, grainSize: 4, seed: 42 };
    const model = createFilmGrainPlateModel(options);
    const repeatedModel = createFilmGrainPlateModel(options);
    const families = new Set(model.clusters.map((cluster) => cluster.family));
    const lobes = model.clusters.flatMap((cluster) => cluster.lobes);
    const aspectRatios = new Set(lobes.map((lobe) => (lobe.radiusX / lobe.radiusY).toFixed(2)));
    const rotations = new Set(lobes.map((lobe) => lobe.rotation.toFixed(2)));
    const equivalentRadii = lobes.map((lobe) => Math.sqrt(lobe.radiusX * lobe.radiusY));
    const connectedClusters = model.clusters.filter((cluster) => cluster.family !== 'single');
    const connectedPairs = connectedClusters.flatMap((cluster) => (
      cluster.lobes.slice(1).map((lobe) => ({
        lobe,
        parent: cluster.lobes[
          typeof lobe.parentIndex === 'number' ? lobe.parentIndex : 0
        ],
      }))
    ));
    const overlappingPairs = connectedPairs.filter(({ lobe, parent }) => {
      const rawDeltaX = Math.abs(lobe.x - parent.x);
      const rawDeltaY = Math.abs(lobe.y - parent.y);
      const deltaX = Math.min(rawDeltaX, options.plateSize - rawDeltaX);
      const deltaY = Math.min(rawDeltaY, options.plateSize - rawDeltaY);
      const distance = Math.hypot(deltaX, deltaY);
      const combinedRadius = Math.sqrt(lobe.radiusX * lobe.radiusY)
        + Math.sqrt(parent.radiusX * parent.radiusY);
      return distance < combinedRadius;
    });
    const extendedClusters = connectedClusters.filter((cluster) => {
      const xs = cluster.lobes.map((lobe) => lobe.x);
      const ys = cluster.lobes.map((lobe) => lobe.y);
      return Math.max(
        Math.max(...xs) - Math.min(...xs),
        Math.max(...ys) - Math.min(...ys),
      ) > options.grainSize * 3;
    });

    expect(repeatedModel).toEqual(model);
    expect(families).toEqual(new Set(['single', 'chain', 'island']));
    expect(model.clusters
      .filter((cluster) => cluster.family === 'single')
      .every((cluster) => cluster.lobes.length === 1)).toBe(true);
    expect(model.clusters
      .filter((cluster) => cluster.family === 'chain')
      .every((cluster) => cluster.lobes.length >= 4 && cluster.lobes.length <= 9)).toBe(true);
    expect(model.clusters
      .filter((cluster) => cluster.family === 'island')
      .every((cluster) => cluster.lobes.length >= 8 && cluster.lobes.length <= 16)).toBe(true);
    expect(model.clusters.filter((cluster) => cluster.family === 'single').length)
      .toBeGreaterThan(model.clusters.length * 0.28);
    expect(model.clusters.filter((cluster) => cluster.family === 'chain').length)
      .toBeGreaterThan(model.clusters.length * 0.38);
    expect(model.clusters.filter((cluster) => cluster.family === 'island').length)
      .toBeGreaterThan(model.clusters.length * 0.28);
    const darkClusterFraction = model.clusters
      .filter((cluster) => cluster.polarity === 'dark').length / model.clusters.length;
    expect(darkClusterFraction).toBeGreaterThanOrEqual(0.49);
    expect(darkClusterFraction).toBeLessThanOrEqual(0.51);
    expect(lobes.length / model.clusters.length).toBeGreaterThan(6);
    expect(Math.max(...equivalentRadii) / Math.min(...equivalentRadii)).toBeGreaterThan(4);
    expect(equivalentRadii.some((radius) => radius < options.grainSize * 0.7)).toBe(true);
    expect(equivalentRadii.some((radius) => radius > options.grainSize * 1.7)).toBe(true);
    expect(overlappingPairs.length).toBeGreaterThan(connectedPairs.length * 0.8);
    expect(extendedClusters.length).toBeGreaterThan(connectedClusters.length * 0.5);
    expect(model.clusters
      .filter((cluster) => cluster.family === 'single')
      .every((cluster) => cluster.lobes[0].parentIndex === null)).toBe(true);
    expect(connectedClusters.every((cluster) => (
      cluster.lobes[0].parentIndex === null
      && cluster.lobes.slice(1).every((lobe) => Number.isInteger(lobe.parentIndex))
    ))).toBe(true);
    expect(model.clusters
      .filter((cluster) => cluster.family === 'island')
      .some((cluster) => cluster.lobes.some((lobe, index) => (
        index > 1 && lobe.parentIndex !== index - 1
      )))).toBe(true);
    expect(aspectRatios.size).toBeGreaterThan(10);
    expect(rotations.size).toBeGreaterThan(10);
  });

  it('wraps lobes crossing plate edges without moving interior lobes', () => {
    const edgeLobe = {
      x: 0.5,
      y: 64,
      radiusX: 2,
      radiusY: 1,
      rotation: 0,
      strength: 1,
      parentIndex: null,
    };
    const interiorLobe = { ...edgeLobe, x: 64 };

    expect(getFilmGrainWrappedLobePositions(edgeLobe, 128)).toEqual([
      { x: 0.5, y: 64 },
      { x: 128.5, y: 64 },
    ]);
    expect(getFilmGrainWrappedLobePositions(interiorLobe, 128)).toEqual([
      { x: 64, y: 64 },
    ]);
  });

  it('builds deterministic grain fields and an accepted alpha raster', () => {
    const options = { plateSize: 64, grainSize: 2, seed: 42 };
    const model = createFilmGrainPlateModel(options);
    const fields = buildFilmGrainFields(model);
    const repeatedFields = buildFilmGrainFields(createFilmGrainPlateModel(options));
    const raster = rasterizeFilmGrainFields({ ...fields, plateSize: 64, seed: 42 });
    const repeatedRaster = rasterizeFilmGrainFields({
      ...repeatedFields,
      plateSize: 64,
      seed: 42,
    });
    let checksum = 2166136261;

    for (const alpha of [raster.darkAlpha, raster.lightAlpha]) {
      for (const value of alpha) {
        checksum = Math.imul((checksum ^ value) >>> 0, 16777619) >>> 0;
      }
    }

    expect(repeatedFields.darkField).toEqual(fields.darkField);
    expect(repeatedFields.lightField).toEqual(fields.lightField);
    expect(repeatedRaster.darkAlpha).toEqual(raster.darkAlpha);
    expect(repeatedRaster.lightAlpha).toEqual(raster.lightAlpha);
    expect(checksum).toBe(764250713);
  });

  it('merges overlapping lobes through a broad field waist instead of a bead cusp', () => {
    const createLobe = (x: number, parentIndex: number | null) => ({
      x,
      y: 24,
      radiusX: 6,
      radiusY: 6,
      rotation: 0,
      strength: 1,
      parentIndex,
    });
    const model: FilmGrainPlateModel = {
      version: 11,
      plateSize: 48,
      grainSize: 6,
      clusters: [{
        family: 'chain',
        polarity: 'dark',
        lobes: [createLobe(18, null), createLobe(30, 0)],
      }],
    };
    const fields = buildFilmGrainFields(model);
    const raster = rasterizeFilmGrainFields({
      ...fields,
      plateSize: model.plateSize,
      seed: 42,
      thresholdVariation: 0,
      jitterStrength: 0,
    });
    const getOccupiedWidth = (x: number) => {
      let width = 0;
      for (let y = 0; y < model.plateSize; y += 1) {
        if (raster.darkAlpha[y * model.plateSize + x] >= 128) {
          width += 1;
        }
      }
      return width;
    };
    const leftWidth = getOccupiedWidth(18);
    const neckWidth = getOccupiedWidth(24);
    const rightWidth = getOccupiedWidth(30);

    for (let x = 18; x <= 30; x += 1) {
      expect(raster.darkAlpha[24 * model.plateSize + x]).toBeGreaterThanOrEqual(128);
    }
    expect(neckWidth / Math.min(leftWidth, rightWidth)).toBeGreaterThanOrEqual(0.65);
  });

  it('keeps every generated parent-child connection above the field threshold', () => {
    for (const grainSize of [1, 1.5, 2.65, 8]) {
      const model = createFilmGrainPlateModel({
        plateSize: 768,
        grainSize,
        seed: 0x6d2b79f5,
      });
      let minimumConnectionStrength = Number.POSITIVE_INFINITY;
      let hasMissingParent = false;
      for (const cluster of model.clusters) {
        for (const lobe of cluster.lobes.slice(1)) {
          const parent = cluster.lobes[lobe.parentIndex ?? -1];
          if (!parent) {
            hasMissingParent = true;
            continue;
          }
          minimumConnectionStrength = Math.min(
            minimumConnectionStrength,
            getFilmGrainConnectionFieldStrength(parent, lobe, model.plateSize),
          );
        }
      }
      expect(hasMissingParent).toBe(false);
      expect(minimumConnectionStrength).toBeGreaterThan(0.42);
    }
  });

  it('wraps boundary splats symmetrically in the accumulated field', () => {
    const model: FilmGrainPlateModel = {
      version: 11,
      plateSize: 32,
      grainSize: 4,
      clusters: [{
        family: 'single',
        polarity: 'dark',
        lobes: [{
          x: 0,
          y: 16,
          radiusX: 4,
          radiusY: 3,
          rotation: 0,
          strength: 1,
          parentIndex: null,
        }],
      }],
    };
    const { darkField } = buildFilmGrainFields(model);

    for (let y = 12; y <= 19; y += 1) {
      expect(darkField[y * model.plateSize])
        .toBeCloseTo(darkField[y * model.plateSize + model.plateSize - 1], 6);
    }
  });

  it('keeps balanced plate coverage calibrated across the Grain Size range', () => {
    for (const grainSize of [1, 1.5, 2.65, 8]) {
      const model = createFilmGrainPlateModel({
        plateSize: 768,
        grainSize,
        seed: 0x6d2b79f5,
      });
      const fields = buildFilmGrainFields(model);
      const { darkAlpha, lightAlpha } = rasterizeFilmGrainFields({
        ...fields,
        plateSize: model.plateSize,
        seed: 0x6d2b79f5,
      });
      const darkOccupiedPixels = darkAlpha.reduce(
        (count, alpha) => count + (alpha >= 128 ? 1 : 0),
        0,
      );
      const lightOccupiedPixels = lightAlpha.reduce(
        (count, alpha) => count + (alpha >= 128 ? 1 : 0),
        0,
      );
      const darkCoverage = darkOccupiedPixels / darkAlpha.length;
      const lightCoverage = lightOccupiedPixels / lightAlpha.length;
      const combinedCoverage = darkCoverage + lightCoverage;

      expect(darkCoverage).toBeGreaterThanOrEqual(0.06);
      expect(darkCoverage).toBeLessThanOrEqual(0.12);
      expect(lightCoverage).toBeGreaterThanOrEqual(0.06);
      expect(lightCoverage).toBeLessThanOrEqual(0.12);
      expect(combinedCoverage).toBeGreaterThanOrEqual(0.14);
      expect(combinedCoverage).toBeLessThanOrEqual(0.22);
    }
  });

  it('keeps minimum-size grains densely packed instead of hitting a sparse cap', () => {
    const minimumSizeModel = createFilmGrainPlateModel({
      plateSize: 768,
      grainSize: 1,
      seed: 42,
    });
    const defaultSizeModel = createFilmGrainPlateModel({
      plateSize: 768,
      grainSize: 1.5,
      seed: 42,
    });

    expect(minimumSizeModel.clusters.length)
      .toBeGreaterThan(defaultSizeModel.clusters.length * 2);
    expect(minimumSizeModel.clusters.length).toBeLessThanOrEqual(10000);
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
      directOverlayTarget: {
        ctx: targetCtx as CanvasRenderingContext2D,
        rect: { x: 2, y: 3, width: 20, height: 12 },
      },
    });

    expect(filterState.filterSurfaceCanvas).toBeNull();
    expect(filterState.workCanvasA).toBeNull();
    expect(filterState.workCanvasB).toBeNull();
    expect(drawImageSpy).toHaveBeenCalledTimes(1);
  });

  it('applies Film Noise without frame readback or intermediate surfaces', () => {
    const sourceCanvas = document.createElement('canvas');
    sourceCanvas.width = 32;
    sourceCanvas.height = 24;
    const targetCtx = sourceCanvas.getContext('2d');
    const filterState = createDisplayFilterPipelineState();
    expect(targetCtx).not.toBeNull();
    const composites: Array<{ alpha: number; operation: GlobalCompositeOperation }> = [];
    const drawImageSpy = jest
      .spyOn(targetCtx as CanvasRenderingContext2D, 'drawImage')
      .mockImplementation(() => {
        composites.push({
          alpha: (targetCtx as CanvasRenderingContext2D).globalAlpha,
          operation: (targetCtx as CanvasRenderingContext2D).globalCompositeOperation,
        });
      });
    const getImageDataSpy = jest.spyOn(targetCtx as CanvasRenderingContext2D, 'getImageData');
    const putImageDataSpy = jest.spyOn(targetCtx as CanvasRenderingContext2D, 'putImageData');

    applyDisplayFilterStack({
      sourceCanvas,
      displayFilters: [createFilmNoiseFilter()],
      filterState,
      directOverlayTarget: {
        ctx: targetCtx as CanvasRenderingContext2D,
        rect: { x: 2, y: 3, width: 20, height: 12 },
      },
    });

    expect(filterState.filterSurfaceCanvas).toBeNull();
    expect(filterState.workCanvasA).toBeNull();
    expect(filterState.workCanvasB).toBeNull();
    expect(getImageDataSpy).not.toHaveBeenCalled();
    expect(putImageDataSpy).not.toHaveBeenCalled();
    expect(drawImageSpy).toHaveBeenCalledTimes(2);
    expect(composites.map(({ operation }) => operation)).toEqual(['multiply', 'screen']);
    const expectedStrength = 0.16 * 0.16 * (3 - 2 * 0.16);
    expect(Math.max(...composites.map(({ alpha }) => alpha))).toBeCloseTo(expectedStrength, 8);
    expect(composites[0].alpha * filterState.filmGrainDarkMeanAlpha)
      .toBeCloseTo(composites[1].alpha * filterState.filmGrainLightMeanAlpha, 8);

    drawImageSpy.mockRestore();
    const grayCanvas = document.createElement('canvas');
    grayCanvas.width = 768;
    grayCanvas.height = 768;
    const grayCtx = grayCanvas.getContext('2d') as CanvasRenderingContext2D;
    grayCtx.fillStyle = 'rgb(128, 128, 128)';
    grayCtx.fillRect(0, 0, grayCanvas.width, grayCanvas.height);

    applyDisplayFilterStack({
      sourceCanvas: grayCanvas,
      displayFilters: [createFilmNoiseFilter(true, 1)],
      filterState,
      directOverlayTarget: {
        ctx: grayCtx,
        rect: { x: 0, y: 0, width: grayCanvas.width, height: grayCanvas.height },
      },
    });

    const compositedPixels = grayCtx
      .getImageData(0, 0, grayCanvas.width, grayCanvas.height)
      .data;
    let channelSum = 0;
    for (let index = 0; index < compositedPixels.length; index += 4) {
      channelSum += compositedPixels[index];
    }
    const meanChannel = channelSum / (compositedPixels.length / 4);
    expect(Math.abs(meanChannel - 128)).toBeLessThanOrEqual(1);
  });

  it('reuses Film Noise morphology for amount and legacy setting changes', () => {
    const filterState = createDisplayFilterPipelineState();
    const initialArgs = {
      filmNoiseFilter: createFilmNoiseFilter(),
      filterState,
      width: 40,
      height: 30,
      originX: 7,
      originY: 9,
    };
    const initialOverlays = ensureFilmGrainOverlays(initialArgs);
    const initialPlateKey = filterState.filmGrainPlateKey;
    const initialOverlayKey = filterState.filmGrainOverlayKey;
    const initialDarkPlate = filterState.filmGrainDarkPlateCanvas;

    const reusedOverlays = ensureFilmGrainOverlays({
      ...initialArgs,
      filmNoiseFilter: createFilmNoiseFilter(true, 0.4, 1.5, 0.2),
    });
    expect(reusedOverlays?.darkCanvas).toBe(initialOverlays?.darkCanvas);
    expect(reusedOverlays?.lightCanvas).toBe(initialOverlays?.lightCanvas);
    expect(filterState.filmGrainPlateKey).toBe(initialPlateKey);
    expect(filterState.filmGrainOverlayKey).toBe(initialOverlayKey);
    expect(filterState.filmGrainDarkPlateCanvas).toBe(initialDarkPlate);

    const pipelineSource = fs.readFileSync(
      `${process.cwd()}/src/lib/displayFilterPipeline.js`,
      'utf8',
    );
    expect(pipelineSource).not.toContain('filmNoiseFilter.settings.shadowBias');

    ensureFilmGrainOverlays({ ...initialArgs, originX: 8 });
    expect(filterState.filmGrainPlateKey).toBe(initialPlateKey);
    expect(filterState.filmGrainOverlayKey).not.toBe(initialOverlayKey);

    ensureFilmGrainOverlays({
      ...initialArgs,
      filmNoiseFilter: createFilmNoiseFilter(true, 0.16, 2.25, 0.62),
    });
    expect(filterState.filmGrainPlateKey).not.toBe(initialPlateKey);
  });

  it('uses perceptually even small-grain scaling without changing the range endpoints', () => {
    const createPatternSpy = jest
      .spyOn(CanvasRenderingContext2D.prototype, 'createPattern')
      .mockReturnValue({} as CanvasPattern);
    const scaleSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'scale');
    const translateSpy = jest.spyOn(CanvasRenderingContext2D.prototype, 'translate');

    try {
      ensureFilmGrainOverlays({
        filmNoiseFilter: createFilmNoiseFilter(true, 0.16, 1),
        filterState: createDisplayFilterPipelineState(),
        width: 40,
        height: 30,
        originX: 400,
        originY: 100,
      });

      const minimumScaleCalls = scaleSpy.mock.calls.slice(-2);
      expect(minimumScaleCalls).toEqual([[0.2, 0.2], [0.2, 0.2]]);
      const minimumTranslateCalls = translateSpy.mock.calls.slice(-2);
      expect(minimumTranslateCalls[0][0]).toBeCloseTo(-92.8);
      expect(minimumTranslateCalls[0][1]).toBeCloseTo(-100);
      expect(minimumTranslateCalls[1][0]).toBeCloseTo(-92.8);
      expect(minimumTranslateCalls[1][1]).toBeCloseTo(-100);

      ensureFilmGrainOverlays({
        filmNoiseFilter: createFilmNoiseFilter(true, 0.16, 1.25),
        filterState: createDisplayFilterPipelineState(),
        width: 40,
        height: 30,
      });

      const midpointScale = Math.sqrt(0.2);
      expect(scaleSpy.mock.calls.slice(-2)).toEqual([
        [midpointScale, midpointScale],
        [midpointScale, midpointScale],
      ]);

      ensureFilmGrainOverlays({
        filmNoiseFilter: createFilmNoiseFilter(true, 0.16, 1.5),
        filterState: createDisplayFilterPipelineState(),
        width: 40,
        height: 30,
      });

      expect(scaleSpy.mock.calls.slice(-2)).toEqual([[1, 1], [1, 1]]);
    } finally {
      createPatternSpy.mockRestore();
      scaleSpy.mockRestore();
      translateSpy.mockRestore();
    }
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

  it('keeps the direct compositor background-first before applying overlays', () => {
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
