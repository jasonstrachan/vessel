export const GOBLET_SPEED_BYTE_RANGE = 254;

export const GOBLET_FLOW_MODE_LEGACY = 0;
export const GOBLET_FLOW_MODE_FORWARD = 1;
export const GOBLET_FLOW_MODE_REVERSE = 2;
export const GOBLET_FLOW_MODE_PINGPONG = 3;
export const GOBLET_MAX_SLOT_ID = 255;

export const decodeColorCycleSpeedByte = (
  byte,
  minSpeed,
  maxSpeed,
  defaultMinSpeed = 0.01,
  defaultMaxSpeed = 2.64,
) => {
  if (!Number.isFinite(byte) || byte <= 0) {
    return 0;
  }
  const minV = Number.isFinite(minSpeed) ? Number(minSpeed) : defaultMinSpeed;
  const maxV = Number.isFinite(maxSpeed) ? Number(maxSpeed) : defaultMaxSpeed;
  const normalized = Math.max(0, Math.min(GOBLET_SPEED_BYTE_RANGE, Math.round(byte) - 1));
  const t = normalized / GOBLET_SPEED_BYTE_RANGE;
  return minV + t * (maxV - minV);
};

export const resolveGobletFlowMode = (flowMode) => {
  if (flowMode === GOBLET_FLOW_MODE_REVERSE) {
    return GOBLET_FLOW_MODE_REVERSE;
  }
  if (flowMode === GOBLET_FLOW_MODE_PINGPONG) {
    return GOBLET_FLOW_MODE_PINGPONG;
  }
  return GOBLET_FLOW_MODE_FORWARD;
};

export const getGobletFlowModeIndex = (flowMode) => {
  const resolved = resolveGobletFlowMode(flowMode);
  if (resolved === GOBLET_FLOW_MODE_REVERSE) {
    return 1;
  }
  if (resolved === GOBLET_FLOW_MODE_PINGPONG) {
    return 2;
  }
  return 0;
};

export const hasGobletNonForwardFlow = (flowBuffer) => {
  if (!flowBuffer || !flowBuffer.length) {
    return false;
  }
  for (let index = 0; index < flowBuffer.length; index += 1) {
    if (resolveGobletFlowMode(flowBuffer[index] | 0) !== GOBLET_FLOW_MODE_FORWARD) {
      return true;
    }
  }
  return false;
};

export const normalizeGobletFlowBuffer = (
  flowBuffer,
  gradientIdBuffer,
  expectedLength,
  flowSlotBits = 8,
) => {
  const length = Math.max(0, Math.round(Number(expectedLength) || 0));
  const out = new Uint8Array(length);
  out.fill(GOBLET_FLOW_MODE_FORWARD);
  if (flowBuffer && flowBuffer.length > 0) {
    for (let index = 0; index < length; index += 1) {
      out[index] = resolveGobletFlowMode(flowBuffer[index] ?? GOBLET_FLOW_MODE_FORWARD);
    }
    return out;
  }
  if (gradientIdBuffer && gradientIdBuffer.length > 0) {
    for (let index = 0; index < length; index += 1) {
      out[index] = resolveGobletFlowMode((gradientIdBuffer[index] ?? 0) >> flowSlotBits);
    }
  }
  return out;
};

export const wrapGobletPhase01 = (phase) => {
  const wrapped = phase % 1;
  return wrapped < 0 ? wrapped + 1 : wrapped;
};

export const resolveGobletPhase01 = (basePhase, phaseByte = 0) => (
  wrapGobletPhase01((Number.isFinite(basePhase) ? basePhase : 0) + (Number(phaseByte) || 0) / 256)
);

export const foldGobletPingpongPhase = (phase) => {
  const wrapped = wrapGobletPhase01(phase);
  return wrapped < 0.5 ? wrapped * 2 : (1 - wrapped) * 2;
};

export const resolveGobletPalettePosition = (
  baseIndex,
  phase,
  flowMode,
  paletteSize,
) => {
  const size = Math.max(1, Math.round(Number(paletteSize) || 0));
  const resolvedPhase = wrapGobletPhase01(phase);
  let position;
  if (resolveGobletFlowMode(flowMode) === GOBLET_FLOW_MODE_REVERSE) {
    position = baseIndex + resolvedPhase * size;
  } else if (resolveGobletFlowMode(flowMode) === GOBLET_FLOW_MODE_PINGPONG) {
    position = baseIndex - foldGobletPingpongPhase(resolvedPhase) * size;
  } else {
    position = baseIndex - resolvedPhase * size;
  }
  const wrapped = position % size;
  return wrapped < 0 ? wrapped + size : wrapped;
};

export const clampGobletSlotId = (slot, maxSlotId = GOBLET_MAX_SLOT_ID) => {
  const maxSlot = Math.max(0, Math.round(Number(maxSlotId) || 0));
  const numeric = Number(slot);
  if (!Number.isFinite(numeric)) {
    return 0;
  }
  return Math.max(0, Math.min(maxSlot, Math.round(numeric)));
};

export const resolveGobletGradientSlot = (gradientId, flowSlotMask = GOBLET_MAX_SLOT_ID) => (
  (Number(gradientId) || 0) & flowSlotMask
);

export const resolveGobletPaletteRow = (
  gradientId,
  slotCount,
  flowSlotMask = GOBLET_MAX_SLOT_ID,
) => {
  const rowCount = Math.max(1, Math.round(Number(slotCount) || 0));
  return Math.min(resolveGobletGradientSlot(gradientId, flowSlotMask), rowCount - 1);
};

export const resolveGobletPaletteIndex = (
  rawIndex,
  paletteSize,
  subtractOne = false,
) => {
  const size = Math.max(1, Math.round(Number(paletteSize) || 0));
  const numeric = Number(rawIndex) || 0;
  const effective = subtractOne && numeric > 0 ? numeric - 1 : numeric;
  return Math.max(0, Math.min(size - 1, Math.round(effective)));
};

const clamp01 = (value) => {
  if (value <= 0) {
    return 0;
  }
  if (value >= 1) {
    return 1;
  }
  return value;
};

const hashSierraLite32 = (a, b, c, d) => {
  let n =
    Math.imul((a | 0) ^ 0x9e3779b9, 374761393) +
    Math.imul((b | 0) ^ 0x85ebca6b, 668265263) +
    Math.imul((c | 0) ^ 0xc2b2ae35, 1274126177) +
    Math.imul((d | 0) ^ 0x27d4eb2d, 1597334677);
  n = (n ^ (n >>> 13)) >>> 0;
  n = Math.imul(n, 1274126177) >>> 0;
  n = (n ^ (n >>> 16)) >>> 0;
  return n >>> 0;
};

const resolveSierraLiteNoise = (x, y, identityKey, seed, variant, patternKey) => {
  const hash = hashSierraLite32(
    x + variant * 17,
    y + variant * 31,
    identityKey ^ seed,
    patternKey ^ (variant << 24),
  );
  return (hash & 1023) / 1023;
};

const resolveSierraLiteInitialError = (x, y, identityKey, seed, variant, patternKey) => {
  const first = resolveSierraLiteNoise(x, y, identityKey, seed, variant, patternKey) - 0.5;
  const second = resolveSierraLiteNoise(
    x + 37,
    y - 19,
    identityKey ^ 11,
    seed ^ 23,
    variant ^ 3,
    patternKey ^ 0x5a5a,
  ) - 0.5;
  switch (variant) {
    case 0: return first * 0.06;
    case 1: return (((x + y) & 1) === 0 ? 1 : -1) * 0.035 + first * 0.025;
    case 2: return ((x & 1) === 0 ? 1 : -1) * 0.03 + first * 0.02;
    case 3: return ((((x + y) & 3) - 1.5) / 1.5) * 0.03 + first * 0.02;
    case 4: return first * 0.03 + second * 0.03;
    case 5: return ((y & 1) === 0 ? 1 : -1) * 0.03 + first * 0.025;
    case 6: return ((((x - y) & 3) - 1.5) / 1.5) * 0.028 + first * 0.022;
    default: return first * 0.025 + second * 0.035;
  }
};

const SIERRA_LITE_VARIETY_ERROR_SCALE = 8;

/**
 * Build deterministic, zero-centred perturbations around canonical Sierra
 * Lite. Zero Variety uses the unmodified input mix; increasing Variety only
 * introduces seeded alternatives and never changes tone. The diffusion kernel
 * still owns quantization and error spread.
 */
export const createSierraLiteVarietyResolver = ({
  mix,
  seed = 0,
  phaseX = 0,
  phaseY = 0,
  identityKey = 0,
  lowKey = 0,
  highKey = 1,
  diversity = 1,
}) => {
  const diversity01 = clamp01(Number.isFinite(diversity) ? diversity : 1);
  const baseMix = clamp01(Number.isFinite(mix) ? mix : 0.5);
  const mixKey = Math.round(baseMix * 255) & 255;
  const normalizedLowKey = Number(lowKey) & 255;
  const normalizedHighKey = Number(highKey) & 255;
  const normalizedSeed = Number(seed) >>> 0;
  const seedPhaseX = normalizedSeed & 7;
  const seedPhaseY = (normalizedSeed >>> 3) & 7;
  const patternKey =
    (mixKey << 16)
    ^ (normalizedLowKey << 8)
    ^ normalizedHighKey
    ^ Math.imul(normalizedSeed, 0x9e3779b1);
  const variant = hashSierraLite32(
    normalizedSeed,
    patternKey,
    normalizedSeed ^ patternKey,
    0x51f15e,
  ) & 7;
  const variationScale = Math.sqrt(diversity01) * SIERRA_LITE_VARIETY_ERROR_SCALE;
  const resolve = (x, y) => {
    if (diversity01 <= 0) {
      return 0;
    }
    return resolveSierraLiteInitialError(
      x + phaseX + seedPhaseX,
      y + phaseY + seedPhaseY,
      identityKey,
      normalizedSeed,
      variant,
      patternKey,
    ) * variationScale;
  };

  return {
    baseMix,
    resolve,
    resolveThreshold: (x, y) => {
      const seededX = x + phaseX + seedPhaseX;
      const seededY = y + phaseY + seedPhaseY;
      const noise = resolveSierraLiteNoise(
        seededX,
        seededY,
        identityKey,
        normalizedSeed,
        variant,
        patternKey,
      );
      const amplitude = [0.03, 0.045, 0.035, 0.05, 0.04, 0.055, 0.038, 0.048][variant];
      const threshold = 0.5 + (noise - 0.5) * amplitude;
      return 0.5 + (threshold - 0.5) * diversity01;
    },
  };
};

/**
 * Exact binary Sierra Lite field shared by Vessel flat fills and Interlace playback.
 * Values are 0 for the low source and 1 for the high source.
 * @param {{
 *   width: number,
 *   height: number,
 *   mix: number,
 *   seed?: number,
 *   phaseX?: number,
 *   phaseY?: number,
 *   identityKey?: number,
 *   lowKey?: number,
 *   highKey?: number,
 *   diversity?: number,
 *   activeMask?: Uint8Array | null,
 *   mixField?: Float32Array | null,
 * }} options
 * @returns {Uint8Array}
 */
export const resolveSierraLiteBinaryField = ({
  width,
  height,
  mix,
  seed = 0,
  phaseX = 0,
  phaseY = 0,
  identityKey = 0,
  lowKey = 0,
  highKey = 1,
  diversity = 1,
  activeMask = null,
  mixField = null,
}) => {
  const gridWidth = Math.max(0, Math.round(Number(width) || 0));
  const gridHeight = Math.max(0, Math.round(Number(height) || 0));
  const output = new Uint8Array(gridWidth * gridHeight);
  if (gridWidth === 0 || gridHeight === 0) {
    return output;
  }
  const errors = new Float32Array(output.length);
  const diversity01 = clamp01(Number.isFinite(diversity) ? diversity : 1);
  const variety = createSierraLiteVarietyResolver({
    mix,
    seed,
    phaseX,
    phaseY,
    identityKey,
    lowKey,
    highKey,
    diversity,
  });

  for (let y = 0; y < gridHeight; y += 1) {
    const serpentine = diversity01 > 0 && (y & 1) === 1;
    const start = serpentine ? gridWidth - 1 : 0;
    const end = serpentine ? -1 : gridWidth;
    const step = serpentine ? -1 : 1;
    for (let x = start; x !== end; x += step) {
      const index = y * gridWidth + x;
      if (activeMask && !activeMask[index]) {
        continue;
      }
      const cellMix = mixField && Number.isFinite(mixField[index])
        ? clamp01(mixField[index])
        : variety.baseMix;
      const isEndpoint = cellMix <= 0 || cellMix >= 1;
      const value = isEndpoint
        ? cellMix
        : clamp01(cellMix + variety.resolve(x, y) + errors[index]);
      const bit = isEndpoint
        ? (cellMix >= 1 ? 1 : 0)
        : (value >= variety.resolveThreshold(x, y) ? 1 : 0);
      output[index] = bit;
      const quantizationError = isEndpoint ? 0 : value - bit;
      const nextX = serpentine ? x - 1 : x + 1;
      if (nextX >= 0 && nextX < gridWidth) {
        const nextIndex = index + (serpentine ? -1 : 1);
        if (!activeMask || activeMask[nextIndex]) errors[nextIndex] += quantizationError * 0.5;
      }
      if (y + 1 < gridHeight) {
        const diagonalX = serpentine ? x + 1 : x - 1;
        if (diagonalX >= 0 && diagonalX < gridWidth) {
          const diagonalIndex = index + gridWidth + (serpentine ? 1 : -1);
          if (!activeMask || activeMask[diagonalIndex]) errors[diagonalIndex] += quantizationError * 0.25;
        }
        const belowIndex = index + gridWidth;
        if (!activeMask || activeMask[belowIndex]) errors[belowIndex] += quantizationError * 0.25;
      }
    }
  }
  return output;
};

export const rollSierraLiteBinaryField = (field, width, height, motionCells) => {
  const gridWidth = Math.max(1, Math.round(Number(width) || 1));
  const gridHeight = Math.max(0, Math.round(Number(height) || 0));
  const shift = ((Math.round(Number(motionCells) || 0) % gridWidth) + gridWidth) % gridWidth;
  if (shift === 0) return field;
  const output = new Uint8Array(gridWidth * gridHeight);
  for (let y = 0; y < gridHeight; y += 1) {
    const rowOffset = y * gridWidth;
    for (let x = 0; x < gridWidth; x += 1) {
      const sourceX = (x - shift + gridWidth) % gridWidth;
      output[rowOffset + x] = field[rowOffset + sourceX] ?? 0;
    }
  }
  return output;
};

const INTERLACE_PATTERN_RHYTHM = [1, 1, 1, 1, 1, 4];
const INTERLACE_RHYTHM_HEIGHT = INTERLACE_PATTERN_RHYTHM.reduce(
  (total, scale) => total + scale,
  0,
);
const SIERRA_TRAVEL_ROW_RHYTHM = [
  2, 1, 1, 1, 1, 1, 1, 1,
  2, 1, 1, 1, 2, 3, 1, 1,
  2, 1,
];
// All Sierra band widths repeat after the least common multiple of the
// 2x, 4x, and 6x checker periods produced by the 1, 2, and 3 scale bands.
const SIERRA_TRAVEL_PERIOD_UNITS = 12;

const positiveModulo = (value, divisor) => ((value % divisor) + divisor) % divisor;

export const resolveSierraTravelFrame = ({
  elapsedSeconds,
  traversalDurationSeconds,
  travelPeriodPixels,
  travelCycles = 1,
  direction = 'right',
}) => {
  const duration = Math.max(0.001, Number(traversalDurationSeconds) || 10);
  const elapsed = Math.max(0, Number(elapsedSeconds) || 0);
  const period = Math.max(0.0001, Number(travelPeriodPixels) || 1);
  const cycles = Math.max(1, Math.round(Number(travelCycles) || 1));
  const traversalPosition = elapsed / duration;
  const traversalIndex = Math.floor(traversalPosition);
  const traversalProgress = traversalPosition - traversalIndex;
  const phasePixels = positiveModulo(traversalProgress * period * cycles, period);
  return {
    baseIndex: 0,
    revealIndex: 1,
    traversalIndex,
    traversalProgress,
    sheetOffsetPixels: phasePixels * (direction === 'left' ? -1 : 1),
  };
};

/**
 * Resolves Interlace mask dimensions. Sierra Travel owns one immutable
 * full-document plate plus one horizontal period of overscan on each side;
 * pulse presets retain their compact repeating tile.
 * @param {{
 *   documentWidth: number,
 *   documentHeight: number,
 *   cellSize: number,
 *   scaleX?: number,
 *   scaleY?: number,
 *   patternPreset?: 'classic' | 'ripple' | 'counterflow' | 'hypnotic' | 'sierra-travel',
 * }} options
 */
export const resolveInterlaceTileMetrics = ({
  documentWidth,
  documentHeight,
  cellSize,
  scaleX = 1,
  scaleY = 1,
  patternPreset = 'classic',
}) => {
  const resolvedCellSize = Math.max(1, Number(cellSize) || 1);
  const isSierraTravel = patternPreset === 'sierra-travel';
  const resolvedScaleX = Math.max(0.0001, Number(scaleX) || 1);
  const resolvedScaleY = Math.max(0.0001, Number(scaleY) || 1);
  const cellWidth = resolvedCellSize * resolvedScaleX;
  const cellHeight = resolvedCellSize * resolvedScaleY;
  const documentWidthPixels = Math.max(
    1,
    Math.round((Number(documentWidth) || 1) * resolvedScaleX),
  );
  const travelPeriodPixels = isSierraTravel
    ? cellWidth * SIERRA_TRAVEL_PERIOD_UNITS
    : cellWidth * 2;
  const overscanPixels = isSierraTravel ? travelPeriodPixels : 0;
  const tileWidth = isSierraTravel
    ? Math.max(1, Math.ceil(documentWidthPixels + overscanPixels * 2))
    : Math.max(2, Math.round(cellWidth * 2));
  const visibleColumnCount = Math.max(
    1,
    Math.ceil(tileWidth / cellWidth),
  );
  const columnCount = isSierraTravel ? visibleColumnCount : 2;
  const rawDocumentHeight = Math.max(1, Number(documentHeight) || 1);
  const documentHeightPixels = isSierraTravel
    ? Math.max(1, Math.round(rawDocumentHeight * resolvedScaleY))
    : rawDocumentHeight;
  let rowCount = 0;
  let heightUnits = 0;
  if (isSierraTravel) {
    let y = 0;
    while (y < documentHeightPixels) {
      const bandScale = SIERRA_TRAVEL_ROW_RHYTHM[
        rowCount % SIERRA_TRAVEL_ROW_RHYTHM.length
      ];
      y += cellHeight * bandScale;
      rowCount += 1;
    }
    heightUnits = documentHeightPixels / Math.max(cellHeight, 0.0001);
  } else {
    rowCount = INTERLACE_PATTERN_RHYTHM.length;
    heightUnits = INTERLACE_RHYTHM_HEIGHT;
  }
  const tileHeight = isSierraTravel
    ? documentHeightPixels
    : Math.max(heightUnits, Math.round(resolvedCellSize * resolvedScaleY * heightUnits));
  return {
    tileWidth,
    tileHeight,
    cellWidth,
    cellHeight,
    columnCount,
    rowCount,
    travelPeriodPixels,
    overscanPixels,
  };
};

/**
 * Fixed-lattice Interlace reveal geometry shared by Vessel and Goblet playback.
 * Sierra Travel returns the single immutable plate at its registered origin;
 * the renderer translates that plate horizontally without changing its cells.
 * Pulse presets vary the high-source width while retaining the
 * 1,1,1,1,1,4 row rhythm.
 * @param {{
 *   width: number,
 *   height: number,
 *   cellSize: number,
 *   cellHeight?: number,
 *   mix: number,
 *   motionPixels?: number,
 *   phaseCycles?: number,
 *   mirrorX?: boolean,
 *   patternPreset?: 'classic' | 'ripple' | 'counterflow' | 'hypnotic' | 'sierra-travel',
 *   transitionProgress?: number,
 *   seed?: number,
 * }} options
 * @returns {Array<{ x: number, y: number, width: number, height: number }>}
 */
export const resolveInterlaceMaskRectangles = ({
  width,
  height,
  cellSize,
  cellHeight = cellSize,
  mix,
  motionPixels = 0,
  phaseCycles = 0,
  mirrorX = false,
  patternPreset = 'classic',
  transitionProgress = 0,
  seed = 0,
}) => {
  const canvasWidth = Math.max(0, Number(width) || 0);
  const canvasHeight = Math.max(0, Number(height) || 0);
  const baseCellSize = Math.max(1, Number(cellSize) || 1);
  const baseCellHeight = Math.max(1, Number(cellHeight) || baseCellSize);
  const mix01 = clamp01(Number.isFinite(mix) ? mix : 0.5);
  const resolvedMotion = Number.isFinite(motionPixels) ? motionPixels : 0;
  const resolvedPhaseCycles = Number.isFinite(phaseCycles) ? phaseCycles : 0;
  const resolvedTransitionProgress = clamp01(
    Number.isFinite(transitionProgress) ? transitionProgress : 0,
  );
  const modulationEnvelope = Math.sin(Math.PI * resolvedTransitionProgress);
  const rectangles = [];
  if (canvasWidth === 0 || canvasHeight === 0) return rectangles;

  if (patternPreset === 'sierra-travel') {
    const horizontalPhase = (Number(seed) >>> 0) & 1;
    let y = 0;
    let band = 0;
    while (y < canvasHeight) {
      const bandScale = SIERRA_TRAVEL_ROW_RHYTHM[
        band % SIERRA_TRAVEL_ROW_RHYTHM.length
      ];
      const bandCellWidth = baseCellSize * bandScale;
      const bandColumnCount = Math.max(1, Math.ceil(canvasWidth / bandCellWidth));
      const firstColumn = ((band + horizontalPhase) & 1) === 0 ? 1 : 0;
      const bandCellCount = firstColumn < bandColumnCount
        ? Math.ceil((bandColumnCount - firstColumn) / 2)
        : 0;
      const rowHeight = Math.min(
        baseCellHeight * bandScale,
        canvasHeight - y,
      );
      for (let index = 0; index < bandCellCount; index += 1) {
        const column = firstColumn + index * 2;
        const cellX = column * bandCellWidth;
        const cellWidth = Math.min(bandCellWidth, canvasWidth - cellX);
        if (cellWidth > 1e-9) {
          rectangles.push({
            x: cellX,
            y,
            width: cellWidth,
            height: rowHeight,
          });
        }
      }
      y += baseCellHeight * bandScale;
      band += 1;
    }
    return rectangles;
  }

  if (mix01 === 0) return rectangles;

  let y = 0;
  let row = 0;
  while (y < canvasHeight) {
    const scale = INTERLACE_PATTERN_RHYTHM[
      positiveModulo(row, INTERLACE_PATTERN_RHYTHM.length)
    ];
    const period = baseCellSize * 2;
    const rowPhase = resolvedTransitionProgress + row / INTERLACE_PATTERN_RHYTHM.length;
    const rowWave = Math.sin(Math.PI * 2 * rowPhase);
    const counterWave = Math.cos(
      Math.PI * 2 * (resolvedTransitionProgress * 2 + row / 2),
    );
    const mixHeadroom = Math.min(mix01, 1 - mix01);
    const mixModulation = patternPreset === 'ripple'
      ? mixHeadroom * 0.25 * modulationEnvelope * rowWave
      : patternPreset === 'hypnotic'
        ? mixHeadroom * 0.4 * modulationEnvelope
          * (rowWave * 0.72 + counterWave * 0.28)
        : 0;
    const rowMix = clamp01(mix01 + mixModulation);
    const revealWidth = period * rowMix;
    const rowOffset = (row & 1) * baseCellSize;
    const counterflowOffset = patternPreset === 'counterflow'
      ? baseCellSize * 0.72 * modulationEnvelope * counterWave
      : patternPreset === 'hypnotic'
        ? baseCellSize * 0.52 * modulationEnvelope
          * Math.sin(Math.PI * 2 * (resolvedTransitionProgress + row / 3))
        : 0;
    const firstX = positiveModulo(
      resolvedMotion + resolvedPhaseCycles * period + counterflowOffset - rowOffset,
      period,
    ) - period;
    const bandHeight = Math.min(baseCellHeight * scale, canvasHeight - y);

    for (let x = firstX; x < canvasWidth; x += period) {
      const left = Math.max(0, x);
      const right = Math.min(canvasWidth, x + revealWidth);
      if (right - left > 1e-9) {
        rectangles.push({
          x: mirrorX ? canvasWidth - right : left,
          y,
          width: right - left,
          height: bandHeight,
        });
      }
    }

    y += baseCellHeight * scale;
    row += 1;
  }
  return rectangles;
};

export const resolveInterlaceFrame = ({
  elapsedSeconds,
  sourceCount,
  loopDurationSeconds,
  dominance,
  direction,
  travelCycles,
  gridWidth,
}) => {
  const count = Math.max(2, Math.round(Number(sourceCount) || 2));
  const duration = Math.max(0.001, Number(loopDurationSeconds) || 10);
  const loopProgress = wrapGobletPhase01((Number(elapsedSeconds) || 0) / duration);
  const sourceProgress = loopProgress * count;
  const currentIndex = Math.floor(sourceProgress) % count;
  const localProgress = sourceProgress - Math.floor(sourceProgress);
  const resolvedDominance = Math.max(0.5, Math.min(1, Number(dominance) || 0.92));
  const lowMix = 1 - resolvedDominance;
  const mix = lowMix + localProgress * (resolvedDominance - lowMix);
  const directionSign = direction === 'left' ? -1 : 1;
  const motionCells = loopProgress
    * Math.max(1, Math.round(Number(travelCycles) || 1))
    * Math.max(1, Math.round(Number(gridWidth) || 1))
    * directionSign;
  return {
    currentIndex,
    nextIndex: (currentIndex + 1) % count,
    mix,
    motionCells,
    pairPhaseCycles: localProgress * lowMix,
    pairProgress: localProgress,
    loopProgress,
  };
};

export const clampGobletByte = (value) => {
  const rounded = Math.round(value);
  if (rounded <= 0) {
    return 0;
  }
  if (rounded >= 255) {
    return 255;
  }
  return rounded;
};

export const parseGobletColor = (input) => {
  if (typeof input !== 'string') {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  const value = input.trim();
  if (!value) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  if (value.toLowerCase() === 'transparent') {
    return { r: 0, g: 0, b: 0, a: 0 };
  }
  if (value.startsWith('#')) {
    const hex = value.slice(1);
    if (hex.length === 3 || hex.length === 4) {
      const r = parseInt(hex[0] + hex[0], 16);
      const g = parseInt(hex[1] + hex[1], 16);
      const b = parseInt(hex[2] + hex[2], 16);
      const a = hex.length === 4 ? parseInt(hex[3] + hex[3], 16) : 255;
      return { r, g, b, a };
    }
    if (hex.length === 6 || hex.length === 8) {
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const a = hex.length === 8 ? parseInt(hex.slice(6, 8), 16) : 255;
      return { r, g, b, a };
    }
  }
  const rgbaMatch = value.match(/^rgba?\(([^)]+)\)$/i);
  if (rgbaMatch) {
    const parts = rgbaMatch[1].split(',').map((part) => part.trim());
    if (parts.length >= 3) {
      const r = clampGobletByte(parseFloat(parts[0]));
      const g = clampGobletByte(parseFloat(parts[1]));
      const b = clampGobletByte(parseFloat(parts[2]));
      let a = 255;
      if (parts.length >= 4) {
        const raw = parts[3].endsWith('%') ? parseFloat(parts[3]) / 100 : parseFloat(parts[3]);
        if (Number.isFinite(raw)) {
          a = raw <= 1 ? clampGobletByte(raw * 255) : clampGobletByte(raw);
        }
      }
      return { r, g, b, a };
    }
  }
  return { r: 255, g: 255, b: 255, a: 255 };
};

const DEFAULT_GOBLET_GRADIENT = [
  { position: 0, rgba: parseGobletColor('#000000') },
  { position: 1, rgba: parseGobletColor('#ffffff') },
];

const cloneGobletGradient = (gradient) => (
  gradient.map((entry) => ({ position: entry.position, rgba: { ...entry.rgba } }))
);

export const normalizeGobletGradientStops = (stops) => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return cloneGobletGradient(DEFAULT_GOBLET_GRADIENT);
  }
  const normalized = stops
    .map((stop) => ({
      position: clamp01(
        typeof stop?.position === 'number'
          ? stop.position
          : parseFloat(stop?.position ?? 0),
      ),
      rgba: stop?.rgba && typeof stop.rgba === 'object'
        ? {
            r: clampGobletByte(stop.rgba.r),
            g: clampGobletByte(stop.rgba.g),
            b: clampGobletByte(stop.rgba.b),
            a: clampGobletByte(stop.rgba.a ?? 255),
          }
        : parseGobletColor(stop?.color ?? '#ffffff'),
    }))
    .sort((a, b) => a.position - b.position);
  if (normalized.length === 0) {
    return cloneGobletGradient(DEFAULT_GOBLET_GRADIENT);
  }
  if (normalized[0].position > 0) {
    normalized.unshift({ position: 0, rgba: normalized[0].rgba });
  }
  const last = normalized[normalized.length - 1];
  if (last.position < 1) {
    normalized.push({ position: 1, rgba: last.rgba });
  }
  if (normalized.length === 1) {
    normalized.push({ position: 1, rgba: normalized[0].rgba });
  }
  return normalized;
};

export const normalizeGobletSlotPalettes = (slotPalettes, fallbackGradient) => {
  if (!Array.isArray(slotPalettes) || slotPalettes.length === 0) {
    return null;
  }
  const map = new Map();
  slotPalettes.forEach((entry) => {
    if (!entry || typeof entry !== 'object') {
      return;
    }
    const slot = Number(entry.slot);
    if (!Number.isFinite(slot)) {
      return;
    }
    const stops = Array.isArray(entry.stops) ? entry.stops : [];
    map.set(
      clampGobletSlotId(slot),
      normalizeGobletGradientStops(stops),
    );
  });
  if (map.size === 0) {
    return null;
  }
  if (!map.has(0) && Array.isArray(fallbackGradient) && fallbackGradient.length > 0) {
    map.set(0, normalizeGobletGradientStops(fallbackGradient));
  }
  return map;
};

export const sampleGobletGradient = (gradient, position) => {
  if (!Array.isArray(gradient) || gradient.length === 0) {
    return { r: 255, g: 255, b: 255, a: 255 };
  }
  if (gradient.length === 1) {
    return { ...gradient[0].rgba };
  }
  const pos = clamp01(position);
  for (let index = 0; index < gradient.length - 1; index += 1) {
    const left = gradient[index];
    const right = gradient[index + 1];
    if (pos >= left.position && pos <= right.position) {
      const span = right.position - left.position;
      const t = span > 0 ? (pos - left.position) / span : 0;
      return {
        r: clampGobletByte(left.rgba.r + (right.rgba.r - left.rgba.r) * t),
        g: clampGobletByte(left.rgba.g + (right.rgba.g - left.rgba.g) * t),
        b: clampGobletByte(left.rgba.b + (right.rgba.b - left.rgba.b) * t),
        a: clampGobletByte(left.rgba.a + (right.rgba.a - left.rgba.a) * t),
      };
    }
  }
  return { ...gradient[gradient.length - 1].rgba };
};

export const resolveGobletAlphaByte = (alpha, alphaIndex, fallbackAlpha = 255) => (
  alpha?.[alphaIndex] ?? fallbackAlpha
);

export const resolveGobletIndexedAlphaByte = (alpha, alphaIndex, effectiveIndex) => (
  resolveGobletAlphaByte(alpha, alphaIndex, effectiveIndex !== 0 ? 255 : 0)
);

export const resizeGobletAlphaMaskBuffer = (
  source,
  srcWidth,
  srcHeight,
  destWidth,
  destHeight,
) => {
  if (!source || !source.length) {
    return null;
  }
  const targetWidth = Math.max(1, Math.round(destWidth));
  const targetHeight = Math.max(1, Math.round(destHeight));
  const width = Math.max(1, Math.round(srcWidth));
  const height = Math.max(1, Math.round(srcHeight));
  if (width === targetWidth && height === targetHeight) {
    if (source.length === width * height) {
      return source;
    }
    const normalized = new Uint8Array(width * height);
    normalized.set(source.subarray(0, Math.min(source.length, normalized.length)));
    return normalized;
  }
  const output = new Uint8Array(targetWidth * targetHeight);
  const scaleX = width / targetWidth;
  const scaleY = height / targetHeight;
  for (let y = 0; y < targetHeight; y += 1) {
    const srcY = Math.min(height - 1, Math.max(0, Math.floor(y * scaleY)));
    for (let x = 0; x < targetWidth; x += 1) {
      const srcX = Math.min(width - 1, Math.max(0, Math.floor(x * scaleX)));
      const srcIdx = srcY * width + srcX;
      const dstIdx = y * targetWidth + x;
      output[dstIdx] = source[srcIdx] ?? 0;
    }
  }
  return output;
};

export const applyGobletEraseMaskToAlphaChannel = (alphaBuffer, maskBuffer) => {
  if (!alphaBuffer || !maskBuffer) {
    return;
  }
  const pixelCount = Math.min(maskBuffer.length, Math.floor(alphaBuffer.length / 4));
  for (let index = 0, alphaIndex = 3; index < pixelCount; index += 1, alphaIndex += 4) {
    const erase = maskBuffer[index];
    if (!erase) {
      continue;
    }
    const current = alphaBuffer[alphaIndex] || 0;
    alphaBuffer[alphaIndex] = Math.max(0, Math.round((current * (255 - erase)) / 255));
  }
};

export const applyGobletSoftEdgeMaskToAlphaChannel = (alphaBuffer, maskBuffer) => {
  if (!alphaBuffer || !maskBuffer) {
    return;
  }
  const pixelCount = Math.min(maskBuffer.length, Math.floor(alphaBuffer.length / 4));
  for (let index = 0, alphaIndex = 3; index < pixelCount; index += 1, alphaIndex += 4) {
    const keep = maskBuffer[index];
    const current = alphaBuffer[alphaIndex] || 0;
    alphaBuffer[alphaIndex] = Math.max(0, Math.round((current * keep) / 255));
  }
};

export const hasAnyGobletMaskValue = (maskBuffer) => {
  if (!maskBuffer) {
    return false;
  }
  for (let index = 0; index < maskBuffer.length; index += 1) {
    if (maskBuffer[index] > 0) {
      return true;
    }
  }
  return false;
};

export const hasVisibleGobletAlpha = (alphaBuffer) => {
  if (!alphaBuffer || alphaBuffer.length < 4) {
    return false;
  }
  for (let index = 3; index < alphaBuffer.length; index += 4) {
    if (alphaBuffer[index]) {
      return true;
    }
  }
  return false;
};
