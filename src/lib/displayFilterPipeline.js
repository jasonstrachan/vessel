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

const FILM_GRAIN_MODEL_VERSION = 11;
const FILM_GRAIN_PLATE_SIZE = 768;
const FILM_GRAIN_MIN_CLUSTERS = 24;
const FILM_GRAIN_MAX_CLUSTERS = 10000;
const FILM_GRAIN_SEED = 0x6d2b79f5;
const FILM_GRAIN_FIELD_SUPPORT_SCALE = 1.6;
const FILM_GRAIN_FIELD_THRESHOLD = 0.42;
const FILM_GRAIN_FIELD_THRESHOLD_VARIATION = 0.035;
const FILM_GRAIN_FIELD_JITTER = 0.045;
const FILM_GRAIN_FIELD_FEATHER = 0.07;
const FILM_GRAIN_DENSITY_LATTICE_CELLS = 8;
const FILM_GRAIN_MIN_DISPLAY_SCALE = 0.2;
const FILM_GRAIN_DEFAULT_SIZE = 1.5;
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
  if (familyIndex < 6) {
    return 'single';
  }
  if (familyIndex < 14) {
    return 'chain';
  }
  return 'island';
};

const resolveFilmGrainLobeCount = (family, random) => {
  if (family === 'single') {
    return 1;
  }
  if (family === 'chain') {
    return 4 + Math.floor(random() * 6);
  }
  return 8 + Math.floor(random() * 9);
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
      Math.round((resolvedPlateSize * resolvedPlateSize) / (resolvedGrainSize ** 2 * 62)),
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
  targetCtx.save();
  targetCtx.globalAlpha = darkAlpha;
  targetCtx.globalCompositeOperation = 'multiply';
  targetCtx.drawImage(
    overlays.darkCanvas,
    0,
    0,
    overlays.darkCanvas.width,
    overlays.darkCanvas.height,
    targetRect.x,
    targetRect.y,
    targetRect.width,
    targetRect.height,
  );
  targetCtx.restore();
  targetCtx.save();
  targetCtx.globalAlpha = lightAlpha;
  targetCtx.globalCompositeOperation = 'screen';
  targetCtx.drawImage(
    overlays.lightCanvas,
    0,
    0,
    overlays.lightCanvas.width,
    overlays.lightCanvas.height,
    targetRect.x,
    targetRect.y,
    targetRect.width,
    targetRect.height,
  );
  targetCtx.restore();
  return true;
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
  timeSeconds,
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
  const bloomIntensity = Math.max(0, getNumeric(filter?.settings?.bloomIntensity, 0));
  const bloomRadius = Math.max(0, getNumeric(filter?.settings?.bloomRadius, 0));
  const beamExponent = mix(3.4, 0.55, beamFocus);
  const brightnessGain = 0.72 + brightness * 0.56;
  const flickerSeed = Math.floor(timeSeconds * 60);
  const flicker = 1 + (hashNoise(flickerSeed, 0, 0.173) - 0.5) * flickerIntensity * 0.22;
  const cellHeight = Math.max(3, Math.round(cellSize * 0.92));
  const triadWidth = Math.max(1, cellSize / 3);
  const scanlinePeriod = Math.max(2, Math.round(Math.max(2, cellSize * 0.5)));
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
      const artifactNoise = (hashNoise(x + flickerSeed * 13, y, 0.277) - 0.5) * signalArtifacts * 0.09;
      const gain = scanline * vignette * flicker * maskAlpha;

      output[index] = Math.round(clamp01((r * brightnessGain + lift + artifactNoise) * gain * maskWeights[0]) * 255);
      output[index + 1] = Math.round(clamp01((g * brightnessGain + lift + artifactNoise * 0.7) * gain * maskWeights[1]) * 255);
      output[index + 2] = Math.round(clamp01((b * brightnessGain + lift + artifactNoise * 0.45) * gain * maskWeights[2]) * 255);
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
  const crtGridFilter = getDisplayFilterByIdFromList(displayFilters, 'crt-grid');
  const chromaticAberrationFilter = getDisplayFilterByIdFromList(displayFilters, 'chromatic-aberration');
  const noiseFilter = getDisplayFilterByIdFromList(displayFilters, 'noise');
  const filmNoiseFilter = getDisplayFilterByIdFromList(displayFilters, 'film-noise');
  const timeSeconds = Date.now() / 1000;

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

  if (crtFilter?.enabled && applyCrtWholeImage({
    currentCanvas,
    nextCanvas,
    bloomCanvas,
    workCanvas: auxCanvas,
    filter: crtFilter,
    timeSeconds,
  })) {
    swap(nextCanvas);
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
