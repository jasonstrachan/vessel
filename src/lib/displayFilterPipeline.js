const getNumeric = (value, fallback = 0) => (
  Number.isFinite(value) ? Number(value) : fallback
);

export const getSeamlessNoisePatternSize = (tileStep) => {
  const normalizedTileStep = Math.max(1, Math.round(getNumeric(tileStep, 1)));
  const targetPixels = 256;
  const cellsPerAxis = Math.max(8, Math.min(128, Math.round(targetPixels / normalizedTileStep)));
  return normalizedTileStep * cellsPerAxis;
};

export const resolveDisplayNoiseTileStep = (scale) => (
  Math.max(1, Math.round(getNumeric(scale, 1)))
);

export const resolveFilmNoiseSampleStep = (tileStep) => (
  Math.max(1, Math.min(4, resolveDisplayNoiseTileStep(tileStep)))
);

const FILM_GRAIN_MODEL_VERSION = 12;
const FILM_GRAIN_PLATE_SIZE = 768;
const FILM_GRAIN_MIN_CLUSTERS = 24;
const FILM_GRAIN_MAX_CLUSTERS = 18000;
const FILM_GRAIN_SEED = 0x6d2b79f5;
const FILM_GRAIN_FIELD_SUPPORT_SCALE = 1.6;
const FILM_GRAIN_FIELD_THRESHOLD = 0.42;
const FILM_GRAIN_FIELD_THRESHOLD_VARIATION = 0.035;
const FILM_GRAIN_FIELD_JITTER = 0.045;
const FILM_GRAIN_FIELD_FEATHER = 0.07;
const FILM_GRAIN_DENSITY_LATTICE_CELLS = 8;
const FILM_GRAIN_MIN_DISPLAY_SCALE = 0.2;
const FILM_GRAIN_DEFAULT_SIZE = 1.5;
const CRT_REFERENCE_SIGNAL_WIDTH = 320;
const CRT_REFERENCE_CELL_SIZE = 12;
const CRT_BLOOM_DOWNSAMPLE = 4;
const CRT_STATIC_SIGNAL_SEED = 41.73;
const TWO_PI = Math.PI * 2;

export const resolveDisplayFilterPixelSize = (value, fallback = 1, minimum = 1) => (
  Math.max(minimum, Math.round(getNumeric(value, fallback)))
);

export const resolveDisplayFilterRadius = (value, fallback = 0, minimum = 0) => (
  Math.max(minimum, getNumeric(value, fallback))
);

export const resolveDownsampledDisplayFilterRadius = (
  value,
  fallback = 0,
  downsampleFactor = 1,
  minimum = 0,
) => {
  const normalizedDownsampleFactor = Math.max(1, getNumeric(downsampleFactor, 1));
  return Math.max(minimum, getNumeric(value, fallback) / normalizedDownsampleFactor);
};

export const resolveCrtSignalSize = (width, height, cellSize = CRT_REFERENCE_CELL_SIZE) => {
  const safeWidth = Math.max(1, Math.floor(getNumeric(width, 1)));
  const safeHeight = Math.max(1, Math.floor(getNumeric(height, 1)));
  const resolvedCellSize = resolveDisplayFilterPixelSize(
    cellSize,
    CRT_REFERENCE_CELL_SIZE,
  );
  const signalWidth = Math.max(1, Math.min(
    safeWidth,
    Math.round(CRT_REFERENCE_SIGNAL_WIDTH * CRT_REFERENCE_CELL_SIZE / resolvedCellSize),
  ));
  const signalHeight = Math.max(1, Math.round(signalWidth * safeHeight / safeWidth));
  return { width: signalWidth, height: signalHeight };
};

const hashNoise = (x, y, seed) => {
  const value = Math.sin((x + 1) * 127.1 + (y + 1) * 311.7 + seed * 17.13) * 43758.5453123;
  return value - Math.floor(value);
};

const hashFilmGrainCoordinate = (x, y, seed) => {
  let value = (
    Math.imul((Math.floor(x) ^ Math.floor(seed)) | 0, 0x45d9f3b)
    ^ Math.imul((Math.floor(y) + Math.floor(seed)) | 0, 0x27d4eb2d)
  ) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d) >>> 0;
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b) >>> 0;
  return ((value ^ (value >>> 16)) >>> 0) / 4294967296;
};

export const createTileableNoiseGrid = (columns, rows, seed = 0) => {
  const safeColumns = Math.max(1, Math.floor(getNumeric(columns, 1)));
  const safeRows = Math.max(1, Math.floor(getNumeric(rows, 1)));
  const grid = Array.from({ length: safeRows }, () => Array(safeColumns).fill(0));

  for (let y = 0; y < safeRows; y += 1) {
    for (let x = 0; x < safeColumns; x += 1) {
      const wrappedX = x === safeColumns - 1 ? 0 : x;
      const wrappedY = y === safeRows - 1 ? 0 : y;
      grid[y][x] = Math.floor(hashNoise(wrappedX, wrappedY, seed) * 255);
    }
  }

  return grid;
};

export const createDisplayFilterPipelineState = () => ({
  filterSurfaceCanvas: null,
  adjustmentMixCanvas: null,
  workCanvasA: null,
  workCanvasB: null,
  auxCanvas: null,
  bloomCanvas: null,
  channelCanvas: null,
  pixelateCanvas: null,
  lcdPatternKey: '',
  lcdPatternCanvas: null,
  crtGridPatternKey: '',
  crtGridPatternCanvas: null,
  crtGridGlowCanvas: null,
  noisePatternKey: '',
  noisePatternCanvas: null,
  noiseOverlayKey: '',
  noiseOverlayCanvas: null,
  filmGrainPlateKey: '',
  filmGrainDarkPlateCanvas: null,
  filmGrainLightPlateCanvas: null,
  filmGrainDarkMeanAlpha: 0,
  filmGrainLightMeanAlpha: 0,
  filmGrainOverlayKey: '',
  filmGrainDarkOverlayCanvas: null,
  filmGrainLightOverlayCanvas: null,
  crtWebGLState: null,
  crtWebGLUnavailable: false,
  crtWebGLLastError: null,
  ntseCrtWebGLState: null,
  ntseCrtWebGLUnavailable: false,
  ntseCrtWebGLLastError: null,
});

export const getNextFilterWorkCanvas = (currentCanvas, workCanvasA, workCanvasB) => (
  currentCanvas === workCanvasA ? workCanvasB : workCanvasA
);

export const ensureDisplayFilterCanvas = (canvas, width, height) => {
  if (typeof document === 'undefined') {
    return null;
  }
  const nextWidth = Math.max(1, Math.ceil(width));
  const nextHeight = Math.max(1, Math.ceil(height));
  const target = canvas ?? document.createElement('canvas');
  if (target.width !== nextWidth) {
    target.width = nextWidth;
  }
  if (target.height !== nextHeight) {
    target.height = nextHeight;
  }
  return target;
};

export const clearDisplayFilterCanvas = (canvas) => {
  const ctx = canvas?.getContext('2d', { willReadFrequently: true });
  if (!ctx || !canvas) {
    return null;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
};

export const getDisplayFilterByIdFromList = (filters, id) => (
  Array.isArray(filters) ? filters.find((filter) => filter?.id === id) : undefined
);

export const hasEnabledDisplayFiltersInList = (filters, mode = 'any') => (
  mode === 'noise-only'
    ? Boolean(getNoiseOnlyDisplayFilter(filters))
    : mode === 'direct-overlay-only'
      ? Boolean(getDirectOverlayDisplayFilter(filters))
      : Array.isArray(filters) && filters.some((filter) => filter?.enabled)
);

export const getNoiseOnlyDisplayFilter = (filters) => {
  if (!Array.isArray(filters)) {
    return null;
  }
  const noiseFilter = getDisplayFilterByIdFromList(filters, 'noise');
  if (
    !noiseFilter?.enabled ||
    getNumeric(noiseFilter?.settings?.opacity, 0) <= 0 ||
    filters.some((filter) => filter?.enabled && filter?.id !== 'noise')
  ) {
    return null;
  }
  return noiseFilter;
};

export const getDirectOverlayDisplayFilter = (filters) => {
  if (!Array.isArray(filters)) {
    return null;
  }
  const enabledFilters = filters.filter((filter) => filter?.enabled);
  if (enabledFilters.length !== 1) {
    return null;
  }
  const [filter] = enabledFilters;
  if (
    (filter.id !== 'noise' && filter.id !== 'film-noise')
    || getNumeric(filter?.settings?.opacity, 0) <= 0
  ) {
    return null;
  }
  return filter;
};

const clearDisplayNoiseCanvas = (canvas) => {
  const ctx = canvas?.getContext('2d');
  if (!ctx || !canvas) {
    return null;
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.filter = 'none';
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  return ctx;
};

const ensureDisplayNoisePattern = (noiseFilter, filterState) => {
  const tileStep = resolveDisplayNoiseTileStep(noiseFilter?.settings?.scale);
  const patternKey = JSON.stringify({ tileStep });
  if (filterState.noisePatternKey === patternKey && filterState.noisePatternCanvas) {
    return filterState.noisePatternCanvas;
  }

  const patternSize = getSeamlessNoisePatternSize(tileStep);
  const patternCanvas = ensureDisplayFilterCanvas(
    filterState.noisePatternCanvas,
    patternSize,
    patternSize,
  );
  const patternCtx = clearDisplayNoiseCanvas(patternCanvas);
  if (patternCanvas && patternCtx) {
    const columns = Math.max(1, Math.round(patternCanvas.width / tileStep));
    const rows = Math.max(1, Math.round(patternCanvas.height / tileStep));
    const tones = createTileableNoiseGrid(columns, rows, tileStep);
    for (let y = 0; y < rows; y += 1) {
      for (let x = 0; x < columns; x += 1) {
        const tone = tones[y][x];
        patternCtx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
        patternCtx.fillRect(x * tileStep, y * tileStep, tileStep, tileStep);
      }
    }
  }

  filterState.noisePatternKey = patternKey;
  filterState.noisePatternCanvas = patternCanvas;
  return patternCanvas;
};

export const ensureDisplayNoiseOverlay = ({
  noiseFilter,
  filterState,
  width,
  height,
  originX = 0,
  originY = 0,
}) => {
  const patternCanvas = ensureDisplayNoisePattern(noiseFilter, filterState);
  if (!patternCanvas) {
    return null;
  }

  const targetWidth = Math.max(1, Math.ceil(width));
  const targetHeight = Math.max(1, Math.ceil(height));
  const phaseX = positiveMod(originX, patternCanvas.width);
  const phaseY = positiveMod(originY, patternCanvas.height);
  const overlayKey = JSON.stringify({
    patternKey: filterState.noisePatternKey,
    width: targetWidth,
    height: targetHeight,
    phaseX,
    phaseY,
  });
  if (filterState.noiseOverlayKey === overlayKey && filterState.noiseOverlayCanvas) {
    return filterState.noiseOverlayCanvas;
  }

  const overlayCanvas = ensureDisplayFilterCanvas(
    filterState.noiseOverlayCanvas,
    targetWidth,
    targetHeight,
  );
  const overlayCtx = clearDisplayNoiseCanvas(overlayCanvas);
  const pattern = overlayCtx?.createPattern(patternCanvas, 'repeat') ?? null;
  if (overlayCanvas && overlayCtx && pattern) {
    overlayCtx.save();
    overlayCtx.translate(-phaseX, -phaseY);
    overlayCtx.fillStyle = pattern;
    overlayCtx.fillRect(
      0,
      0,
      overlayCanvas.width + patternCanvas.width,
      overlayCanvas.height + patternCanvas.height,
    );
    overlayCtx.restore();
  }

  filterState.noiseOverlayKey = overlayKey;
  filterState.noiseOverlayCanvas = overlayCanvas;
  return overlayCanvas;
};

export const applyDisplayNoiseOverlay = ({
  targetCtx,
  noiseFilter,
  filterState,
  targetRect,
  documentOrigin = targetRect,
}) => {
  if (!targetCtx || !noiseFilter?.enabled || getNumeric(noiseFilter?.settings?.opacity, 0) <= 0) {
    return false;
  }

  const overlayCanvas = ensureDisplayNoiseOverlay({
    noiseFilter,
    filterState,
    width: targetRect.width,
    height: targetRect.height,
    originX: documentOrigin.x,
    originY: documentOrigin.y,
  });
  if (!overlayCanvas) {
    return false;
  }

  targetCtx.save();
  targetCtx.globalAlpha = getNumeric(noiseFilter.settings.opacity, 0);
  targetCtx.globalCompositeOperation = 'soft-light';
  targetCtx.drawImage(
    overlayCanvas,
    0,
    0,
    overlayCanvas.width,
    overlayCanvas.height,
    targetRect.x,
    targetRect.y,
    targetRect.width,
    targetRect.height,
  );
  targetCtx.restore();
  return true;
};

const buildColorGradeFilter = (filter) => {
  const brightness = 100 + getNumeric(filter?.settings?.brightness, 0) * 100;
  const contrast = 100 + getNumeric(filter?.settings?.contrast, 0) * 100;
  const saturation = getNumeric(filter?.settings?.saturation, 1) * 100;
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
};

const clamp01 = (value) => Math.min(1, Math.max(0, getNumeric(value, 0)));

const mix = (start, end, alpha) => start + (end - start) * clamp01(alpha);

const positiveMod = (value, divisor) => {
  const safeDivisor = Math.max(1e-6, getNumeric(divisor, 1));
  return ((value % safeDivisor) + safeDivisor) % safeDivisor;
};

const smoothstep = (edge0, edge1, value) => {
  const width = Math.max(1e-6, edge1 - edge0);
  const t = clamp01((value - edge0) / width);
  return t * t * (3 - 2 * t);
};

const resolveFilmGrainDisplayScale = (grainSize) => {
  const progress = clamp01(
    (getNumeric(grainSize, FILM_GRAIN_DEFAULT_SIZE) - 1) / (FILM_GRAIN_DEFAULT_SIZE - 1),
  );
  return FILM_GRAIN_MIN_DISPLAY_SCALE ** (1 - progress);
};

const createFilmGrainRandom = (seed) => {
  let state = Math.floor(getNumeric(seed, FILM_GRAIN_SEED)) >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
};

const resolveFilmGrainFamily = (clusterIndex) => {
  const familyIndex = clusterIndex % 20;
  if (familyIndex < 10) {
    return 'single';
  }
  if (familyIndex < 17) {
    return 'chain';
  }
  return 'island';
};

const resolveFilmGrainLobeCount = (family, random) => {
  if (family === 'single') {
    return 1;
  }
  if (family === 'chain') {
    return 3 + Math.floor(random() * 4);
  }
  return 6 + Math.floor(random() * 5);
};

export const createFilmGrainPlateModel = ({
  plateSize = FILM_GRAIN_PLATE_SIZE,
  grainSize = 1.5,
  seed = FILM_GRAIN_SEED,
} = {}) => {
  const resolvedPlateSize = Math.max(32, Math.round(getNumeric(plateSize, FILM_GRAIN_PLATE_SIZE)));
  const resolvedGrainSize = Math.max(0.75, Math.min(8, getNumeric(grainSize, 1.5)));
  const grainSeed = (
    Math.floor(getNumeric(seed, FILM_GRAIN_SEED))
    + Math.round(resolvedGrainSize * 1009)
    + resolvedPlateSize * 9176
  ) >>> 0;
  const random = createFilmGrainRandom(grainSeed);
  const clusterCount = Math.max(
    FILM_GRAIN_MIN_CLUSTERS,
    Math.min(
      FILM_GRAIN_MAX_CLUSTERS,
      Math.round((resolvedPlateSize * resolvedPlateSize) / (resolvedGrainSize ** 2 * 33)),
    ),
  );
  const colonyCount = Math.max(
    12,
    Math.round((resolvedPlateSize * resolvedPlateSize) / (resolvedGrainSize ** 2 * 3800)),
  );
  const colonies = Array.from({ length: colonyCount }, () => ({
    x: random() * resolvedPlateSize,
    y: random() * resolvedPlateSize,
    spread: resolvedGrainSize * mix(24, 52, random()),
  }));
  const clusters = [];

  for (let clusterIndex = 0; clusterIndex < clusterCount; clusterIndex += 1) {
    const family = resolveFilmGrainFamily(clusterIndex);
    const lobeCount = resolveFilmGrainLobeCount(family, random);
    const polarity = clusterIndex % 2 === 0 ? 'dark' : 'light';
    const lobes = [];
    const isColonyCluster = clusterIndex % 5 === 0;
    const colony = colonies[Math.floor(random() * colonies.length)];
    let x = random() * resolvedPlateSize;
    let y = random() * resolvedPlateSize;
    if (isColonyCluster && colony) {
      const offsetX = (random() + random() + random() - 1.5) * colony.spread;
      const offsetY = (random() + random() + random() - 1.5) * colony.spread;
      x = positiveMod(colony.x + offsetX, resolvedPlateSize);
      y = positiveMod(colony.y + offsetY, resolvedPlateSize);
    }
    const rootX = x;
    const rootY = y;
    let heading = random() * TWO_PI;
    const rootHeading = heading;
    let parentIndex = null;

    for (let lobeIndex = 0; lobeIndex < lobeCount; lobeIndex += 1) {
      const sizeVariation = random() ** 1.65;
      const familyRadius = family === 'single'
        ? mix(0.38, 1.55, sizeVariation)
        : family === 'chain'
          ? mix(0.55, 1.8, sizeVariation)
          : mix(0.65, 2.25, sizeVariation);
      const radius = resolvedGrainSize * familyRadius;
      const aspect = family === 'single'
        ? mix(0.8, 1.25, random())
        : family === 'chain'
          ? mix(0.78, 1.4, random())
          : mix(0.75, 1.5, random());
      const radiusX = radius * Math.sqrt(aspect);
      const radiusY = radius / Math.sqrt(aspect);
      lobes.push({
        x,
        y,
        radiusX,
        radiusY,
        rotation: heading + (random() - 0.5) * 1.25,
        strength: mix(0.92, 1, random()),
        parentIndex,
      });

      if (lobeIndex < lobeCount - 1) {
        const startsIslandBranch = family === 'island' && (lobeIndex + 1) % 4 === 0;
        if (startsIslandBranch) {
          heading = rootHeading + (random() - 0.5) * 3.4;
          const rootOffset = resolvedGrainSize * mix(0.25, 0.8, random());
          x = positiveMod(rootX + Math.cos(heading) * rootOffset, resolvedPlateSize);
          y = positiveMod(rootY + Math.sin(heading) * rootOffset, resolvedPlateSize);
          parentIndex = 0;
        } else {
          const turnRange = family === 'island' ? 1.55 : 0.75;
          heading += (random() - 0.5) * turnRange;
          const stepScale = family === 'island'
            ? mix(0.4, 0.8, random())
            : mix(0.5, 0.9, random());
          const step = resolvedGrainSize * stepScale;
          x = positiveMod(x + Math.cos(heading) * step, resolvedPlateSize);
          y = positiveMod(y + Math.sin(heading) * step, resolvedPlateSize);
          parentIndex = lobeIndex;
        }
      }
    }

    clusters.push({ family, polarity, lobes });
  }

  return {
    version: FILM_GRAIN_MODEL_VERSION,
    plateSize: resolvedPlateSize,
    grainSize: resolvedGrainSize,
    clusters,
  };
};

export const getFilmGrainWrappedLobePositions = (lobe, plateSize, extentScale = 1) => {
  const size = Math.max(1, getNumeric(plateSize, 1));
  const resolvedExtentScale = Math.max(1, getNumeric(extentScale, 1));
  const extent = Math.max(lobe.radiusX, lobe.radiusY) * resolvedExtentScale;
  const xOffsets = [0];
  const yOffsets = [0];
  if (lobe.x - extent < 0) {
    xOffsets.push(size);
  }
  if (lobe.x + extent > size) {
    xOffsets.push(-size);
  }
  if (lobe.y - extent < 0) {
    yOffsets.push(size);
  }
  if (lobe.y + extent > size) {
    yOffsets.push(-size);
  }

  const positions = [];
  for (const offsetY of yOffsets) {
    for (const offsetX of xOffsets) {
      positions.push({ x: lobe.x + offsetX, y: lobe.y + offsetY });
    }
  }
  return positions;
};

const sampleFilmGrainLobeFieldAtOffset = (lobe, deltaX, deltaY) => {
  const radiusX = Math.max(1e-6, lobe.radiusX * FILM_GRAIN_FIELD_SUPPORT_SCALE);
  const radiusY = Math.max(1e-6, lobe.radiusY * FILM_GRAIN_FIELD_SUPPORT_SCALE);
  const cosine = Math.cos(lobe.rotation);
  const sine = Math.sin(lobe.rotation);
  const localX = (deltaX * cosine + deltaY * sine) / radiusX;
  const localY = (-deltaX * sine + deltaY * cosine) / radiusY;
  const distanceSquared = localX * localX + localY * localY;
  if (distanceSquared >= 1) {
    return 0;
  }
  const falloff = 1 - distanceSquared;
  return falloff * falloff * lobe.strength;
};

export const getFilmGrainConnectionFieldStrength = (startLobe, endLobe, plateSize) => {
  const size = Math.max(1, getNumeric(plateSize, 1));
  let deltaX = endLobe.x - startLobe.x;
  let deltaY = endLobe.y - startLobe.y;
  if (deltaX > size / 2) {
    deltaX -= size;
  } else if (deltaX < -size / 2) {
    deltaX += size;
  }
  if (deltaY > size / 2) {
    deltaY -= size;
  } else if (deltaY < -size / 2) {
    deltaY += size;
  }
  return sampleFilmGrainLobeFieldAtOffset(startLobe, deltaX / 2, deltaY / 2)
    + sampleFilmGrainLobeFieldAtOffset(endLobe, -deltaX / 2, -deltaY / 2);
};

export const buildFilmGrainFields = (model) => {
  const plateSize = Math.max(1, Math.round(getNumeric(model?.plateSize, 1)));
  const pixelCount = plateSize * plateSize;
  const darkField = new Float32Array(pixelCount);
  const lightField = new Float32Array(pixelCount);

  for (const cluster of model?.clusters ?? []) {
    const field = cluster.polarity === 'light' ? lightField : darkField;
    for (const lobe of cluster.lobes) {
      const radiusX = Math.max(1e-6, lobe.radiusX * FILM_GRAIN_FIELD_SUPPORT_SCALE);
      const radiusY = Math.max(1e-6, lobe.radiusY * FILM_GRAIN_FIELD_SUPPORT_SCALE);
      const extent = Math.max(radiusX, radiusY);
      const cosine = Math.cos(lobe.rotation);
      const sine = Math.sin(lobe.rotation);
      const positions = getFilmGrainWrappedLobePositions(
        lobe,
        plateSize,
        FILM_GRAIN_FIELD_SUPPORT_SCALE,
      );

      for (const position of positions) {
        const minX = Math.max(0, Math.floor(position.x - extent));
        const maxX = Math.min(plateSize - 1, Math.ceil(position.x + extent));
        const minY = Math.max(0, Math.floor(position.y - extent));
        const maxY = Math.min(plateSize - 1, Math.ceil(position.y + extent));

        for (let y = minY; y <= maxY; y += 1) {
          const deltaY = y + 0.5 - position.y;
          const rowOffset = y * plateSize;
          for (let x = minX; x <= maxX; x += 1) {
            const deltaX = x + 0.5 - position.x;
            const localX = (deltaX * cosine + deltaY * sine) / radiusX;
            const localY = (-deltaX * sine + deltaY * cosine) / radiusY;
            const distanceSquared = localX * localX + localY * localY;
            if (distanceSquared >= 1) {
              continue;
            }
            const falloff = 1 - distanceSquared;
            field[rowOffset + x] += falloff * falloff * lobe.strength;
          }
        }
      }
    }
  }

  return { darkField, lightField };
};

export const rasterizeFilmGrainFields = ({
  darkField,
  lightField,
  plateSize,
  seed = FILM_GRAIN_SEED,
  threshold = FILM_GRAIN_FIELD_THRESHOLD,
  thresholdVariation = FILM_GRAIN_FIELD_THRESHOLD_VARIATION,
  jitterStrength = FILM_GRAIN_FIELD_JITTER,
  featherWidth = FILM_GRAIN_FIELD_FEATHER,
  latticeCells = FILM_GRAIN_DENSITY_LATTICE_CELLS,
}) => {
  const resolvedPlateSize = Math.max(1, Math.round(getNumeric(plateSize, 1)));
  const pixelCount = resolvedPlateSize * resolvedPlateSize;
  if (darkField.length < pixelCount || lightField.length < pixelCount) {
    throw new RangeError('Film grain fields must cover the complete plate.');
  }

  const resolvedSeed = Math.floor(getNumeric(seed, FILM_GRAIN_SEED)) >>> 0;
  const resolvedThreshold = getNumeric(threshold, FILM_GRAIN_FIELD_THRESHOLD);
  const resolvedThresholdVariation = Math.max(0, getNumeric(
    thresholdVariation,
    FILM_GRAIN_FIELD_THRESHOLD_VARIATION,
  ));
  const resolvedJitterStrength = Math.max(0, getNumeric(
    jitterStrength,
    FILM_GRAIN_FIELD_JITTER,
  ));
  const resolvedFeatherWidth = Math.max(1e-6, getNumeric(
    featherWidth,
    FILM_GRAIN_FIELD_FEATHER,
  ));
  const resolvedLatticeCells = Math.max(2, Math.min(32, Math.round(getNumeric(
    latticeCells,
    FILM_GRAIN_DENSITY_LATTICE_CELLS,
  ))));
  const densityLattice = new Float32Array(resolvedLatticeCells * resolvedLatticeCells);
  const densitySeed = resolvedSeed ^ 0x51ed270b;
  for (let y = 0; y < resolvedLatticeCells; y += 1) {
    for (let x = 0; x < resolvedLatticeCells; x += 1) {
      densityLattice[y * resolvedLatticeCells + x] = hashFilmGrainCoordinate(
        x,
        y,
        densitySeed,
      );
    }
  }

  const latticeX0 = new Uint8Array(resolvedPlateSize);
  const latticeX1 = new Uint8Array(resolvedPlateSize);
  const latticeXBlend = new Float32Array(resolvedPlateSize);
  for (let x = 0; x < resolvedPlateSize; x += 1) {
    const latticeX = x * resolvedLatticeCells / resolvedPlateSize;
    const x0 = Math.floor(latticeX);
    const fraction = latticeX - x0;
    latticeX0[x] = x0;
    latticeX1[x] = (x0 + 1) % resolvedLatticeCells;
    latticeXBlend[x] = fraction * fraction * (3 - 2 * fraction);
  }

  const darkAlpha = new Uint8ClampedArray(pixelCount);
  const lightAlpha = new Uint8ClampedArray(pixelCount);
  let darkAlphaSum = 0;
  let lightAlphaSum = 0;
  const jitterSeed = resolvedSeed ^ 0x9e3779b9;
  for (let y = 0; y < resolvedPlateSize; y += 1) {
    const latticeY = y * resolvedLatticeCells / resolvedPlateSize;
    const y0 = Math.floor(latticeY);
    const y1 = (y0 + 1) % resolvedLatticeCells;
    const yFraction = latticeY - y0;
    const yBlend = yFraction * yFraction * (3 - 2 * yFraction);
    const rowOffset = y * resolvedPlateSize;
    const latticeRow0 = y0 * resolvedLatticeCells;
    const latticeRow1 = y1 * resolvedLatticeCells;

    for (let x = 0; x < resolvedPlateSize; x += 1) {
      const x0 = latticeX0[x];
      const x1 = latticeX1[x];
      const xBlend = latticeXBlend[x];
      const densityTop = mix(
        densityLattice[latticeRow0 + x0],
        densityLattice[latticeRow0 + x1],
        xBlend,
      );
      const densityBottom = mix(
        densityLattice[latticeRow1 + x0],
        densityLattice[latticeRow1 + x1],
        xBlend,
      );
      const density = mix(densityTop, densityBottom, yBlend);
      const localThreshold = resolvedThreshold
        + (density - 0.5) * resolvedThresholdVariation * 2;
      const jitter = (
        hashFilmGrainCoordinate(x, y, jitterSeed) - 0.5
      ) * resolvedJitterStrength;
      const pixelIndex = rowOffset + x;
      const darkAlphaValue = Math.round(
        smoothstep(
          localThreshold,
          localThreshold + resolvedFeatherWidth,
          darkField[pixelIndex] + jitter,
        ) * 255,
      );
      const lightAlphaValue = Math.round(
        smoothstep(
          localThreshold,
          localThreshold + resolvedFeatherWidth,
          lightField[pixelIndex] + jitter,
        ) * 255,
      );
      darkAlpha[pixelIndex] = darkAlphaValue;
      lightAlpha[pixelIndex] = lightAlphaValue;
      darkAlphaSum += darkAlphaValue;
      lightAlphaSum += lightAlphaValue;
    }
  }

  const alphaSampleCount = pixelCount * 255;
  return {
    darkAlpha,
    lightAlpha,
    darkMeanAlpha: darkAlphaSum / alphaSampleCount,
    lightMeanAlpha: lightAlphaSum / alphaSampleCount,
  };
};

const writeFilmGrainPlate = (ctx, alpha, polarity, plateSize) => {
  if (!ctx) {
    return;
  }
  const imageData = ctx.createImageData(plateSize, plateSize);
  const data = imageData.data;
  const channelValue = polarity === 'light' ? 255 : 0;
  for (let index = 0; index < alpha.length; index += 1) {
    const dataIndex = index * 4;
    data[dataIndex] = channelValue;
    data[dataIndex + 1] = channelValue;
    data[dataIndex + 2] = channelValue;
    data[dataIndex + 3] = alpha[index];
  }
  ctx.putImageData(imageData, 0, 0);
};

const renderFilmGrainPlates = (darkCtx, lightCtx, model) => {
  if (!darkCtx || !lightCtx) {
    return null;
  }
  const fields = buildFilmGrainFields(model);
  const raster = rasterizeFilmGrainFields({
    ...fields,
    plateSize: model.plateSize,
    seed: FILM_GRAIN_SEED,
  });
  writeFilmGrainPlate(darkCtx, raster.darkAlpha, 'dark', model.plateSize);
  writeFilmGrainPlate(lightCtx, raster.lightAlpha, 'light', model.plateSize);
  return {
    darkMeanAlpha: raster.darkMeanAlpha,
    lightMeanAlpha: raster.lightMeanAlpha,
  };
};

const ensureFilmGrainPlates = (filmNoiseFilter, filterState) => {
  const grainSize = Math.max(0.75, Math.min(8, getNumeric(filmNoiseFilter?.settings?.scale, 1.5)));
  const plateKey = JSON.stringify({
    version: FILM_GRAIN_MODEL_VERSION,
    plateSize: FILM_GRAIN_PLATE_SIZE,
    grainSize,
  });
  if (
    filterState.filmGrainPlateKey === plateKey
    && filterState.filmGrainDarkPlateCanvas
    && filterState.filmGrainLightPlateCanvas
  ) {
    return {
      darkCanvas: filterState.filmGrainDarkPlateCanvas,
      lightCanvas: filterState.filmGrainLightPlateCanvas,
    };
  }

  const darkCanvas = ensureDisplayFilterCanvas(
    filterState.filmGrainDarkPlateCanvas,
    FILM_GRAIN_PLATE_SIZE,
    FILM_GRAIN_PLATE_SIZE,
  );
  const lightCanvas = ensureDisplayFilterCanvas(
    filterState.filmGrainLightPlateCanvas,
    FILM_GRAIN_PLATE_SIZE,
    FILM_GRAIN_PLATE_SIZE,
  );
  const darkCtx = clearDisplayNoiseCanvas(darkCanvas);
  const lightCtx = clearDisplayNoiseCanvas(lightCanvas);
  const model = createFilmGrainPlateModel({
    plateSize: FILM_GRAIN_PLATE_SIZE,
    grainSize,
    seed: FILM_GRAIN_SEED,
  });
  const plateStats = renderFilmGrainPlates(darkCtx, lightCtx, model);

  filterState.filmGrainPlateKey = plateKey;
  filterState.filmGrainDarkPlateCanvas = darkCanvas;
  filterState.filmGrainLightPlateCanvas = lightCanvas;
  filterState.filmGrainDarkMeanAlpha = plateStats?.darkMeanAlpha ?? 0;
  filterState.filmGrainLightMeanAlpha = plateStats?.lightMeanAlpha ?? 0;
  filterState.filmGrainOverlayKey = '';
  return { darkCanvas, lightCanvas };
};

const fillFilmGrainOverlay = ({
  overlayCanvas,
  overlayCtx,
  plateCanvas,
  phaseX,
  phaseY,
  displayScale,
}) => {
  if (!overlayCanvas || !overlayCtx || !plateCanvas) {
    return;
  }
  const pattern = overlayCtx.createPattern(plateCanvas, 'repeat');
  if (!pattern) {
    return;
  }
  overlayCtx.save();
  overlayCtx.translate(-phaseX, -phaseY);
  overlayCtx.scale(displayScale, displayScale);
  overlayCtx.fillStyle = pattern;
  overlayCtx.fillRect(
    0,
    0,
    overlayCanvas.width / displayScale + plateCanvas.width,
    overlayCanvas.height / displayScale + plateCanvas.height,
  );
  overlayCtx.restore();
};

export const ensureFilmGrainOverlays = ({
  filmNoiseFilter,
  filterState,
  width,
  height,
  originX = 0,
  originY = 0,
}) => {
  const plates = ensureFilmGrainPlates(filmNoiseFilter, filterState);
  if (!plates.darkCanvas || !plates.lightCanvas) {
    return null;
  }
  const targetWidth = Math.max(1, Math.ceil(width));
  const targetHeight = Math.max(1, Math.ceil(height));
  const displayScale = resolveFilmGrainDisplayScale(filmNoiseFilter?.settings?.scale);
  const repeatWidth = plates.darkCanvas.width * displayScale;
  const repeatHeight = plates.darkCanvas.height * displayScale;
  const phaseX = positiveMod(originX, repeatWidth);
  const phaseY = positiveMod(originY, repeatHeight);
  const overlayKey = JSON.stringify({
    plateKey: filterState.filmGrainPlateKey,
    width: targetWidth,
    height: targetHeight,
    displayScale,
    phaseX,
    phaseY,
  });
  if (
    filterState.filmGrainOverlayKey === overlayKey
    && filterState.filmGrainDarkOverlayCanvas
    && filterState.filmGrainLightOverlayCanvas
  ) {
    return {
      darkCanvas: filterState.filmGrainDarkOverlayCanvas,
      lightCanvas: filterState.filmGrainLightOverlayCanvas,
    };
  }

  const darkOverlayCanvas = ensureDisplayFilterCanvas(
    filterState.filmGrainDarkOverlayCanvas,
    targetWidth,
    targetHeight,
  );
  const lightOverlayCanvas = ensureDisplayFilterCanvas(
    filterState.filmGrainLightOverlayCanvas,
    targetWidth,
    targetHeight,
  );
  const darkOverlayCtx = clearDisplayNoiseCanvas(darkOverlayCanvas);
  const lightOverlayCtx = clearDisplayNoiseCanvas(lightOverlayCanvas);
  fillFilmGrainOverlay({
    overlayCanvas: darkOverlayCanvas,
    overlayCtx: darkOverlayCtx,
    plateCanvas: plates.darkCanvas,
    phaseX,
    phaseY,
    displayScale,
  });
  fillFilmGrainOverlay({
    overlayCanvas: lightOverlayCanvas,
    overlayCtx: lightOverlayCtx,
    plateCanvas: plates.lightCanvas,
    phaseX,
    phaseY,
    displayScale,
  });

  filterState.filmGrainOverlayKey = overlayKey;
  filterState.filmGrainDarkOverlayCanvas = darkOverlayCanvas;
  filterState.filmGrainLightOverlayCanvas = lightOverlayCanvas;
  return { darkCanvas: darkOverlayCanvas, lightCanvas: lightOverlayCanvas };
};

const drawFilmGrainOverlayPass = (
  targetCtx,
  overlayCanvas,
  alpha,
  operation,
  filter,
  targetRect,
) => {
  if (alpha <= 0) {
    return;
  }
  targetCtx.save();
  targetCtx.globalAlpha = alpha;
  targetCtx.globalCompositeOperation = operation;
  targetCtx.filter = filter;
  targetCtx.drawImage(
    overlayCanvas,
    0,
    0,
    overlayCanvas.width,
    overlayCanvas.height,
    targetRect.x,
    targetRect.y,
    targetRect.width,
    targetRect.height,
  );
  targetCtx.restore();
};

export const applyFilmGrainOverlay = ({
  targetCtx,
  filmNoiseFilter,
  filterState,
  targetRect,
  documentOrigin = targetRect,
}) => {
  const amount = clamp01(filmNoiseFilter?.settings?.opacity);
  if (!targetCtx || !filmNoiseFilter?.enabled || amount <= 0) {
    return false;
  }
  const overlays = ensureFilmGrainOverlays({
    filmNoiseFilter,
    filterState,
    width: targetRect.width,
    height: targetRect.height,
    originX: documentOrigin.x,
    originY: documentOrigin.y,
  });
  if (!overlays) {
    return false;
  }

  const strength = smoothstep(0, 1, amount);
  const darkMeanAlpha = Math.max(0, getNumeric(filterState.filmGrainDarkMeanAlpha, 0));
  const lightMeanAlpha = Math.max(0, getNumeric(filterState.filmGrainLightMeanAlpha, 0));
  let darkAlpha = strength;
  let lightAlpha = strength;
  if (darkMeanAlpha > 0 && lightMeanAlpha > 0) {
    const balancedMeanAlpha = Math.min(darkMeanAlpha, lightMeanAlpha);
    darkAlpha *= balancedMeanAlpha / darkMeanAlpha;
    lightAlpha *= balancedMeanAlpha / lightMeanAlpha;
  }
  const tone = Math.max(-1, Math.min(1, getNumeric(filmNoiseFilter?.settings?.tone, 0)));
  const blackMix = Math.max(0, -tone);
  const whiteMix = Math.max(0, tone);
  drawFilmGrainOverlayPass(
    targetCtx,
    overlays.darkCanvas,
    darkAlpha * (1 - whiteMix),
    'multiply',
    'none',
    targetRect,
  );
  drawFilmGrainOverlayPass(
    targetCtx,
    overlays.lightCanvas,
    lightAlpha * blackMix,
    'multiply',
    'brightness(0)',
    targetRect,
  );
  drawFilmGrainOverlayPass(
    targetCtx,
    overlays.lightCanvas,
    lightAlpha * (1 - blackMix),
    'screen',
    'none',
    targetRect,
  );
  drawFilmGrainOverlayPass(
    targetCtx,
    overlays.darkCanvas,
    darkAlpha * whiteMix,
    'screen',
    'brightness(0) invert(1)',
    targetRect,
  );
  return true;
};

const CRT_VERTEX_SHADER = `#version 300 es
precision highp float;
layout(location = 0) in vec2 a_position;
out vec2 v_uv;

void main() {
  v_uv = a_position * 0.5 + 0.5;
  gl_Position = vec4(a_position, 0.0, 1.0);
}
`;

const CRT_ANALOG_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_texel;
uniform vec2 u_sourceSize;
uniform float u_artifacts;
uniform float u_seed;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 345.45));
  point += dot(point, point + 34.345 + u_seed);
  return fract(point.x * point.y);
}

vec3 rgbToYiq(vec3 color) {
  return vec3(
    dot(color, vec3(0.299, 0.587, 0.114)),
    dot(color, vec3(0.596, -0.274, -0.322)),
    dot(color, vec3(0.211, -0.523, 0.312))
  );
}

vec3 yiqToRgb(vec3 signal) {
  return vec3(
    signal.x + 0.956 * signal.y + 0.621 * signal.z,
    signal.x - 0.272 * signal.y - 0.647 * signal.z,
    signal.x - 1.106 * signal.y + 1.703 * signal.z
  );
}

vec2 clampUv(vec2 uv) {
  return clamp(uv, u_texel * 0.5, vec2(1.0) - u_texel * 0.5);
}

vec3 sampleYiq(vec2 uv) {
  return rgbToYiq(texture(u_source, clampUv(uv)).rgb);
}

void main() {
  float line = floor(v_uv.y * u_sourceSize.y);
  float lineNoise = hash21(vec2(line, 7.0));
  float slowLineNoise = hash21(vec2(floor(line * 0.125), 19.0));
  float lineShift = ((lineNoise - 0.5) * 2.2 + (slowLineNoise - 0.5) * 1.4)
    * u_artifacts;
  vec2 shiftedUv = clampUv(v_uv + vec2(lineShift * u_texel.x, 0.0));

  vec4 centerRgba = texture(u_source, shiftedUv);
  vec3 center = rgbToYiq(centerRgba.rgb);
  vec3 minusOne = sampleYiq(shiftedUv - vec2(u_texel.x * 1.5, 0.0));
  vec3 plusOne = sampleYiq(shiftedUv + vec2(u_texel.x * 1.5, 0.0));
  vec3 minusTwo = sampleYiq(shiftedUv - vec2(u_texel.x * 3.5, 0.0));
  vec3 plusTwo = sampleYiq(shiftedUv + vec2(u_texel.x * 3.5, 0.0));
  vec3 minusThree = sampleYiq(shiftedUv - vec2(u_texel.x * 7.0, 0.0));
  vec3 plusThree = sampleYiq(shiftedUv + vec2(u_texel.x * 7.0, 0.0));

  float lumaBlur = center.x * 0.5 + (minusOne.x + plusOne.x) * 0.25;
  float lumaRing = center.x - (minusTwo.x + plusTwo.x) * 0.5;
  float luma = center.x
    + (center.x - lumaBlur) * u_artifacts * 0.52
    + lumaRing * u_artifacts * 0.12;

  vec2 chromaBlur = center.yz * 0.24
    + (minusOne.yz + plusOne.yz) * 0.18
    + (minusTwo.yz + plusTwo.yz) * 0.11
    + (minusThree.yz + plusThree.yz) * 0.09;
  vec2 chroma = mix(center.yz, chromaBlur, u_artifacts * 0.92);

  float phaseError = (lineNoise - 0.5) * u_artifacts * 0.22;
  float phaseCos = cos(phaseError);
  float phaseSin = sin(phaseError);
  chroma = mat2(phaseCos, -phaseSin, phaseSin, phaseCos) * chroma;

  vec3 ghost = sampleYiq(shiftedUv - vec2(u_texel.x * (9.0 + u_artifacts * 11.0), 0.0));
  luma += (ghost.x - center.x) * u_artifacts * 0.055;
  chroma += (ghost.yz - center.yz) * u_artifacts * 0.035;

  float pixelNoise = hash21(floor(gl_FragCoord.xy) + vec2(31.0, 53.0)) - 0.5;
  float lineHum = sin((line + u_seed) * 0.071) * 0.5;
  luma += (pixelNoise * 0.024 + lineHum * 0.008) * u_artifacts;
  chroma.x += pixelNoise * u_artifacts * 0.008;
  chroma.y -= pixelNoise * u_artifacts * 0.006;

  vec3 processed = clamp(yiqToRgb(vec3(luma, chroma)), 0.0, 1.0);
  outColor = vec4(mix(centerRgba.rgb, processed, u_artifacts), centerRgba.a);
}
`;

const CRT_BASE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_sourceSize;
uniform vec2 u_signalSize;
uniform float u_cellSize;
uniform float u_scanlineIntensity;
uniform float u_maskIntensity;
uniform float u_barrelDistortion;
uniform float u_chromaticAberration;
uniform float u_beamFocus;
uniform float u_brightness;
uniform float u_shadowLift;
uniform float u_vignetteIntensity;
uniform float u_flickerIntensity;

vec2 quantizeSignalUv(vec2 uv) {
  vec2 signalPixel = floor(uv * u_signalSize) + 0.5;
  return clamp(signalPixel / u_signalSize, vec2(0.0), vec2(1.0));
}

void main() {
  vec2 centered = v_uv * 2.0 - 1.0;
  float radiusSquared = dot(centered, centered);
  float warp = 1.0 + u_barrelDistortion * radiusSquared * 2.8;
  vec2 warpedUv = centered / warp * 0.5 + 0.5;
  if (warpedUv.x <= 0.0 || warpedUv.x >= 1.0 || warpedUv.y <= 0.0 || warpedUv.y >= 1.0) {
    outColor = vec4(0.0);
    return;
  }

  vec2 signalUv = quantizeSignalUv(warpedUv);
  float radialLength = length(centered);
  vec2 radialDirection = radialLength > 0.0001 ? centered / radialLength : vec2(0.0);
  vec2 aberrationUv = radialDirection
    * u_chromaticAberration
    * (0.45 + radialLength * 1.4)
    / u_sourceSize;

  float red = texture(u_source, quantizeSignalUv(warpedUv - aberrationUv)).r;
  float green = texture(u_source, signalUv).g;
  float blue = texture(u_source, quantizeSignalUv(warpedUv + aberrationUv)).b;
  float alpha = texture(u_source, signalUv).a;
  vec3 linearColor = pow(max(vec3(red, green, blue), vec3(0.0)), vec3(2.4));
  float luma = dot(linearColor, vec3(0.2126, 0.7152, 0.0722));

  float signalLine = warpedUv.y * u_signalSize.y;
  float lineDistance = abs(fract(signalLine) - 0.5) * 2.0;
  float beamWidth = mix(0.18, 0.56, u_beamFocus) + luma * mix(0.09, 0.28, u_beamFocus);
  float beam = exp(-pow(lineDistance / max(0.08, beamWidth), 2.0));
  float scanline = mix(1.0, 0.24 + beam * 0.76, u_scanlineIntensity);

  float maskCell = max(1.0, u_cellSize / 6.0);
  float maskIndex = mod(floor(gl_FragCoord.x / maskCell), 3.0);
  vec3 phosphor = maskIndex < 0.5
    ? vec3(1.38, 0.58, 0.58)
    : maskIndex < 1.5
      ? vec3(0.58, 1.38, 0.58)
      : vec3(0.58, 0.58, 1.38);
  vec3 mask = mix(vec3(1.0), phosphor, u_maskIntensity);

  float brightnessGain = 0.72 + u_brightness * 0.56;
  float frozenFlicker = (fract(sin(41.73) * 43758.5453123) - 0.5)
    * u_flickerIntensity
    * 0.22;
  vec3 lifted = linearColor * brightnessGain + vec3(u_shadowLift * (1.0 - luma) * 0.22);
  float vignette = 1.0 - u_vignetteIntensity * smoothstep(0.35, 1.05, radialLength);
  outColor = vec4(
    max(vec3(0.0), lifted * (1.0 + frozenFlicker) * scanline * mask * vignette),
    alpha
  );
}
`;

const CRT_BLOOM_HORIZONTAL_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_texel;
uniform float u_radius;

vec3 highlight(vec2 uv) {
  vec3 color = texture(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return color * mix(0.12, 1.0, smoothstep(0.08, 0.8, luma));
}

void main() {
  float spread = max(0.35, u_radius * 0.25);
  vec2 stepUv = vec2(u_texel.x * spread, 0.0);
  vec3 color = highlight(v_uv) * 0.227027;
  color += highlight(v_uv + stepUv * 1.384615) * 0.316216;
  color += highlight(v_uv - stepUv * 1.384615) * 0.316216;
  color += highlight(v_uv + stepUv * 3.230769) * 0.070270;
  color += highlight(v_uv - stepUv * 3.230769) * 0.070270;
  outColor = vec4(color, 1.0);
}
`;

const CRT_RESOLVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_base;
uniform sampler2D u_bloom;
uniform vec2 u_bloomTexel;
uniform float u_radius;
uniform float u_intensity;

vec3 sampleBloom(vec2 uv) {
  return texture(u_bloom, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
  vec4 base = texture(u_base, v_uv);
  float spread = max(0.35, u_radius * 0.25);
  vec2 stepUv = vec2(0.0, u_bloomTexel.y * spread);
  vec3 bloom = sampleBloom(v_uv) * 0.227027;
  bloom += sampleBloom(v_uv + stepUv * 1.384615) * 0.316216;
  bloom += sampleBloom(v_uv - stepUv * 1.384615) * 0.316216;
  bloom += sampleBloom(v_uv + stepUv * 3.230769) * 0.070270;
  bloom += sampleBloom(v_uv - stepUv * 3.230769) * 0.070270;
  vec3 resolved = max(vec3(0.0), base.rgb + bloom * u_intensity * 0.16);
  outColor = vec4(pow(clamp(resolved, 0.0, 1.0), vec3(1.0 / 2.2)), base.a);
}
`;

const NTSE_CRT_STATIC_SIGNAL_SEED = 73.19;

const NTSE_CRT_ANALOG_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_texel;
uniform vec2 u_sourceSize;
uniform float u_smear;
uniform float u_noise;
uniform float u_seed;

float hash21(vec2 point) {
  point = fract(point * vec2(123.34, 456.21));
  point += dot(point, point + 45.32 + u_seed);
  return fract(point.x * point.y);
}

vec3 rgbToYiq(vec3 color) {
  return vec3(
    dot(color, vec3(0.299, 0.587, 0.114)),
    dot(color, vec3(0.596, -0.274, -0.322)),
    dot(color, vec3(0.211, -0.523, 0.312))
  );
}

vec3 yiqToRgb(vec3 signal) {
  return vec3(
    signal.x + 0.956 * signal.y + 0.621 * signal.z,
    signal.x - 0.272 * signal.y - 0.647 * signal.z,
    signal.x - 1.106 * signal.y + 1.703 * signal.z
  );
}

vec2 safeUv(vec2 uv) {
  return clamp(uv, u_texel * 0.5, vec2(1.0) - u_texel * 0.5);
}

vec3 sampleYiq(vec2 uv) {
  return rgbToYiq(texture(u_source, safeUv(uv)).rgb);
}

void main() {
  float line = floor(v_uv.y * u_sourceSize.y);
  float lineNoise = hash21(vec2(line, 11.0));
  float groupNoise = hash21(vec2(floor(line / 5.0), 29.0));
  float slowWave = sin(line * 0.031 + u_seed) * 0.5;
  float lineShiftPixels = (
    (lineNoise - 0.5) * 3.4
    + (groupNoise - 0.5) * 5.2
    + slowWave * 1.4
  ) * u_smear;
  float lowerBand = smoothstep(0.91, 0.985, v_uv.y) * (groupNoise - 0.5) * 10.0 * u_smear;
  vec2 uv = safeUv(v_uv + vec2((lineShiftPixels + lowerBand) * u_texel.x, 0.0));

  vec4 source = texture(u_source, uv);
  vec3 center = rgbToYiq(source.rgb);
  vec3 left1 = sampleYiq(uv - vec2(u_texel.x * 1.5, 0.0));
  vec3 right1 = sampleYiq(uv + vec2(u_texel.x * 1.5, 0.0));
  vec3 left2 = sampleYiq(uv - vec2(u_texel.x * 3.5, 0.0));
  vec3 right2 = sampleYiq(uv + vec2(u_texel.x * 3.5, 0.0));
  vec3 left3 = sampleYiq(uv - vec2(u_texel.x * 7.5, 0.0));
  vec3 right3 = sampleYiq(uv + vec2(u_texel.x * 7.5, 0.0));
  vec3 left4 = sampleYiq(uv - vec2(u_texel.x * 15.5, 0.0));
  vec3 right4 = sampleYiq(uv + vec2(u_texel.x * 15.5, 0.0));

  float lowLuma = center.x * 0.48 + (left1.x + right1.x) * 0.2
    + (left2.x + right2.x) * 0.06;
  float luma = mix(center.x, lowLuma, u_smear * 0.28);
  luma += (center.x - lowLuma) * u_smear * 0.72;
  luma += (center.x - (left3.x + right3.x) * 0.5) * u_smear * 0.09;

  vec2 chromaWide = center.yz * 0.14
    + left1.yz * 0.14 + right1.yz * 0.12
    + left2.yz * 0.12 + right2.yz * 0.1
    + left3.yz * 0.1 + right3.yz * 0.08
    + left4.yz * 0.06 + right4.yz * 0.04;
  vec2 chromaTrail = sampleYiq(uv - vec2(u_texel.x * (18.0 + 18.0 * u_smear), 0.0)).yz;
  vec2 chroma = mix(center.yz, chromaWide, u_smear * 0.96);
  chroma = mix(chroma, chromaTrail, u_smear * 0.12);

  float phase = (lineNoise - 0.5) * 0.34 * u_smear;
  chroma = mat2(cos(phase), -sin(phase), sin(phase), cos(phase)) * chroma;

  vec3 ghost = sampleYiq(uv - vec2(u_texel.x * (26.0 + u_smear * 34.0), 0.0));
  luma += (ghost.x - center.x) * u_smear * 0.08;
  chroma += (ghost.yz - center.yz) * u_smear * 0.055;

  float grain = hash21(floor(gl_FragCoord.xy) + vec2(17.0, 61.0)) - 0.5;
  float signalNoise = grain * u_noise;
  luma += signalNoise * 0.11;
  chroma += vec2(signalNoise * 0.035, -signalNoise * 0.025);

  outColor = vec4(clamp(yiqToRgb(vec3(luma, chroma)), 0.0, 1.0), source.a);
}
`;

const NTSE_CRT_DOWNSCALE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_sourceSize;

void main() {
  vec2 sourcePixel = floor(v_uv * u_sourceSize) + 0.5;
  outColor = texture(u_source, sourcePixel / u_sourceSize);
}
`;

const NTSE_CRT_BEAM_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_signalSize;
uniform float u_scanlineSize;
uniform float u_scanlineStrength;

vec3 sampleLinear(vec2 pixel) {
  vec3 color = texture(u_source, (pixel + 0.5) / u_signalSize).rgb;
  return pow(max(color, vec3(0.0)), vec3(2.4));
}

float sampleAlpha(vec2 pixel) {
  return texture(u_source, (pixel + 0.5) / u_signalSize).a;
}

vec3 beam(vec3 color, float distanceToLine) {
  vec3 width = 2.0 + 2.0 * pow(color, vec3(4.0));
  vec3 distance = vec3(abs(distanceToLine) * 3.333333333);
  return 2.0 * color * exp(-pow(distance * inversesqrt(0.5 * width), width))
    / (0.6 + 0.2 * width);
}

void main() {
  float scanlineSize = clamp(u_scanlineSize, 0.5, 3.0);
  float scanlinePosition = v_uv.y * u_signalSize.y / scanlineSize - 0.5;
  float scanlineIndex = floor(scanlinePosition);
  float scanlinePhase = fract(scanlinePosition);
  float sourceTopY = floor((scanlineIndex + 0.5) * scanlineSize);
  float sourceBottomY = floor((scanlineIndex + 1.5) * scanlineSize);
  vec2 sourceX = vec2(floor(v_uv.x * u_signalSize.x), 0.0);
  vec2 topPixel = clamp(sourceX + vec2(0.0, sourceTopY), vec2(0.0), u_signalSize - 1.0);
  vec2 bottomPixel = clamp(sourceX + vec2(0.0, sourceBottomY), vec2(0.0), u_signalSize - 1.0);
  vec3 top = sampleLinear(topPixel);
  vec3 bottom = sampleLinear(bottomPixel);
  float topAlpha = sampleAlpha(topPixel);
  float bottomAlpha = sampleAlpha(bottomPixel);
  vec3 scanline = beam(top, scanlinePhase) + beam(bottom, 1.0 - scanlinePhase);
  vec3 reconstructed = scanline * 0.956521739;
  vec3 unshaped = mix(top, bottom, scanlinePhase);
  vec3 resolved = mix(unshaped, reconstructed, u_scanlineStrength);
  outColor = vec4(max(resolved * 1.1, vec3(0.0)), mix(topAlpha, bottomAlpha, scanlinePhase));
}
`;

const NTSE_CRT_BLOOM_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_source;
uniform vec2 u_texel;

vec3 threshold(vec2 uv) {
  vec3 color = texture(u_source, clamp(uv, vec2(0.0), vec2(1.0))).rgb * 1.15;
  return pow(clamp(color, 0.0, 1.0), vec3(2.4));
}

void main() {
  vec2 stepUv = vec2(u_texel.x * 7.0, 0.0);
  vec3 color = threshold(v_uv) * 0.227027;
  color += threshold(v_uv + stepUv * 1.384615) * 0.316216;
  color += threshold(v_uv - stepUv * 1.384615) * 0.316216;
  color += threshold(v_uv + stepUv * 3.230769) * 0.070270;
  color += threshold(v_uv - stepUv * 3.230769) * 0.070270;
  outColor = vec4(color, 1.0);
}
`;

const NTSE_CRT_RESOLVE_FRAGMENT_SHADER = `#version 300 es
precision highp float;
in vec2 v_uv;
out vec4 outColor;

uniform sampler2D u_base;
uniform sampler2D u_bloom;
uniform vec2 u_bloomTexel;
uniform float u_glowStrength;

vec3 sampleBloom(vec2 uv) {
  return texture(u_bloom, clamp(uv, vec2(0.0), vec2(1.0))).rgb;
}

void main() {
  vec4 base = texture(u_base, v_uv);
  vec2 stepUv = vec2(0.0, u_bloomTexel.y * 7.0);
  vec3 glow = sampleBloom(v_uv) * 0.227027;
  glow += sampleBloom(v_uv + stepUv * 1.384615) * 0.316216;
  glow += sampleBloom(v_uv - stepUv * 1.384615) * 0.316216;
  glow += sampleBloom(v_uv + stepUv * 3.230769) * 0.070270;
  glow += sampleBloom(v_uv - stepUv * 3.230769) * 0.070270;
  vec3 resolved = clamp(base.rgb + glow * u_glowStrength, 0.0, 1.0);
  outColor = vec4(pow(resolved, vec3(1.0 / 2.2)), base.a);
}
`;

const CRT_WEBGL_CONTEXT_ATTRIBUTES = {
  alpha: true,
  antialias: false,
  depth: false,
  desynchronized: true,
  failIfMajorPerformanceCaveat: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  stencil: false,
};

const numberShaderSource = (source) => source
  .split('\n')
  .map((line, index) => `${String(index + 1).padStart(3, ' ')} | ${line}`)
  .join('\n');

const createCrtShader = (gl, type, source, label, parallelCompile) => {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error(`${label}: unable to create shader`);
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!parallelCompile && !gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader) || 'unknown compile error';
    gl.deleteShader(shader);
    throw new Error(`${label}: ${info}\n${numberShaderSource(source)}`);
  }
  return shader;
};

const createCrtProgram = (gl, fragmentSource, label, parallelCompile) => {
  const vertexShader = createCrtShader(
    gl,
    gl.VERTEX_SHADER,
    CRT_VERTEX_SHADER,
    `${label} vertex shader`,
    parallelCompile,
  );
  const fragmentShader = createCrtShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentSource,
    `${label} fragment shader`,
    parallelCompile,
  );
  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    throw new Error(`${label}: unable to create program`);
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);
  if (!parallelCompile && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program) || 'unknown link error';
    gl.deleteProgram(program);
    throw new Error(`${label}: ${info}`);
  }
  return { label, program, validated: !parallelCompile };
};

const getCrtUniforms = (gl, program, names) => Object.fromEntries(
  names.map((name) => [name, gl.getUniformLocation(program, name)]),
);

const prepareCrtProgram = (gl, entry, uniformNames, shouldDeferUniforms) => ({
  ...entry,
  uniformNames,
  uniforms: shouldDeferUniforms
    ? null
    : getCrtUniforms(gl, entry.program, uniformNames),
});

const configureCrtTexture = (gl, texture, linear = false) => {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, linear ? gl.LINEAR : gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
};

const createCrtTexture = (gl, linear = false) => {
  const texture = gl.createTexture();
  if (!texture) {
    throw new Error('CRT WebGL: unable to create texture');
  }
  configureCrtTexture(gl, texture, linear);
  return texture;
};

const createCrtFramebuffer = (gl) => {
  const framebuffer = gl.createFramebuffer();
  if (!framebuffer) {
    throw new Error('CRT WebGL: unable to create framebuffer');
  }
  return framebuffer;
};

const getCrtContextDiagnostics = (gl) => {
  const info = gl.getExtension('WEBGL_debug_renderer_info');
  if (!info) {
    return { vendor: null, renderer: null };
  }
  return {
    vendor: gl.getParameter(info.UNMASKED_VENDOR_WEBGL) || null,
    renderer: gl.getParameter(info.UNMASKED_RENDERER_WEBGL) || null,
  };
};

const initializeCrtWebGLState = (filterState) => {
  if (typeof document === 'undefined' || filterState.crtWebGLUnavailable) {
    return null;
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', CRT_WEBGL_CONTEXT_ATTRIBUTES);
  if (!gl) {
    filterState.crtWebGLUnavailable = true;
    filterState.crtWebGLLastError = 'WebGL2 is unavailable';
    return null;
  }

  try {
    const parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
    const analogEntry = createCrtProgram(
      gl,
      CRT_ANALOG_FRAGMENT_SHADER,
      'CRT analog signal pass',
      parallelCompile,
    );
    const baseEntry = createCrtProgram(
      gl,
      CRT_BASE_FRAGMENT_SHADER,
      'CRT base pass',
      parallelCompile,
    );
    const bloomEntry = createCrtProgram(
      gl,
      CRT_BLOOM_HORIZONTAL_FRAGMENT_SHADER,
      'CRT bloom horizontal pass',
      parallelCompile,
    );
    const resolveEntry = createCrtProgram(
      gl,
      CRT_RESOLVE_FRAGMENT_SHADER,
      'CRT resolve pass',
      parallelCompile,
    );
    const programs = {
      analog: prepareCrtProgram(gl, analogEntry, [
        'u_source',
        'u_texel',
        'u_sourceSize',
        'u_artifacts',
        'u_seed',
      ], Boolean(parallelCompile)),
      base: prepareCrtProgram(gl, baseEntry, [
        'u_source',
        'u_sourceSize',
        'u_signalSize',
        'u_cellSize',
        'u_scanlineIntensity',
        'u_maskIntensity',
        'u_barrelDistortion',
        'u_chromaticAberration',
        'u_beamFocus',
        'u_brightness',
        'u_shadowLift',
        'u_vignetteIntensity',
        'u_flickerIntensity',
      ], Boolean(parallelCompile)),
      bloom: prepareCrtProgram(gl, bloomEntry, [
        'u_source',
        'u_texel',
        'u_radius',
      ], Boolean(parallelCompile)),
      resolve: prepareCrtProgram(gl, resolveEntry, [
        'u_base',
        'u_bloom',
        'u_bloomTexel',
        'u_radius',
        'u_intensity',
      ], Boolean(parallelCompile)),
    };
    const programEntries = Object.values(programs);

    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer) {
      throw new Error('CRT WebGL: unable to create fullscreen geometry');
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const state = {
      canvas,
      gl,
      parallelCompile,
      ready: !parallelCompile,
      contextLost: false,
      width: 0,
      height: 0,
      bloomWidth: 0,
      bloomHeight: 0,
      vao,
      vertexBuffer,
      programs,
      programEntries,
      textures: {
        source: createCrtTexture(gl),
        analog: createCrtTexture(gl),
        base: createCrtTexture(gl),
        bloom: createCrtTexture(gl, true),
      },
      framebuffers: {
        analog: createCrtFramebuffer(gl),
        base: createCrtFramebuffer(gl),
        bloom: createCrtFramebuffer(gl),
      },
      programCompileCount: programEntries.length,
      allocationCount: 0,
      renderCount: 0,
      drawCallCount: 0,
      ...getCrtContextDiagnostics(gl),
    };

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      state.contextLost = true;
      filterState.crtWebGLUnavailable = true;
      if (filterState.crtWebGLState === state) {
        filterState.crtWebGLState = null;
      }
      filterState.crtWebGLLastError = 'WebGL context lost';
    });
    canvas.addEventListener('webglcontextrestored', () => {
      filterState.crtWebGLUnavailable = false;
      filterState.crtWebGLLastError = null;
    });

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    filterState.crtWebGLState = state;
    filterState.crtWebGLLastError = null;
    return state;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    filterState.crtWebGLUnavailable = true;
    filterState.crtWebGLLastError = message;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
};

const validateCrtPrograms = (state) => {
  if (state.ready) {
    return true;
  }
  const { gl, parallelCompile, programEntries } = state;
  if (!parallelCompile) {
    state.ready = true;
    return true;
  }
  if (programEntries.some(({ program }) => (
    !gl.getProgramParameter(program, parallelCompile.COMPLETION_STATUS_KHR)
  ))) {
    return false;
  }
  for (const entry of programEntries) {
    if (!gl.getProgramParameter(entry.program, gl.LINK_STATUS)) {
      throw new Error(`${entry.label}: ${gl.getProgramInfoLog(entry.program) || 'unknown link error'}`);
    }
    entry.validated = true;
    entry.uniforms = getCrtUniforms(gl, entry.program, entry.uniformNames);
  }
  state.ready = true;
  return true;
};

const allocateCrtRenderTarget = (gl, texture, framebuffer, width, height) => {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0,
  );
  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error('CRT WebGL: incomplete framebuffer');
  }
};

const ensureCrtWebGLSize = (state, width, height) => {
  if (state.width === width && state.height === height) {
    return;
  }
  const { gl, canvas, textures, framebuffers } = state;
  const bloomWidth = Math.max(1, Math.round(width / CRT_BLOOM_DOWNSAMPLE));
  const bloomHeight = Math.max(1, Math.round(height / CRT_BLOOM_DOWNSAMPLE));
  canvas.width = width;
  canvas.height = height;

  gl.bindTexture(gl.TEXTURE_2D, textures.source);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  allocateCrtRenderTarget(gl, textures.analog, framebuffers.analog, width, height);
  allocateCrtRenderTarget(gl, textures.base, framebuffers.base, width, height);
  allocateCrtRenderTarget(
    gl,
    textures.bloom,
    framebuffers.bloom,
    bloomWidth,
    bloomHeight,
  );

  state.width = width;
  state.height = height;
  state.bloomWidth = bloomWidth;
  state.bloomHeight = bloomHeight;
  state.allocationCount += 1;
};

const bindCrtTexture = (gl, texture, unit, uniform) => {
  gl.activeTexture(gl.TEXTURE0 + unit);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.uniform1i(uniform, unit);
};

const beginCrtPass = (state, entry, framebuffer, width, height) => {
  const { gl } = state;
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.viewport(0, 0, width, height);
  gl.enable(gl.SCISSOR_TEST);
  gl.scissor(0, 0, width, height);
  gl.disable(gl.BLEND);
  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.CULL_FACE);
  gl.useProgram(entry.program);
  gl.bindVertexArray(state.vao);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
};

const finishCrtPass = (state) => {
  state.gl.drawArrays(state.gl.TRIANGLES, 0, 3);
  state.drawCallCount += 1;
};

const assertCrtWebGLClean = (gl) => {
  const isDevelopment = typeof process !== 'undefined'
    && process?.env?.NODE_ENV !== 'production';
  if (!isDevelopment) {
    return;
  }
  const error = gl.getError();
  if (error !== gl.NO_ERROR) {
    throw new Error(`CRT WebGL error: ${error}`);
  }
};

export const applyCrtWebGLFilter = ({
  currentCanvas,
  filterState,
  filter,
}) => {
  if (!currentCanvas || !filterState || filterState.crtWebGLUnavailable) {
    return null;
  }

  const state = filterState.crtWebGLState ?? initializeCrtWebGLState(filterState);
  if (!state || state.contextLost) {
    return null;
  }

  try {
    if (!validateCrtPrograms(state)) {
      return null;
    }
    const width = Math.max(1, currentCanvas.width);
    const height = Math.max(1, currentCanvas.height);
    ensureCrtWebGLSize(state, width, height);
    const { gl, textures, framebuffers, programs } = state;
    const settings = filter?.settings ?? {};
    const cellSize = resolveDisplayFilterPixelSize(settings.cellSize, CRT_REFERENCE_CELL_SIZE);
    const signalSize = resolveCrtSignalSize(width, height, cellSize);
    const signalArtifacts = clamp01(settings.signalArtifacts);
    const bloomRadius = Math.max(0, getNumeric(settings.bloomRadius, 0));
    const bloomIntensity = Math.max(0, getNumeric(settings.bloomIntensity, 0));

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, textures.source);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      currentCanvas,
    );

    beginCrtPass(state, programs.analog, framebuffers.analog, width, height);
    bindCrtTexture(gl, textures.source, 0, programs.analog.uniforms.u_source);
    gl.uniform2f(programs.analog.uniforms.u_texel, 1 / width, 1 / height);
    gl.uniform2f(programs.analog.uniforms.u_sourceSize, width, height);
    gl.uniform1f(programs.analog.uniforms.u_artifacts, signalArtifacts);
    gl.uniform1f(programs.analog.uniforms.u_seed, CRT_STATIC_SIGNAL_SEED);
    finishCrtPass(state);

    beginCrtPass(state, programs.base, framebuffers.base, width, height);
    bindCrtTexture(gl, textures.analog, 0, programs.base.uniforms.u_source);
    gl.uniform2f(programs.base.uniforms.u_sourceSize, width, height);
    gl.uniform2f(programs.base.uniforms.u_signalSize, signalSize.width, signalSize.height);
    gl.uniform1f(programs.base.uniforms.u_cellSize, cellSize);
    gl.uniform1f(programs.base.uniforms.u_scanlineIntensity, clamp01(settings.scanlineIntensity));
    gl.uniform1f(programs.base.uniforms.u_maskIntensity, clamp01(settings.maskIntensity));
    gl.uniform1f(
      programs.base.uniforms.u_barrelDistortion,
      Math.max(0, getNumeric(settings.barrelDistortion, 0.15)),
    );
    gl.uniform1f(
      programs.base.uniforms.u_chromaticAberration,
      resolveDisplayFilterRadius(settings.chromaticAberration, 2),
    );
    gl.uniform1f(programs.base.uniforms.u_beamFocus, clamp01(settings.beamFocus));
    gl.uniform1f(
      programs.base.uniforms.u_brightness,
      Math.max(0, getNumeric(settings.brightness, 0.5)),
    );
    gl.uniform1f(
      programs.base.uniforms.u_shadowLift,
      Math.max(0, getNumeric(settings.shadowLift, 0.16)),
    );
    gl.uniform1f(
      programs.base.uniforms.u_vignetteIntensity,
      clamp01(settings.vignetteIntensity),
    );
    gl.uniform1f(
      programs.base.uniforms.u_flickerIntensity,
      clamp01(settings.flickerIntensity),
    );
    finishCrtPass(state);

    beginCrtPass(
      state,
      programs.bloom,
      framebuffers.bloom,
      state.bloomWidth,
      state.bloomHeight,
    );
    bindCrtTexture(gl, textures.base, 0, programs.bloom.uniforms.u_source);
    gl.uniform2f(programs.bloom.uniforms.u_texel, 1 / width, 1 / height);
    gl.uniform1f(programs.bloom.uniforms.u_radius, bloomRadius);
    finishCrtPass(state);

    beginCrtPass(state, programs.resolve, null, width, height);
    bindCrtTexture(gl, textures.base, 0, programs.resolve.uniforms.u_base);
    bindCrtTexture(gl, textures.bloom, 1, programs.resolve.uniforms.u_bloom);
    gl.uniform2f(
      programs.resolve.uniforms.u_bloomTexel,
      1 / state.bloomWidth,
      1 / state.bloomHeight,
    );
    gl.uniform1f(programs.resolve.uniforms.u_radius, bloomRadius);
    gl.uniform1f(programs.resolve.uniforms.u_intensity, bloomIntensity);
    finishCrtPass(state);

    assertCrtWebGLClean(gl);
    state.renderCount += 1;
    return state.canvas;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    filterState.crtWebGLLastError = message;
    filterState.crtWebGLUnavailable = true;
    state.gl.getExtension('WEBGL_lose_context')?.loseContext();
    filterState.crtWebGLState = null;
    return null;
  }
};

const getNtseCrtSignalSize = (width, height) => {
  const signalWidth = Math.max(1, Math.min(CRT_REFERENCE_SIGNAL_WIDTH, width));
  const proportionalHeight = Math.max(1, signalWidth * height / Math.max(1, width));
  const signalHeight = Math.min(height, Math.max(1, Math.round(proportionalHeight / 2) * 2));
  return { width: signalWidth, height: signalHeight };
};

const initializeNtseCrtWebGLState = (filterState) => {
  if (typeof document === 'undefined' || filterState.ntseCrtWebGLUnavailable) {
    return null;
  }

  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2', CRT_WEBGL_CONTEXT_ATTRIBUTES);
  if (!gl) {
    filterState.ntseCrtWebGLUnavailable = true;
    filterState.ntseCrtWebGLLastError = 'WebGL2 is unavailable';
    return null;
  }

  try {
    const parallelCompile = gl.getExtension('KHR_parallel_shader_compile');
    const definitions = [
      ['analog', NTSE_CRT_ANALOG_FRAGMENT_SHADER, 'NTSE CRT analog signal pass', [
        'u_source',
        'u_texel',
        'u_sourceSize',
        'u_smear',
        'u_noise',
        'u_seed',
      ]],
      ['downscale', NTSE_CRT_DOWNSCALE_FRAGMENT_SHADER, 'NTSE CRT 320px signal downscale pass', [
        'u_source',
        'u_sourceSize',
      ]],
      ['beam', NTSE_CRT_BEAM_FRAGMENT_SHADER, 'NTSE CRT scanline beam pass', [
        'u_source',
        'u_signalSize',
        'u_scanlineSize',
        'u_scanlineStrength',
      ]],
      ['bloom', NTSE_CRT_BLOOM_FRAGMENT_SHADER, 'NTSE CRT glow horizontal pass', [
        'u_source',
        'u_texel',
      ]],
      ['resolve', NTSE_CRT_RESOLVE_FRAGMENT_SHADER, 'NTSE CRT glow resolve pass', [
        'u_base',
        'u_bloom',
        'u_bloomTexel',
        'u_glowStrength',
      ]],
    ];
    const programs = Object.fromEntries(definitions.map(([key, source, label, uniforms]) => {
      const entry = createCrtProgram(gl, source, label, parallelCompile);
      return [key, prepareCrtProgram(gl, entry, uniforms, Boolean(parallelCompile))];
    }));
    const programEntries = Object.values(programs);

    const vao = gl.createVertexArray();
    const vertexBuffer = gl.createBuffer();
    if (!vao || !vertexBuffer) {
      throw new Error('NTSE CRT WebGL: unable to create fullscreen geometry');
    }
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vertexBuffer);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 3, -1, -1, 3]),
      gl.STATIC_DRAW,
    );
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);

    const state = {
      canvas,
      gl,
      parallelCompile,
      ready: !parallelCompile,
      contextLost: false,
      width: 0,
      height: 0,
      signalWidth: 0,
      signalHeight: 0,
      bloomWidth: 0,
      bloomHeight: 0,
      vao,
      vertexBuffer,
      programs,
      programEntries,
      textures: {
        source: createCrtTexture(gl),
        analog: createCrtTexture(gl),
        signal: createCrtTexture(gl),
        base: createCrtTexture(gl),
        bloom: createCrtTexture(gl, true),
      },
      framebuffers: {
        analog: createCrtFramebuffer(gl),
        signal: createCrtFramebuffer(gl),
        base: createCrtFramebuffer(gl),
        bloom: createCrtFramebuffer(gl),
      },
      programCompileCount: programEntries.length,
      allocationCount: 0,
      renderCount: 0,
      drawCallCount: 0,
      ...getCrtContextDiagnostics(gl),
    };

    canvas.addEventListener('webglcontextlost', (event) => {
      event.preventDefault();
      state.contextLost = true;
      filterState.ntseCrtWebGLUnavailable = true;
      if (filterState.ntseCrtWebGLState === state) {
        filterState.ntseCrtWebGLState = null;
      }
      filterState.ntseCrtWebGLLastError = 'WebGL context lost';
    });
    canvas.addEventListener('webglcontextrestored', () => {
      filterState.ntseCrtWebGLUnavailable = false;
      filterState.ntseCrtWebGLLastError = null;
    });

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    filterState.ntseCrtWebGLState = state;
    filterState.ntseCrtWebGLLastError = null;
    return state;
  } catch (error) {
    filterState.ntseCrtWebGLUnavailable = true;
    filterState.ntseCrtWebGLLastError = error instanceof Error ? error.message : String(error);
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return null;
  }
};

const ensureNtseCrtWebGLSize = (state, width, height) => {
  if (state.width === width && state.height === height) {
    return;
  }
  const { gl, canvas, textures, framebuffers } = state;
  const signalSize = getNtseCrtSignalSize(width, height);
  const bloomWidth = Math.max(1, Math.round(width / CRT_BLOOM_DOWNSAMPLE));
  const bloomHeight = Math.max(1, Math.round(height / CRT_BLOOM_DOWNSAMPLE));
  canvas.width = width;
  canvas.height = height;

  gl.bindTexture(gl.TEXTURE_2D, textures.source);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA8,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
  allocateCrtRenderTarget(gl, textures.analog, framebuffers.analog, width, height);
  allocateCrtRenderTarget(
    gl,
    textures.signal,
    framebuffers.signal,
    signalSize.width,
    signalSize.height,
  );
  allocateCrtRenderTarget(gl, textures.base, framebuffers.base, width, height);
  allocateCrtRenderTarget(gl, textures.bloom, framebuffers.bloom, bloomWidth, bloomHeight);

  state.width = width;
  state.height = height;
  state.signalWidth = signalSize.width;
  state.signalHeight = signalSize.height;
  state.bloomWidth = bloomWidth;
  state.bloomHeight = bloomHeight;
  state.allocationCount += 1;
};

export const applyNtseCrtWebGLFilter = ({
  currentCanvas,
  filterState,
  filter,
}) => {
  if (!currentCanvas || !filterState || filterState.ntseCrtWebGLUnavailable) {
    return null;
  }

  const state = filterState.ntseCrtWebGLState ?? initializeNtseCrtWebGLState(filterState);
  if (!state || state.contextLost) {
    return null;
  }

  try {
    if (!validateCrtPrograms(state)) {
      return null;
    }
    const width = Math.max(1, currentCanvas.width);
    const height = Math.max(1, currentCanvas.height);
    ensureNtseCrtWebGLSize(state, width, height);
    const { gl, textures, framebuffers, programs } = state;
    const settings = filter?.settings ?? {};

    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    gl.bindTexture(gl.TEXTURE_2D, textures.source);
    gl.texSubImage2D(
      gl.TEXTURE_2D,
      0,
      0,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      currentCanvas,
    );

    beginCrtPass(state, programs.analog, framebuffers.analog, width, height);
    bindCrtTexture(gl, textures.source, 0, programs.analog.uniforms.u_source);
    gl.uniform2f(programs.analog.uniforms.u_texel, 1 / width, 1 / height);
    gl.uniform2f(programs.analog.uniforms.u_sourceSize, width, height);
    gl.uniform1f(programs.analog.uniforms.u_smear, clamp01(settings.signalSmear));
    gl.uniform1f(programs.analog.uniforms.u_noise, clamp01(settings.signalNoise));
    gl.uniform1f(programs.analog.uniforms.u_seed, NTSE_CRT_STATIC_SIGNAL_SEED);
    finishCrtPass(state);

    beginCrtPass(
      state,
      programs.downscale,
      framebuffers.signal,
      state.signalWidth,
      state.signalHeight,
    );
    bindCrtTexture(gl, textures.analog, 0, programs.downscale.uniforms.u_source);
    gl.uniform2f(programs.downscale.uniforms.u_sourceSize, width, height);
    finishCrtPass(state);

    beginCrtPass(state, programs.beam, framebuffers.base, width, height);
    bindCrtTexture(gl, textures.signal, 0, programs.beam.uniforms.u_source);
    gl.uniform2f(programs.beam.uniforms.u_signalSize, state.signalWidth, state.signalHeight);
    gl.uniform1f(
      programs.beam.uniforms.u_scanlineSize,
      Math.min(3, Math.max(0.5, getNumeric(settings.scanlineSize, 1))),
    );
    gl.uniform1f(
      programs.beam.uniforms.u_scanlineStrength,
      clamp01(settings.scanlineStrength),
    );
    finishCrtPass(state);

    beginCrtPass(
      state,
      programs.bloom,
      framebuffers.bloom,
      state.bloomWidth,
      state.bloomHeight,
    );
    bindCrtTexture(gl, textures.base, 0, programs.bloom.uniforms.u_source);
    gl.uniform2f(programs.bloom.uniforms.u_texel, 1 / width, 1 / height);
    finishCrtPass(state);

    beginCrtPass(state, programs.resolve, null, width, height);
    bindCrtTexture(gl, textures.base, 0, programs.resolve.uniforms.u_base);
    bindCrtTexture(gl, textures.bloom, 1, programs.resolve.uniforms.u_bloom);
    gl.uniform2f(
      programs.resolve.uniforms.u_bloomTexel,
      1 / state.bloomWidth,
      1 / state.bloomHeight,
    );
    gl.uniform1f(programs.resolve.uniforms.u_glowStrength, clamp01(settings.glowStrength));
    finishCrtPass(state);

    assertCrtWebGLClean(gl);
    state.renderCount += 1;
    return state.canvas;
  } catch (error) {
    filterState.ntseCrtWebGLLastError = error instanceof Error ? error.message : String(error);
    filterState.ntseCrtWebGLUnavailable = true;
    state.gl.getExtension('WEBGL_lose_context')?.loseContext();
    filterState.ntseCrtWebGLState = null;
    return null;
  }
};

const sampleChannelNearest = (data, width, height, x, y, channel) => {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) {
    return 0;
  }
  return data[(iy * width + ix) * 4 + channel] / 255;
};

const sampleAlphaNearest = (data, width, height, x, y) => {
  const ix = Math.round(x);
  const iy = Math.round(y);
  if (ix < 0 || iy < 0 || ix >= width || iy >= height) {
    return 0;
  }
  return data[(iy * width + ix) * 4 + 3] / 255;
};

const extractBrightPass = (ctx, canvas) => {
  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;
  for (let index = 0; index < data.length; index += 4) {
    const r = data[index];
    const g = data[index + 1];
    const b = data[index + 2];
    const alpha = data[index + 3] / 255;
    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const threshold = 56;
    const highlight = Math.max(0, (luma - threshold) / (255 - threshold));
    const glow = Math.max(0.12, highlight) * alpha;
    data[index] = Math.min(255, r * (0.72 + highlight * 0.38) + glow * 120);
    data[index + 1] = Math.min(255, g * (0.78 + highlight * 0.28) + glow * 92);
    data[index + 2] = Math.min(255, b * (0.52 + highlight * 0.18) + glow * 44);
    data[index + 3] = Math.round(Math.min(255, 255 * glow));
  }
  ctx.putImageData(imageData, 0, 0);
};

const applyRoundPixelsWholeImage = ({
  currentCanvas,
  nextCanvas,
  workCanvas,
  blurRadius,
  threshold,
  crush,
  preserveColor,
}) => {
  const workCtx = clearDisplayFilterCanvas(workCanvas);
  const nextCtx = clearDisplayFilterCanvas(nextCanvas);
  if (!workCtx || !nextCtx) {
    return false;
  }

  const scaledBlurRadius = Math.max(0, getNumeric(blurRadius, 0));
  workCtx.imageSmoothingEnabled = true;
  workCtx.filter = scaledBlurRadius > 0 ? `blur(${scaledBlurRadius}px)` : 'none';
  workCtx.drawImage(currentCanvas, 0, 0);
  workCtx.filter = 'none';

  const imageData = workCtx.getImageData(0, 0, workCanvas.width, workCanvas.height);
  const { data } = imageData;
  const pivot = Math.max(0, Math.min(1, getNumeric(threshold, 0.5)));
  const crushAmount = Math.max(0, Math.min(1, getNumeric(crush, 0)));
  const preserveAmount = Math.max(0, Math.min(1, getNumeric(preserveColor, 0.85)));
  const contrast = 1 + crushAmount * 24;

  for (let index = 0; index < data.length; index += 4) {
    const r = data[index] / 255;
    const g = data[index + 1] / 255;
    const b = data[index + 2] / 255;
    const a = data[index + 3] / 255;

    const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    const crushedLuma = Math.max(0, Math.min(1, (luma - pivot) * contrast + 0.5));
    const thresholdLuma = luma >= pivot ? 1 : 0;
    const finalLuma = crushedLuma * (1 - crushAmount) + thresholdLuma * crushAmount;
    const lumaScale = luma > 0.0001 ? finalLuma / luma : 0;
    const preservedR = Math.max(0, Math.min(1, r * lumaScale));
    const preservedG = Math.max(0, Math.min(1, g * lumaScale));
    const preservedB = Math.max(0, Math.min(1, b * lumaScale));
    const neutralValue = finalLuma;

    data[index] = Math.round((preservedR * preserveAmount + neutralValue * (1 - preserveAmount)) * 255);
    data[index + 1] = Math.round((preservedG * preserveAmount + neutralValue * (1 - preserveAmount)) * 255);
    data[index + 2] = Math.round((preservedB * preserveAmount + neutralValue * (1 - preserveAmount)) * 255);
    data[index + 3] = Math.round(a * 255);
  }

  workCtx.putImageData(imageData, 0, 0);
  nextCtx.drawImage(workCanvas, 0, 0);
  return true;
};

const buildCrtBloomOverlay = ({
  currentCanvas,
  bloomCanvas,
  workCanvas,
  radius,
  intensity,
}) => {
  if (!bloomCanvas || !workCanvas || radius <= 0 || intensity <= 0) {
    return null;
  }

  const bloomSourceCanvas = ensureDisplayFilterCanvas(
    bloomCanvas,
    Math.max(1, Math.round(currentCanvas.width / 4)),
    Math.max(1, Math.round(currentCanvas.height / 4)),
  );
  const bloomBlurCanvas = ensureDisplayFilterCanvas(
    workCanvas,
    Math.max(1, Math.round(currentCanvas.width / 4)),
    Math.max(1, Math.round(currentCanvas.height / 4)),
  );
  const bloomSourceCtx = clearDisplayFilterCanvas(bloomSourceCanvas);
  const bloomBlurCtx = clearDisplayFilterCanvas(bloomBlurCanvas);
  if (!bloomSourceCanvas || !bloomBlurCanvas || !bloomSourceCtx || !bloomBlurCtx) {
    return null;
  }

  const blurRadius = resolveDownsampledDisplayFilterRadius(radius, 0, 4);
  bloomSourceCtx.imageSmoothingEnabled = true;
  bloomSourceCtx.drawImage(currentCanvas, 0, 0, bloomSourceCanvas.width, bloomSourceCanvas.height);
  extractBrightPass(bloomSourceCtx, bloomSourceCanvas);
  bloomBlurCtx.imageSmoothingEnabled = true;
  bloomBlurCtx.filter = `blur(${blurRadius}px)`;
  bloomBlurCtx.globalAlpha = Math.min(1, 0.45 + intensity * 0.12);
  bloomBlurCtx.drawImage(bloomSourceCanvas, 0, 0);
  bloomBlurCtx.filter = 'none';
  bloomBlurCtx.globalAlpha = 1;
  return bloomBlurCanvas;
};

const applyCrtWholeImage = ({
  currentCanvas,
  nextCanvas,
  bloomCanvas,
  workCanvas,
  filter,
}) => {
  const nextCtx = clearDisplayFilterCanvas(nextCanvas);
  const sourceCtx = currentCanvas?.getContext('2d', { willReadFrequently: true });
  if (!nextCtx || !sourceCtx || !currentCanvas) {
    return false;
  }

  const sourceImageData = sourceCtx.getImageData(0, 0, currentCanvas.width, currentCanvas.height);
  const outputImageData = nextCtx.createImageData(currentCanvas.width, currentCanvas.height);
  const source = sourceImageData.data;
  const output = outputImageData.data;
  const width = currentCanvas.width;
  const height = currentCanvas.height;

  const cellSize = resolveDisplayFilterPixelSize(filter?.settings?.cellSize, 12);
  const scanlineSize = Math.min(
    3,
    Math.max(0.5, getNumeric(filter?.settings?.scanlineSize, 1)),
  );
  const scanlineIntensity = clamp01(filter?.settings?.scanlineIntensity);
  const maskIntensity = clamp01(filter?.settings?.maskIntensity);
  const barrelDistortion = Math.max(0, getNumeric(filter?.settings?.barrelDistortion, 0.15));
  const chromaticAberration = resolveDisplayFilterRadius(filter?.settings?.chromaticAberration, 2);
  const beamFocus = clamp01(filter?.settings?.beamFocus);
  const brightness = Math.max(0, getNumeric(filter?.settings?.brightness, 0.5));
  const shadowLift = Math.max(0, getNumeric(filter?.settings?.shadowLift, 0.16));
  const vignetteIntensity = clamp01(filter?.settings?.vignetteIntensity);
  const flickerIntensity = clamp01(filter?.settings?.flickerIntensity);
  const signalArtifacts = clamp01(filter?.settings?.signalArtifacts);
  const signalNoise = clamp01(filter?.settings?.signalNoise);
  const bloomIntensity = Math.max(0, getNumeric(filter?.settings?.bloomIntensity, 0));
  const bloomRadius = Math.max(0, getNumeric(filter?.settings?.bloomRadius, 0));
  const beamExponent = mix(3.4, 0.55, beamFocus);
  const brightnessGain = 0.72 + brightness * 0.56;
  const flickerSeed = CRT_STATIC_SIGNAL_SEED;
  const frozenFlicker = 1
    + (hashNoise(flickerSeed, 0, 0.173) - 0.5) * flickerIntensity * 0.22;
  const cellHeight = Math.max(3, Math.round(cellSize * 0.92));
  const triadWidth = Math.max(1, cellSize / 3);
  const scanlinePeriod = Math.max(
    2,
    Math.round(Math.max(2, cellSize * 0.5) * scanlineSize),
  );
  const scanlineSoftness = Math.max(0.5, scanlinePeriod * 0.22);
  const bloomOverlay = buildCrtBloomOverlay({
    currentCanvas,
    bloomCanvas,
    workCanvas,
    radius: bloomRadius,
    intensity: bloomIntensity,
  });

  for (let y = 0; y < height; y += 1) {
    const lineNoise = (hashNoise(flickerSeed, y, 0.431) - 0.5) * signalArtifacts;
    const tearNoise = hashNoise(y, flickerSeed, 0.819);
    const lineShift = lineNoise * cellSize * (0.75 + tearNoise * 1.25);

    for (let x = 0; x < width; x += 1) {
      const nx = ((x + 0.5) / width) * 2 - 1;
      const ny = ((y + 0.5) / height) * 2 - 1;
      const radius2 = nx * nx + ny * ny;
      const radius = Math.sqrt(radius2);
      const warp = 1 + barrelDistortion * radius2 * 2.8;
      const srcNx = nx / warp;
      const srcNy = ny / warp;
      const srcX = ((srcNx * 0.5) + 0.5) * (width - 1) + lineShift;
      const srcY = ((srcNy * 0.5) + 0.5) * (height - 1);

      const index = (y * width + x) * 4;
      if (srcX < 0 || srcY < 0 || srcX >= width || srcY >= height) {
        output[index] = 0;
        output[index + 1] = 0;
        output[index + 2] = 0;
        output[index + 3] = 0;
        continue;
      }

      const dirX = radius > 1e-4 ? nx / radius : 0;
      const dirY = radius > 1e-4 ? ny / radius : 0;
      const aberrationOffset = chromaticAberration * (0.45 + radius * 1.4);
      const r = sampleChannelNearest(source, width, height, srcX - dirX * aberrationOffset, srcY + dirY * aberrationOffset * 0.35, 0);
      const g = sampleChannelNearest(source, width, height, srcX, srcY, 1);
      const b = sampleChannelNearest(source, width, height, srcX + dirX * aberrationOffset, srcY - dirY * aberrationOffset * 0.35, 2);
      const alpha = sampleAlphaNearest(source, width, height, srcX, srcY);

      const localX = positiveMod(x + lineShift, cellSize);
      const localY = positiveMod(y, cellHeight);
      const verticalCenter = (cellHeight - 1) * 0.5;
      const verticalDistance = Math.abs(localY - verticalCenter) / Math.max(1, verticalCenter);
      const verticalAperture = Math.pow(Math.max(0, 1 - verticalDistance), mix(2.4, 0.45, beamFocus));
      const apertureInset = Math.max(0.08, triadWidth * 0.16);
      const maskFloor = mix(1, 0.02, maskIntensity);
      const maskPeak = mix(1, 1.85, maskIntensity);
      const maskWeights = [0, 1, 2].map((channel) => {
        const subpixelCenter = (channel + 0.5) * triadWidth;
        const rawDistance = Math.abs(localX - subpixelCenter) - apertureInset;
        const distance = rawDistance / Math.max(0.5, triadWidth * 0.5 - apertureInset);
        const horizontalAperture = Math.pow(Math.max(0, 1 - distance), 2.1);
        const aperture = horizontalAperture * verticalAperture;
        return mix(maskFloor, maskPeak, aperture);
      });
      const maskAlpha = clamp01(Math.max(maskWeights[0], maskWeights[1], maskWeights[2]));

      const scanOffset = positiveMod(y, scanlinePeriod);
      const scanDistance = Math.abs(scanOffset - scanlinePeriod * 0.5) / scanlineSoftness;
      const scanShape = Math.pow(Math.max(0, 1 - clamp01(scanDistance)), beamExponent);
      const scanline = mix(1 - scanlineIntensity, 1, scanShape);
      const vignette = 1 - vignetteIntensity * smoothstep(0.35, 1.05, radius);
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const lift = shadowLift * (1 - luma);
      const artifactNoise = (hashNoise(x + flickerSeed * 13, y, 0.277) - 0.5)
        * (signalArtifacts * 0.09 + signalNoise * 0.11);
      const gain = scanline * vignette * maskAlpha;

      output[index] = Math.round(clamp01((r * brightnessGain + lift + artifactNoise) * frozenFlicker * gain * maskWeights[0]) * 255);
      output[index + 1] = Math.round(clamp01((g * brightnessGain + lift + artifactNoise * 0.7) * frozenFlicker * gain * maskWeights[1]) * 255);
      output[index + 2] = Math.round(clamp01((b * brightnessGain + lift + artifactNoise * 0.45) * frozenFlicker * gain * maskWeights[2]) * 255);
      output[index + 3] = Math.round(alpha * maskAlpha * scanline * vignette * 255);
    }
  }

  nextCtx.putImageData(outputImageData, 0, 0);

  if (bloomOverlay && bloomIntensity > 0) {
    nextCtx.save();
    nextCtx.globalCompositeOperation = 'screen';
    nextCtx.globalAlpha = Math.min(1, 0.22 + bloomIntensity * 0.14);
    nextCtx.imageSmoothingEnabled = true;
    nextCtx.drawImage(bloomOverlay, 0, 0, nextCanvas.width, nextCanvas.height);
    nextCtx.restore();
  }

  return true;
};

export const applyDisplayFilterStack = ({
  sourceCanvas,
  displayFilters,
  filterState,
  visibleRect,
  directOverlayTarget,
}) => {
  const directOverlayFilter = directOverlayTarget
    ? getDirectOverlayDisplayFilter(displayFilters)
    : null;
  if (directOverlayTarget && directOverlayFilter) {
    if (directOverlayFilter.id === 'noise') {
      applyDisplayNoiseOverlay({
        targetCtx: directOverlayTarget.ctx,
        noiseFilter: directOverlayFilter,
        filterState,
        targetRect: directOverlayTarget.rect,
        documentOrigin: directOverlayTarget.documentOrigin ?? directOverlayTarget.rect,
      });
    } else {
      applyFilmGrainOverlay({
        targetCtx: directOverlayTarget.ctx,
        filmNoiseFilter: directOverlayFilter,
        filterState,
        targetRect: directOverlayTarget.rect,
        documentOrigin: directOverlayTarget.documentOrigin ?? directOverlayTarget.rect,
      });
    }
    return sourceCanvas;
  }

  const workCanvasA = ensureDisplayFilterCanvas(
    filterState.workCanvasA,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  const workCanvasB = ensureDisplayFilterCanvas(
    filterState.workCanvasB,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  if (!workCanvasA || !workCanvasB) {
    return sourceCanvas;
  }

  filterState.workCanvasA = workCanvasA;
  filterState.workCanvasB = workCanvasB;

  let currentCanvas = sourceCanvas;
  let nextCanvas = workCanvasA;
  const auxCanvas = ensureDisplayFilterCanvas(
    filterState.auxCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  filterState.auxCanvas = auxCanvas;
  const bloomCanvas = ensureDisplayFilterCanvas(
    filterState.bloomCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  filterState.bloomCanvas = bloomCanvas;
  const channelCanvas = ensureDisplayFilterCanvas(
    filterState.channelCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  filterState.channelCanvas = channelCanvas;

  const origin = visibleRect ?? { x: 0, y: 0 };
  const pixelateFilter = getDisplayFilterByIdFromList(displayFilters, 'pixelate');
  const bloomFilter = getDisplayFilterByIdFromList(displayFilters, 'bloom');
  const roundPixelsFilter = getDisplayFilterByIdFromList(displayFilters, 'round-pixels');
  const colorGradeFilter = getDisplayFilterByIdFromList(displayFilters, 'color-grade');
  const lcdMaskFilter = getDisplayFilterByIdFromList(displayFilters, 'lcd-mask');
  const crtFilter = getDisplayFilterByIdFromList(displayFilters, 'crt');
  const ntseCrtFilter = getDisplayFilterByIdFromList(displayFilters, 'ntse-crt');
  const crtGridFilter = getDisplayFilterByIdFromList(displayFilters, 'crt-grid');
  const chromaticAberrationFilter = getDisplayFilterByIdFromList(displayFilters, 'chromatic-aberration');
  const noiseFilter = getDisplayFilterByIdFromList(displayFilters, 'noise');
  const filmNoiseFilter = getDisplayFilterByIdFromList(displayFilters, 'film-noise');
  const swap = (canvas) => {
    currentCanvas = canvas;
    nextCanvas = getNextFilterWorkCanvas(currentCanvas, workCanvasA, workCanvasB);
    return currentCanvas;
  };

  if (pixelateFilter?.enabled && getNumeric(pixelateFilter?.settings?.cellSize, 1) > 1) {
    const cellSize = resolveDisplayFilterPixelSize(pixelateFilter.settings.cellSize);
    const downsampleCanvas = ensureDisplayFilterCanvas(
      filterState.pixelateCanvas,
      Math.max(1, Math.round(currentCanvas.width / cellSize)),
      Math.max(1, Math.round(currentCanvas.height / cellSize)),
    );
    filterState.pixelateCanvas = downsampleCanvas;
    const downsampleCtx = clearDisplayFilterCanvas(downsampleCanvas);
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (downsampleCanvas && downsampleCtx && nextCtx) {
      downsampleCtx.imageSmoothingEnabled = true;
      downsampleCtx.drawImage(currentCanvas, 0, 0, downsampleCanvas.width, downsampleCanvas.height);
      nextCtx.imageSmoothingEnabled = false;
      nextCtx.drawImage(downsampleCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
      swap(nextCanvas);
    }
  }

  if (
    roundPixelsFilter?.enabled &&
    getNumeric(pixelateFilter?.settings?.cellSize, 1) > 1
  ) {
    const workCanvas = ensureDisplayFilterCanvas(
      filterState.auxCanvas,
      currentCanvas.width,
      currentCanvas.height,
    );
    filterState.auxCanvas = workCanvas;
    if (workCanvas && applyRoundPixelsWholeImage({
      currentCanvas,
      nextCanvas,
      workCanvas,
      blurRadius: getNumeric(roundPixelsFilter.settings.blurRadius, 0),
      threshold: getNumeric(roundPixelsFilter.settings.threshold, 0.5),
      crush: getNumeric(roundPixelsFilter.settings.crush, 0),
      preserveColor: getNumeric(roundPixelsFilter.settings.preserveColor, 0.85),
    })) {
      swap(nextCanvas);
    }
  }

  if (bloomFilter?.enabled && getNumeric(bloomFilter?.settings?.blurRadius, 0) > 0 && getNumeric(bloomFilter?.settings?.intensity, 0) > 0) {
    const bloomSourceCanvas = ensureDisplayFilterCanvas(
      bloomCanvas,
      Math.max(1, Math.round(currentCanvas.width / 4)),
      Math.max(1, Math.round(currentCanvas.height / 4)),
    );
    filterState.bloomCanvas = bloomSourceCanvas;
    const bloomSourceCtx = clearDisplayFilterCanvas(bloomSourceCanvas);
    const bloomBlurCanvas = ensureDisplayFilterCanvas(
      auxCanvas,
      Math.max(1, Math.round(currentCanvas.width / 4)),
      Math.max(1, Math.round(currentCanvas.height / 4)),
    );
    const bloomBlurCtx = clearDisplayFilterCanvas(bloomBlurCanvas);
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (bloomSourceCanvas && bloomSourceCtx && bloomBlurCanvas && bloomBlurCtx && nextCtx) {
      const blurRadius = resolveDownsampledDisplayFilterRadius(bloomFilter.settings.blurRadius, 0, 4);
      const intensity = getNumeric(bloomFilter.settings.intensity, 0);
      bloomSourceCtx.imageSmoothingEnabled = true;
      bloomSourceCtx.drawImage(currentCanvas, 0, 0, bloomSourceCanvas.width, bloomSourceCanvas.height);
      bloomBlurCtx.imageSmoothingEnabled = true;
      bloomBlurCtx.filter = `blur(${blurRadius}px)`;
      // Keep a visible low-frequency softness floor so bloom never disappears on mid-tone art.
      bloomBlurCtx.globalAlpha = Math.min(1, 0.18 + intensity * 0.16);
      bloomBlurCtx.drawImage(bloomSourceCanvas, 0, 0);
      extractBrightPass(bloomSourceCtx, bloomSourceCanvas);
      bloomBlurCtx.globalAlpha = Math.min(1, 0.55 + intensity * 0.35);
      bloomBlurCtx.globalCompositeOperation = 'lighter';
      bloomBlurCtx.drawImage(bloomSourceCanvas, 0, 0);
      bloomBlurCtx.filter = 'none';
      bloomBlurCtx.globalAlpha = 1;
      bloomBlurCtx.globalCompositeOperation = 'source-over';
      nextCtx.drawImage(currentCanvas, 0, 0);
      nextCtx.globalAlpha = Math.min(1, 0.45 + intensity * 0.45);
      nextCtx.globalCompositeOperation = 'screen';
      nextCtx.imageSmoothingEnabled = true;
      nextCtx.drawImage(bloomBlurCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
      nextCtx.globalAlpha = 1;
      nextCtx.globalCompositeOperation = 'source-over';
      swap(nextCanvas);
    }
  }

  if (colorGradeFilter?.enabled) {
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.filter = buildColorGradeFilter(colorGradeFilter);
      nextCtx.drawImage(currentCanvas, 0, 0);
      nextCtx.filter = 'none';
      swap(nextCanvas);
    }
  }

  if (lcdMaskFilter?.enabled && (getNumeric(lcdMaskFilter?.settings?.stripeOpacity, 0) > 0 || getNumeric(lcdMaskFilter?.settings?.scanlineOpacity, 0) > 0)) {
    const baseCell = resolveDisplayFilterPixelSize(pixelateFilter?.settings?.cellSize);
    const patternKey = JSON.stringify({
      baseCell,
      stripeOpacity: getNumeric(lcdMaskFilter.settings.stripeOpacity, 0),
      scanlineOpacity: getNumeric(lcdMaskFilter.settings.scanlineOpacity, 0),
    });
    if (filterState.lcdPatternKey !== patternKey) {
      const patternCanvas = ensureDisplayFilterCanvas(
        filterState.lcdPatternCanvas,
        baseCell * 3,
        Math.max(2, baseCell * 2),
      );
      const patternCtx = clearDisplayFilterCanvas(patternCanvas);
      if (patternCanvas && patternCtx) {
        const stripeWidth = Math.max(1, Math.ceil(patternCanvas.width / 3));
        patternCtx.fillStyle = `rgba(255, 96, 96, ${getNumeric(lcdMaskFilter.settings.stripeOpacity, 0)})`;
        patternCtx.fillRect(0, 0, stripeWidth, patternCanvas.height);
        patternCtx.fillStyle = `rgba(96, 255, 96, ${getNumeric(lcdMaskFilter.settings.stripeOpacity, 0)})`;
        patternCtx.fillRect(stripeWidth, 0, stripeWidth, patternCanvas.height);
        patternCtx.fillStyle = `rgba(96, 160, 255, ${getNumeric(lcdMaskFilter.settings.stripeOpacity, 0)})`;
        patternCtx.fillRect(stripeWidth * 2, 0, patternCanvas.width - stripeWidth * 2, patternCanvas.height);
        if (getNumeric(lcdMaskFilter.settings.scanlineOpacity, 0) > 0) {
          patternCtx.fillStyle = `rgba(0, 0, 0, ${getNumeric(lcdMaskFilter.settings.scanlineOpacity, 0)})`;
          patternCtx.fillRect(0, patternCanvas.height - 1, patternCanvas.width, 1);
        }
      }
      filterState.lcdPatternKey = patternKey;
      filterState.lcdPatternCanvas = patternCanvas;
    }

    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.drawImage(currentCanvas, 0, 0);
      const patternCanvas = filterState.lcdPatternCanvas;
      const pattern = patternCanvas ? nextCtx.createPattern(patternCanvas, 'repeat') : null;
      if (pattern && patternCanvas) {
        nextCtx.save();
        nextCtx.globalCompositeOperation = 'multiply';
        nextCtx.translate(
          -((origin.x % patternCanvas.width) + patternCanvas.width) % patternCanvas.width,
          -((origin.y % patternCanvas.height) + patternCanvas.height) % patternCanvas.height,
        );
        nextCtx.fillStyle = pattern;
        nextCtx.fillRect(0, 0, nextCanvas.width + patternCanvas.width, nextCanvas.height + patternCanvas.height);
        nextCtx.restore();
      }
      swap(nextCanvas);
    }
  }

  if (crtFilter?.enabled) {
    const crtCanvas = applyCrtWebGLFilter({
      currentCanvas,
      filterState,
      filter: crtFilter,
    });
    if (crtCanvas) {
      swap(crtCanvas);
    } else if (applyCrtWholeImage({
      currentCanvas,
      nextCanvas,
      bloomCanvas,
      workCanvas: auxCanvas,
      filter: crtFilter,
    })) {
      swap(nextCanvas);
    }
  }

  if (ntseCrtFilter?.enabled) {
    const ntseCrtCanvas = applyNtseCrtWebGLFilter({
      currentCanvas,
      filterState,
      filter: ntseCrtFilter,
    });
    if (ntseCrtCanvas) {
      swap(ntseCrtCanvas);
    } else {
      const settings = ntseCrtFilter.settings ?? {};
      const fallbackFilter = {
        settings: {
          cellSize: CRT_REFERENCE_CELL_SIZE,
          scanlineSize: Math.min(3, Math.max(0.5, getNumeric(settings.scanlineSize, 1))),
          scanlineIntensity: clamp01(settings.scanlineStrength),
          maskIntensity: 0,
          barrelDistortion: 0,
          chromaticAberration: clamp01(settings.signalSmear) * 2.5,
          beamFocus: 0.7,
          brightness: 0.75,
          shadowLift: 0.08,
          vignetteIntensity: 0,
          signalArtifacts: clamp01(settings.signalSmear),
          signalNoise: clamp01(settings.signalNoise),
          bloomIntensity: clamp01(settings.glowStrength) * 2,
          bloomRadius: 18,
        },
      };
      if (applyCrtWholeImage({
        currentCanvas,
        nextCanvas,
        bloomCanvas,
        workCanvas: auxCanvas,
        filter: fallbackFilter,
      })) {
        swap(nextCanvas);
      }
    }
  }

  if (crtGridFilter?.enabled && getNumeric(crtGridFilter?.settings?.lineOpacity, 0) > 0) {
    const baseCell = resolveDisplayFilterPixelSize(pixelateFilter?.settings?.cellSize);
    const spacing = Math.max(1, Math.round(getNumeric(crtGridFilter?.settings?.lineSpacing, 4) * baseCell));
    const phosphorOpacity = getNumeric(crtGridFilter.settings.phosphorOpacity, 0.12);
    const scanlineOpacity = getNumeric(crtGridFilter.settings.scanlineOpacity, 0.18);
    const patternKey = JSON.stringify({
      spacing,
      lineOpacity: getNumeric(crtGridFilter.settings.lineOpacity, 0),
      phosphorOpacity,
      scanlineOpacity,
    });
    if (filterState.crtGridPatternKey !== patternKey) {
      const patternCanvas = ensureDisplayFilterCanvas(filterState.crtGridPatternCanvas, spacing, spacing);
      const glowCanvas = ensureDisplayFilterCanvas(filterState.crtGridGlowCanvas, spacing * 3, spacing);
      const patternCtx = clearDisplayFilterCanvas(patternCanvas);
      const glowCtx = clearDisplayFilterCanvas(glowCanvas);
      if (patternCanvas && patternCtx && glowCanvas && glowCtx) {
        const lineOpacity = getNumeric(crtGridFilter.settings.lineOpacity, 0);
        const scanlineHeight = 1;
        const maskTop = patternCanvas.height - scanlineHeight;
        const separatorOpacity = Math.min(1, lineOpacity * 0.72);
        const apertureOpacity = Math.min(1, lineOpacity * 0.5);

        if (patternCanvas.width > 1) {
          patternCtx.fillStyle = `rgba(0, 0, 0, ${apertureOpacity})`;
          patternCtx.fillRect(patternCanvas.width - 1, 0, 1, patternCanvas.height);
        } else {
          patternCtx.fillStyle = `rgba(0, 0, 0, ${Math.min(1, apertureOpacity * 0.45)})`;
          patternCtx.fillRect(0, 0, 1, patternCanvas.height);
        }
        patternCtx.fillStyle = `rgba(0, 0, 0, ${separatorOpacity})`;
        patternCtx.fillRect(0, maskTop, patternCanvas.width, scanlineHeight);
        patternCtx.fillStyle = `rgba(255, 255, 255, ${lineOpacity * 0.04})`;
        patternCtx.fillRect(0, 0, patternCanvas.width, 1);

        const glowColors = [
          `rgba(255, 110, 96, ${phosphorOpacity})`,
          `rgba(116, 255, 120, ${phosphorOpacity})`,
          `rgba(110, 174, 255, ${phosphorOpacity})`,
        ];
        const stripeWidth = spacing;
        const glowInset = Math.max(0, Math.floor(stripeWidth * 0.15));
        const glowWidth = Math.max(1, stripeWidth - glowInset * 2);
        const glowHeight = Math.max(1, patternCanvas.height - scanlineHeight);
        for (let channel = 0; channel < 3; channel += 1) {
          const x = channel * stripeWidth + glowInset;
          glowCtx.fillStyle = glowColors[channel];
          glowCtx.fillRect(x, 0, glowWidth, glowHeight);
        }
        glowCtx.fillStyle = `rgba(255, 255, 255, ${phosphorOpacity * 0.22})`;
        glowCtx.fillRect(0, 0, patternCanvas.width, 1);
      }
      filterState.crtGridPatternKey = patternKey;
      filterState.crtGridPatternCanvas = patternCanvas;
      filterState.crtGridGlowCanvas = glowCanvas;
    }

    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.drawImage(currentCanvas, 0, 0);
      const patternCanvas = filterState.crtGridPatternCanvas;
      const glowCanvas = filterState.crtGridGlowCanvas;
      const pattern = patternCanvas ? nextCtx.createPattern(patternCanvas, 'repeat') : null;
      const glowPattern = glowCanvas ? nextCtx.createPattern(glowCanvas, 'repeat') : null;
      if (pattern && patternCanvas) {
        nextCtx.save();
        nextCtx.globalCompositeOperation = 'multiply';
        nextCtx.translate(
          -((origin.x % patternCanvas.width) + patternCanvas.width) % patternCanvas.width,
          -((origin.y % patternCanvas.height) + patternCanvas.height) % patternCanvas.height,
        );
        nextCtx.fillStyle = pattern;
        nextCtx.fillRect(0, 0, nextCanvas.width + patternCanvas.width, nextCanvas.height + patternCanvas.height);
        nextCtx.restore();
      }
      if (glowPattern && glowCanvas && phosphorOpacity > 0) {
        nextCtx.save();
        nextCtx.globalCompositeOperation = 'screen';
        nextCtx.translate(
          -((origin.x % glowCanvas.width) + glowCanvas.width) % glowCanvas.width,
          -((origin.y % glowCanvas.height) + glowCanvas.height) % glowCanvas.height,
        );
        nextCtx.fillStyle = glowPattern;
        nextCtx.fillRect(0, 0, nextCanvas.width + glowCanvas.width, nextCanvas.height + glowCanvas.height);
        nextCtx.restore();
      }
      swap(nextCanvas);
    }
  }

  if (
    chromaticAberrationFilter?.enabled
    && getNumeric(chromaticAberrationFilter?.settings?.offset, 0) > 0
    && getNumeric(chromaticAberrationFilter?.settings?.intensity, 0) > 0
  ) {
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    const channelCtx = clearDisplayFilterCanvas(channelCanvas);
    if (nextCtx && channelCanvas && channelCtx) {
      const offset = resolveDisplayFilterRadius(chromaticAberrationFilter.settings.offset, 0, 0.5);
      const intensity = getNumeric(chromaticAberrationFilter.settings.intensity, 0);
      nextCtx.drawImage(currentCanvas, 0, 0);

      channelCtx.drawImage(currentCanvas, 0, 0);
      channelCtx.globalCompositeOperation = 'multiply';
      channelCtx.fillStyle = 'rgb(255, 0, 0)';
      channelCtx.fillRect(0, 0, channelCanvas.width, channelCanvas.height);
      channelCtx.globalCompositeOperation = 'destination-in';
      channelCtx.drawImage(currentCanvas, 0, 0);

      nextCtx.save();
      nextCtx.globalAlpha = Math.min(1, intensity);
      nextCtx.globalCompositeOperation = 'screen';
      nextCtx.drawImage(channelCanvas, -offset, 0.25 * offset);
      nextCtx.restore();

      clearDisplayFilterCanvas(channelCanvas);
      const blueChannelCtx = channelCanvas.getContext('2d', { willReadFrequently: true });
      if (blueChannelCtx) {
        blueChannelCtx.drawImage(currentCanvas, 0, 0);
        blueChannelCtx.globalCompositeOperation = 'multiply';
        blueChannelCtx.fillStyle = 'rgb(0, 96, 255)';
        blueChannelCtx.fillRect(0, 0, channelCanvas.width, channelCanvas.height);
        blueChannelCtx.globalCompositeOperation = 'destination-in';
        blueChannelCtx.drawImage(currentCanvas, 0, 0);
      }

      nextCtx.save();
      nextCtx.globalAlpha = Math.min(1, intensity);
      nextCtx.globalCompositeOperation = 'screen';
      nextCtx.drawImage(channelCanvas, offset, -0.25 * offset);
      nextCtx.restore();

      swap(nextCanvas);
    }
  }

  if (noiseFilter?.enabled && getNumeric(noiseFilter?.settings?.opacity, 0) > 0) {
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.drawImage(currentCanvas, 0, 0);
      applyDisplayNoiseOverlay({
        targetCtx: nextCtx,
        noiseFilter,
        filterState,
        targetRect: {
          x: 0,
          y: 0,
          width: nextCanvas.width,
          height: nextCanvas.height,
        },
        documentOrigin: origin,
      });
      swap(nextCanvas);
    }
  }

  if (filmNoiseFilter?.enabled && getNumeric(filmNoiseFilter?.settings?.opacity, 0) > 0) {
    const nextCtx = clearDisplayFilterCanvas(nextCanvas);
    if (nextCtx) {
      nextCtx.drawImage(currentCanvas, 0, 0);
      applyFilmGrainOverlay({
        targetCtx: nextCtx,
        filmNoiseFilter,
        filterState,
        targetRect: {
          x: 0,
          y: 0,
          width: nextCanvas.width,
          height: nextCanvas.height,
        },
        documentOrigin: origin,
      });
      swap(nextCanvas);
    }
  }

  return currentCanvas;
};

const adjustmentRgbToHsl = (r, g, b) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  if (max === min) {
    return [0, 0, lightness * 100];
  }
  const delta = max - min;
  const saturation = lightness > 0.5
    ? delta / (2 - max - min)
    : delta / (max + min);
  let hue;
  if (max === red) {
    hue = (green - blue) / delta + (green < blue ? 6 : 0);
  } else if (max === green) {
    hue = (blue - red) / delta + 2;
  } else {
    hue = (red - green) / delta + 4;
  }
  return [(hue / 6) * 360, saturation * 100, lightness * 100];
};

const adjustmentHslToRgb = (h, s, l) => {
  const hue = h / 360;
  const saturation = s / 100;
  const lightness = l / 100;
  if (saturation === 0) {
    const gray = Math.round(lightness * 255);
    return [gray, gray, gray];
  }
  const hueToRgb = (p, q, value) => {
    let wrapped = value;
    if (wrapped < 0) wrapped += 1;
    if (wrapped > 1) wrapped -= 1;
    if (wrapped < 1 / 6) return p + (q - p) * 6 * wrapped;
    if (wrapped < 1 / 2) return q;
    if (wrapped < 2 / 3) return p + (q - p) * (2 / 3 - wrapped) * 6;
    return p;
  };
  const q = lightness < 0.5
    ? lightness * (1 + saturation)
    : lightness + saturation - lightness * saturation;
  const p = 2 * lightness - q;
  return [
    Math.round(hueToRgb(p, q, hue + 1 / 3) * 255),
    Math.round(hueToRgb(p, q, hue) * 255),
    Math.round(hueToRgb(p, q, hue - 1 / 3) * 255),
  ];
};

const clampAdjustmentByte = (value) => Math.max(0, Math.min(255, Math.round(value)));

const applyHueSatAdjustment = ({ sourceCanvas, targetCanvas, settings }) => {
  const sourceCtx = sourceCanvas.getContext('2d', { willReadFrequently: true });
  const targetCtx = clearDisplayFilterCanvas(targetCanvas);
  if (!sourceCtx || !targetCtx) {
    return sourceCanvas;
  }
  const imageData = sourceCtx.getImageData(0, 0, sourceCanvas.width, sourceCanvas.height);
  const data = imageData.data;
  const hueShift = Math.max(-180, Math.min(180, getNumeric(settings?.hue, 0)));
  const saturationFactor = Math.max(0, Math.min(200, 100 + getNumeric(settings?.saturation, 0))) / 100;
  const vibrance = Math.max(-100, Math.min(100, getNumeric(settings?.vibrance, 0)));
  const lightnessAdjust = Math.max(-100, Math.min(100, getNumeric(settings?.lightness, 0)));
  const contrastValue = Math.max(-255, Math.min(255, Math.round(getNumeric(settings?.contrast, 0) * 2.55)));
  const contrastFactor = contrastValue === 0
    ? 1
    : (259 * (contrastValue + 255)) / (255 * (259 - contrastValue));
  const redOffset = Math.max(-255, Math.min(255, Math.round(getNumeric(settings?.red, 0) * 2.55)));
  const greenOffset = Math.max(-255, Math.min(255, Math.round(getNumeric(settings?.green, 0) * 2.55)));
  const blueOffset = Math.max(-255, Math.min(255, Math.round(getNumeric(settings?.blue, 0) * 2.55)));
  const rangeEnabled = settings?.hueRangeEnabled === true;
  const rawRangeStart = getNumeric(settings?.hueRangeStart, 0);
  const rawRangeEnd = getNumeric(settings?.hueRangeEnd, 360);
  const rangeStart = ((rawRangeStart % 360) + 360) % 360;
  const rangeEnd = ((rawRangeEnd % 360) + 360) % 360;
  const rangeCoversFullCircle = Math.abs(rawRangeEnd - rawRangeStart) >= 360;
  const isHueInRange = (hue) => {
    if (!rangeEnabled || rangeCoversFullCircle) return true;
    return rangeStart <= rangeEnd
      ? hue >= rangeStart && hue <= rangeEnd
      : hue >= rangeStart || hue <= rangeEnd;
  };

  for (let index = 0; index < data.length; index += 4) {
    if (data[index + 3] === 0) continue;
    const [sourceHue, sourceSaturation, sourceLightness] = adjustmentRgbToHsl(
      data[index],
      data[index + 1],
      data[index + 2],
    );
    if (!isHueInRange(sourceHue)) continue;
    const nextHue = (sourceHue + hueShift + 360) % 360;
    let nextSaturation = Math.max(0, Math.min(100, sourceSaturation * saturationFactor));
    if (vibrance > 0) {
      nextSaturation += (100 - nextSaturation) * (vibrance / 100);
    } else if (vibrance < 0) {
      nextSaturation += nextSaturation * (vibrance / 100);
    }
    const nextLightness = Math.max(0, Math.min(100, sourceLightness + lightnessAdjust));
    let [red, green, blue] = adjustmentHslToRgb(nextHue, nextSaturation, nextLightness);
    if (contrastValue !== 0) {
      red = contrastFactor * (red - 128) + 128;
      green = contrastFactor * (green - 128) + 128;
      blue = contrastFactor * (blue - 128) + 128;
    }
    data[index] = clampAdjustmentByte(red + redOffset);
    data[index + 1] = clampAdjustmentByte(green + greenOffset);
    data[index + 2] = clampAdjustmentByte(blue + blueOffset);
  }
  targetCtx.putImageData(imageData, 0, 0);
  return targetCanvas;
};

export const applyAdjustmentEffect = ({
  sourceCanvas,
  effect,
  mix = 1,
  filterState,
  visibleRect,
  lengthScale = 1,
}) => {
  if (!sourceCanvas || !effect || !filterState) {
    return sourceCanvas;
  }
  const resolvedMix = clamp01(mix);
  if (resolvedMix <= 0) {
    return sourceCanvas;
  }

  if (effect.id === 'hue-sat') {
    const settings = effect.settings ?? {};
    const isNoop = [
      settings.hue,
      settings.saturation,
      settings.vibrance,
      settings.lightness,
      settings.contrast,
      settings.red,
      settings.green,
      settings.blue,
    ].every((value) => getNumeric(value, 0) === 0);
    if (isNoop) {
      return sourceCanvas;
    }
  }

  let adjustedCanvas = sourceCanvas;
  if (effect.id === 'hue-sat') {
    const targetCanvas = ensureDisplayFilterCanvas(
      filterState.workCanvasA,
      sourceCanvas.width,
      sourceCanvas.height,
    );
    filterState.workCanvasA = targetCanvas;
    if (targetCanvas) {
      adjustedCanvas = applyHueSatAdjustment({
        sourceCanvas,
        targetCanvas,
        settings: effect.settings,
      });
    }
  } else if (
    effect.id === 'color-grade'
    || effect.id === 'pixelate'
    || effect.id === 'bloom'
  ) {
    adjustedCanvas = applyDisplayFilterStack({
      sourceCanvas,
      displayFilters: [{ id: effect.id, enabled: true, settings: effect.settings }],
      filterState,
      visibleRect,
      lengthScale,
    });
  }

  if (resolvedMix >= 1 || adjustedCanvas === sourceCanvas) {
    return adjustedCanvas;
  }
  const mixCanvas = ensureDisplayFilterCanvas(
    filterState.adjustmentMixCanvas,
    sourceCanvas.width,
    sourceCanvas.height,
  );
  filterState.adjustmentMixCanvas = mixCanvas;
  const mixCtx = clearDisplayFilterCanvas(mixCanvas);
  if (!mixCanvas || !mixCtx) {
    return adjustedCanvas;
  }
  mixCtx.globalAlpha = 1 - resolvedMix;
  mixCtx.drawImage(sourceCanvas, 0, 0);
  mixCtx.globalCompositeOperation = 'lighter';
  mixCtx.globalAlpha = resolvedMix;
  mixCtx.drawImage(adjustedCanvas, 0, 0);
  mixCtx.globalAlpha = 1;
  mixCtx.globalCompositeOperation = 'source-over';
  return mixCanvas;
};
