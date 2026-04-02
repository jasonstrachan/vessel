import {
  BAYER_8x8_MATRIX,
  BLUE_NOISE_16x16,
  VOID_CLUSTER_8x8,
  type DitherAlgorithm,
  type PatternStyle,
} from '@/utils/ditherAlgorithms';
import {
  fillFlatPatternMode,
} from '@/utils/colorCycle/ccFlatModePatterns';
import { resolveFlatSierraBandMixInfo } from '@/utils/colorCycle/ccDitherRenderPalette';
import { ccLog } from '@/utils/colorCycle/ccDebug';
import { useAppStore } from '@/stores/useAppStore';

type Point = { x: number; y: number };

export type CcGradientDitherOptions = {
  vertices: Point[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  pixelSize: number;
  levels: number;
  baseOffset: number;
  flatPairSpread?: number;
  flatMixByBand?: readonly number[];
  flatSeed?: number;
  algorithm?: DitherAlgorithm;
  patternStyle?: PatternStyle;
  pairBandCount?: number;
  fillBackground?: boolean;
  pxlEdge?: boolean;
  sampleNormalized: (x: number, y: number) => number;
  writeIndex: (x: number, y: number, index: number) => void;
  logSetIndexSample?: (x: number, y: number) => void;
  yieldIfNeeded?: (row: number) => Promise<void>;
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

const noiseAt = (x: number, y: number): number => {
  let n = (x | 0) * 374761393 + (y | 0) * 668265263;
  n = (n ^ (n >>> 13)) * 1274126177;
  n = (n ^ (n >>> 16)) >>> 0;
  return (n & 0xffff) / 65536;
};

const indexFromNormalized = (pos: number, baseOffset: number): number => {
  const raw = Math.round(pos * 254);
  const shifted = (raw + baseOffset) % 255;
  return Math.max(1, Math.min(255, shifted + 1));
};

const levelToCyclePos = (level: number, levels: number): number => {
  const safeLevels = Math.max(1, levels | 0);
  if (safeLevels <= 1) {
    return 0;
  }
  const clampedLevel = Math.max(0, Math.min(safeLevels - 1, level | 0));
  // Color-cycle gradients are periodic, so avoid sampling the duplicated 1.0 endpoint.
  // This keeps low slice counts (especially 2) from collapsing to a single color.
  return clampedLevel / safeLevels;
};

const resolveAverageActiveTone = (
  cellCoverage: Uint8Array,
  activeMask: Uint8Array
): number => {
  let totalCoverage = 0;
  let activeCount = 0;

  for (let i = 0; i < activeMask.length; i += 1) {
    if (!activeMask[i]) {
      continue;
    }
    totalCoverage += cellCoverage[i] ?? 0;
    activeCount += 1;
  }

  if (activeCount <= 0) {
    return 0.5;
  }

  return clamp01(totalCoverage / (activeCount * 255));
};

const resolveRuntimeFlatMixByBand = (
  baseOffset: number,
  spread?: number
): { mixByBand?: number[] } => {
  try {
    const state = useAppStore.getState();
    const tools = state.tools?.brushSettings;
    const layerId = state.activeLayerId;
    const layer = state.layers?.find((entry) => entry.id === layerId);
    const fgColor = state.palette?.foregroundColor ?? tools?.color;

    const useForegroundGradient = Boolean(tools?.colorCycleUseForegroundGradient);
    const defs = layer?.colorCycleData?.gradientDefs ?? [];
    const activeId = layer?.colorCycleData?.activeGradientId ?? defs[0]?.id;
    const activeDef = defs.find((entry) => entry.id === activeId) ?? defs[0];
    const slot = useForegroundGradient
      ? (layer?.colorCycleData?.fgActiveSlot ?? layer?.colorCycleData?.paintSlot ?? activeDef?.currentSlot ?? 0)
      : (layer?.colorCycleData?.paintSlot ?? activeDef?.currentSlot ?? 0);
    const slotPalettes = layer?.colorCycleData?.slotPalettes ?? [];
    const slotStops = slotPalettes.find((entry) => entry.slot === slot)?.stops;
    const fallbackStops = layer?.colorCycleData?.gradient ?? tools?.colorCycleGradient;
    const stops = useForegroundGradient
      ? ((fallbackStops?.length ? fallbackStops : slotStops) ?? [])
      : ((slotStops?.length ? slotStops : fallbackStops) ?? []);
    if (!stops.length) {
      return {};
    }

    const bandMixInfo = resolveFlatSierraBandMixInfo({
      stops,
      targetColor: fgColor,
      baseOffset,
      spread,
    });
    return {
      mixByBand: bandMixInfo.length === 5 ? bandMixInfo.map((entry) => entry.mix) : undefined,
    };
  } catch {
    return {};
  }
};

type ErrorDiffusionTap = { dx: number; dy: number; weight: number };
type ErrorDiffusionKernel = {
  taps: ReadonlyArray<ErrorDiffusionTap>;
  divisor: number;
  serpentine?: boolean;
};

type ErrorDiffusionProfile = {
  threshold: number;
  jitterBase: number;
};

const ERROR_DIFFUSION_KERNELS: Readonly<Record<Exclude<DitherAlgorithm, 'bayer' | 'blue-noise' | 'void-and-cluster' | 'pattern'>, ErrorDiffusionKernel>> = {
  'floyd-steinberg': {
    taps: [
      { dx: 1, dy: 0, weight: 7 },
      { dx: -1, dy: 1, weight: 3 },
      { dx: 0, dy: 1, weight: 5 },
      { dx: 1, dy: 1, weight: 1 },
    ],
    divisor: 16,
    serpentine: true,
  },
  'jarvis-judice-ninke': {
    taps: [
      { dx: 1, dy: 0, weight: 7 },
      { dx: 2, dy: 0, weight: 5 },
      { dx: -2, dy: 1, weight: 3 },
      { dx: -1, dy: 1, weight: 5 },
      { dx: 0, dy: 1, weight: 7 },
      { dx: 1, dy: 1, weight: 5 },
      { dx: 2, dy: 1, weight: 3 },
      { dx: -2, dy: 2, weight: 1 },
      { dx: -1, dy: 2, weight: 3 },
      { dx: 0, dy: 2, weight: 5 },
      { dx: 1, dy: 2, weight: 3 },
      { dx: 2, dy: 2, weight: 1 },
    ],
    divisor: 48,
    serpentine: true,
  },
  stucki: {
    taps: [
      { dx: 1, dy: 0, weight: 8 },
      { dx: 2, dy: 0, weight: 4 },
      { dx: -2, dy: 1, weight: 2 },
      { dx: -1, dy: 1, weight: 4 },
      { dx: 0, dy: 1, weight: 8 },
      { dx: 1, dy: 1, weight: 4 },
      { dx: 2, dy: 1, weight: 2 },
      { dx: -2, dy: 2, weight: 1 },
      { dx: -1, dy: 2, weight: 2 },
      { dx: 0, dy: 2, weight: 4 },
      { dx: 1, dy: 2, weight: 2 },
      { dx: 2, dy: 2, weight: 1 },
    ],
    divisor: 42,
    serpentine: true,
  },
  burkes: {
    taps: [
      { dx: 1, dy: 0, weight: 8 },
      { dx: 2, dy: 0, weight: 4 },
      { dx: -2, dy: 1, weight: 2 },
      { dx: -1, dy: 1, weight: 4 },
      { dx: 0, dy: 1, weight: 8 },
      { dx: 1, dy: 1, weight: 4 },
      { dx: 2, dy: 1, weight: 2 },
    ],
    divisor: 32,
    serpentine: true,
  },
  'sierra-3': {
    taps: [
      { dx: 1, dy: 0, weight: 5 },
      { dx: 2, dy: 0, weight: 3 },
      { dx: -2, dy: 1, weight: 2 },
      { dx: -1, dy: 1, weight: 4 },
      { dx: 0, dy: 1, weight: 5 },
      { dx: 1, dy: 1, weight: 4 },
      { dx: 2, dy: 1, weight: 2 },
      { dx: -1, dy: 2, weight: 2 },
      { dx: 0, dy: 2, weight: 3 },
      { dx: 1, dy: 2, weight: 2 },
    ],
    divisor: 32,
    serpentine: true,
  },
  'sierra-2': {
    taps: [
      { dx: 1, dy: 0, weight: 4 },
      { dx: 2, dy: 0, weight: 3 },
      { dx: -2, dy: 1, weight: 1 },
      { dx: -1, dy: 1, weight: 2 },
      { dx: 0, dy: 1, weight: 3 },
      { dx: 1, dy: 1, weight: 2 },
      { dx: 2, dy: 1, weight: 1 },
    ],
    divisor: 16,
    serpentine: true,
  },
  'sierra-lite': {
    taps: [
      { dx: 1, dy: 0, weight: 2 },
      { dx: -1, dy: 1, weight: 1 },
      { dx: 0, dy: 1, weight: 1 },
    ],
    divisor: 4,
    serpentine: true,
  },
  atkinson: {
    taps: [
      { dx: 1, dy: 0, weight: 1 },
      { dx: 2, dy: 0, weight: 1 },
      { dx: -1, dy: 1, weight: 1 },
      { dx: 0, dy: 1, weight: 1 },
      { dx: 1, dy: 1, weight: 1 },
      { dx: 0, dy: 2, weight: 1 },
    ],
    divisor: 8,
    serpentine: true,
  },
};

const ERROR_DIFFUSION_PROFILES: Readonly<Record<Exclude<DitherAlgorithm, 'bayer' | 'blue-noise' | 'void-and-cluster' | 'pattern'>, ErrorDiffusionProfile>> = {
  'floyd-steinberg': { threshold: 0.5, jitterBase: 0.04 },
  'jarvis-judice-ninke': { threshold: 0.46, jitterBase: 0.02 },
  stucki: { threshold: 0.48, jitterBase: 0.02 },
  burkes: { threshold: 0.53, jitterBase: 0.03 },
  'sierra-3': { threshold: 0.5, jitterBase: 0.025 },
  'sierra-2': { threshold: 0.52, jitterBase: 0.03 },
  'sierra-lite': { threshold: 0.5, jitterBase: 0 },
  atkinson: { threshold: 0.45, jitterBase: 0.015 },
};

const resolveOrderedThreshold = (
  algorithm: DitherAlgorithm,
  patternStyle: PatternStyle | undefined,
  x: number,
  y: number
): number => {
  if (algorithm === 'bayer') {
    return BAYER_8x8_MATRIX[y & 7][x & 7];
  }
  if (algorithm === 'blue-noise') {
    return BLUE_NOISE_16x16[y & 15][x & 15];
  }
  if (algorithm === 'void-and-cluster') {
    return VOID_CLUSTER_8x8[y & 7][x & 7];
  }

  const style = patternStyle ?? 'dots';
  switch (style) {
    case 'lines':
      return ((x + y) & 1) === 0 ? 0.3 : 0.7;
    case 'vertical-lines':
      return (x & 1) === 0 ? 0.3 : 0.7;
    case 'horizontal-lines':
      return (y & 1) === 0 ? 0.3 : 0.7;
    case 'crosshatch':
      return (((x & 1) + (y & 1)) * 0.25) + 0.25;
    case 'diagonal':
      return (((x + y) & 3) + 0.5) / 4;
    case 'tone-adaptive':
      return 0.5 + (BAYER_8x8_MATRIX[y & 7][x & 7] - 0.5) * 0.55;
    case 'dots':
    default:
      return BAYER_8x8_MATRIX[y & 7][x & 7];
  }
};

export const fillCcGradientDither = async ({
  vertices,
  minX,
  minY,
  maxX,
  maxY,
  pixelSize,
  levels,
  baseOffset,
  flatPairSpread,
  flatMixByBand,
  flatSeed,
  algorithm = 'sierra-lite',
  patternStyle = 'dots',
  pairBandCount,
  fillBackground = true,
  pxlEdge = false,
  sampleNormalized,
  writeIndex,
  logSetIndexSample,
  yieldIfNeeded,
}: CcGradientDitherOptions): Promise<void> => {
  const clampedLevels = Math.max(1, Math.min(255, Math.floor(levels)));
  const clampedPairBands = Math.max(0, Math.floor(pairBandCount ?? 0));
  const cellSize = Math.max(1, Math.floor(pixelSize));
  const useWholeEdgeCells = Boolean(pxlEdge && cellSize > 1);
  const bboxWidth = Math.max(1, maxX - minX + 1);
  const bboxHeight = Math.max(1, maxY - minY + 1);
  const gridW = Math.max(1, Math.ceil(bboxWidth / cellSize));
  const gridH = Math.max(1, Math.ceil(bboxHeight / cellSize));

  const cellIndices = new Uint16Array(gridW * gridH);
  const cellCoverage = new Uint8Array(gridW * gridH);
  const activeMask = new Uint8Array(gridW * gridH);
  const activeCellsByRow: number[][] = Array.from({ length: gridH }, () => []);
  const rowSpans: Array<Array<[number, number]>> = Array.from({ length: bboxHeight }, () => []);

  const activeCells: number[] = [];
  const cellSeen = new Uint8Array(gridW);
  const thresholdJitter = algorithm === 'sierra-lite' ? 0 : 0.2;

  for (let row = 0; row < bboxHeight; row += 1) {
    const y = minY + row;
    const intersections: number[] = [];
    for (let i = 0; i < vertices.length; i += 1) {
      const v1 = vertices[i];
      const v2 = vertices[(i + 1) % vertices.length];
      if (Math.abs(v2.y - v1.y) < 1e-4) continue;
      if ((v1.y <= y && v2.y > y) || (v2.y <= y && v1.y > y)) {
        const t = (y - v1.y) / (v2.y - v1.y);
        const x = v1.x + t * (v2.x - v1.x);
        intersections.push(x);
      }
    }

    intersections.sort((a, b) => a - b);
    for (let i = 0; i < intersections.length - 1; i += 2) {
      const startFloat = intersections[i];
      const endFloat = intersections[i + 1];
      if (endFloat <= startFloat) continue;
      const startX = Math.floor(startFloat);
      const endX = useWholeEdgeCells
        ? Math.ceil(endFloat) - 1
        : Math.ceil(endFloat);
      if (endX >= startX) {
        rowSpans[row].push([startX, endX]);
      }
    }
  }

  for (let cy = 0; cy < gridH; cy += 1) {
    cellSeen.fill(0);
    activeCells.length = 0;

    const rowStart = cy * cellSize;
    const rowEnd = Math.min(bboxHeight - 1, rowStart + cellSize - 1);
    for (let row = rowStart; row <= rowEnd; row += 1) {
      const spans = rowSpans[row];
      for (let i = 0; i < spans.length; i += 1) {
        const [startX, endX] = spans[i];
        const startCell = Math.floor((startX - minX) / cellSize);
        const endCell = Math.floor((endX - minX) / cellSize);
        for (let cx = startCell; cx <= endCell; cx += 1) {
          if (cx < 0 || cx >= gridW) continue;
          if (!cellSeen[cx]) {
            cellSeen[cx] = 1;
            activeCells.push(cx);
          }
        }
      }
    }

    if (!activeCells.length) {
      continue;
    }
    activeCells.sort((a, b) => a - b);
    activeCellsByRow[cy] = activeCells.slice();

    const serpentine = (cy & 1) === 1;
    const start = serpentine ? activeCells.length - 1 : 0;
    const end = serpentine ? -1 : activeCells.length;
    const step = serpentine ? -1 : 1;

      const sampleY = minY + cy * cellSize + cellSize * 0.5;
    for (let i = start; i !== end; i += step) {
      const cx = activeCells[i];
      const sampleX = minX + cx * cellSize + cellSize * 0.5;
      let r = clamp01(sampleNormalized(sampleX, sampleY));
      if (clampedLevels > 1 && algorithm !== 'sierra-lite') {
        const j = (noiseAt(Math.floor(sampleX), Math.floor(sampleY)) - 0.5) * (0.2 / clampedLevels);
        r = clamp01(r + j);
      }
      const cellIdx = cy * gridW + cx;
      activeMask[cellIdx] = 255;
      cellCoverage[cellIdx] = Math.max(0, Math.min(255, Math.round(r * 255)));
    }
  }

  if (clampedPairBands > 0) {
    const pairCount = Math.max(1, clampedPairBands);
    const lowIndexForBand = (band: number) =>
      indexFromNormalized((band * 2) / (pairCount * 2), baseOffset);
    const highIndexForBand = (band: number) =>
      indexFromNormalized((band * 2 + 1) / (pairCount * 2), baseOffset);
    const resolveBandState = (coverage: number, error = 0) => {
      const scaled = clamp01(coverage / 255 + error) * pairCount;
      const band = Math.max(0, Math.min(pairCount - 1, Math.floor(Math.min(pairCount - 1e-6, scaled))));
      const local = clamp01(scaled - band);
      return { band, local };
    };

    if (algorithm in ERROR_DIFFUSION_KERNELS) {
      const kernel = ERROR_DIFFUSION_KERNELS[algorithm as keyof typeof ERROR_DIFFUSION_KERNELS];
      const profile = ERROR_DIFFUSION_PROFILES[algorithm as keyof typeof ERROR_DIFFUSION_PROFILES];
      const errBuf = new Float32Array(gridW * gridH);
      const jitterScale = profile.jitterBase * 0.25;

      for (let cy = 0; cy < gridH; cy += 1) {
        const activeRow = activeCellsByRow[cy];
        if (!activeRow.length) continue;

        const useSerpentine = kernel.serpentine !== false;
        const leftToRight = useSerpentine ? (cy & 1) === 0 : true;
        const start = leftToRight ? 0 : activeRow.length - 1;
        const end = leftToRight ? activeRow.length : -1;
        const step = leftToRight ? 1 : -1;

        for (let i = start; i !== end; i += step) {
          const cx = activeRow[i];
          const cellIdx = cy * gridW + cx;
          const { band, local: initialLocal } = resolveBandState(cellCoverage[cellIdx], errBuf[cellIdx] || 0);
          let local = initialLocal;
          if (jitterScale > 0) {
            local = clamp01(local + (noiseAt(cx, cy) - 0.5) * jitterScale);
          }
          const usePrimary = local >= profile.threshold;
          cellIndices[cellIdx] = usePrimary ? highIndexForBand(band) : (fillBackground ? lowIndexForBand(band) : 0);
          const quant = usePrimary ? 1 : 0;
          const err = local - quant;
          if (err !== 0) {
            const norm = 1 / Math.max(1, kernel.divisor);
            for (let k = 0; k < kernel.taps.length; k += 1) {
              const tap = kernel.taps[k];
              const nx = cx + (leftToRight ? tap.dx : -tap.dx);
              const ny = cy + tap.dy;
              if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
              const nIdx = ny * gridW + nx;
              if (!activeMask[nIdx]) continue;
              errBuf[nIdx] += err * tap.weight * norm;
            }
          }
        }
      }
    } else {
      const phaseX = Math.floor(minX / Math.max(1, cellSize));
      const phaseY = Math.floor(minY / Math.max(1, cellSize));
      for (let cy = 0; cy < gridH; cy += 1) {
        const activeRow = activeCellsByRow[cy];
        if (!activeRow.length) continue;
        const rowOffset = cy * gridW;
        for (let i = 0; i < activeRow.length; i += 1) {
          const cx = activeRow[i];
          const cellIdx = rowOffset + cx;
          const { band, local } = resolveBandState(cellCoverage[cellIdx]);
          const threshold = resolveOrderedThreshold(
            algorithm,
            patternStyle,
            cx + phaseX,
            cy + phaseY
          );
          const usePrimary = local >= threshold;
          cellIndices[cellIdx] = usePrimary ? highIndexForBand(band) : (fillBackground ? lowIndexForBand(band) : 0);
        }
      }
    }
  } else if (clampedLevels === 1) {
    const phaseX = Math.floor(minX / Math.max(1, cellSize));
    const phaseY = Math.floor(minY / Math.max(1, cellSize));
    const flatPosition = resolveAverageActiveTone(cellCoverage, activeMask);
    const brushSettings = useAppStore.getState().tools?.brushSettings;
    const preferSampledFlatPosition =
      algorithm === 'sierra-lite' &&
      !flatMixByBand &&
      useAppStore.getState().tools?.ccGradientSource === 'sampled' &&
      !brushSettings?.colorCycleUseForegroundGradient;
    const runtimeFlat = algorithm === 'sierra-lite'
      ? resolveRuntimeFlatMixByBand(0, flatPairSpread)
      : {};
    const resolvedFlatMixByBand = preferSampledFlatPosition
      ? undefined
      : (flatMixByBand ?? runtimeFlat.mixByBand);

    ccLog('flat recipe inputs', {
      algorithm,
      flatPosition,
      baseOffset,
      flatPairSpread,
      preferSampledFlatPosition,
      resolvedFlatMixByBand,
      activeCellCount: activeMask.reduce((count, value) => count + (value ? 1 : 0), 0),
    });

    fillFlatPatternMode({
      algorithm,
      patternStyle,
      tone: flatPosition,
      flatPosition,
      flatMixByBand: resolvedFlatMixByBand,
      flatSeed,
      spread: flatPairSpread,
      gridW,
      gridH,
      activeMask,
      fillBackground,
      baseOffset,
      phaseX,
      phaseY,
      writeCellIndex: (cellIdx, index) => {
        cellIndices[cellIdx] = index;
      },
    });
  } else if (algorithm === 'sierra-lite') {
    let errCurr = new Float32Array(gridW);
    let errNext = new Float32Array(gridW);
    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) {
        const swapErr = errCurr;
        errCurr = errNext;
        errNext = swapErr;
        errNext.fill(0);
        continue;
      }

      const swapErr = errCurr;
      errCurr = errNext;
      errNext = swapErr;
      errNext.fill(0);

      const serpentine = (cy & 1) === 1;
      const start = serpentine ? activeRow.length - 1 : 0;
      const end = serpentine ? -1 : activeRow.length;
      const step = serpentine ? -1 : 1;

      for (let i = start; i !== end; i += step) {
        const cx = activeRow[i];
        const cellIdx = cy * gridW + cx;
        const scaled = (cellCoverage[cellIdx] / 255) * (clampedLevels - 1);
        const lower = Math.max(0, Math.min(clampedLevels - 1, Math.floor(scaled)));
        const frac = scaled - lower;
        const adj = clamp01(frac + (errCurr[cx] || 0));
        const thr = 0.5 + (noiseAt(cx, cy) - 0.5) * thresholdJitter;
        const chooseUpper = lower < clampedLevels - 1 && adj >= thr;
        const q = chooseUpper ? 1 : 0;
        const err = adj - q;

        if (!serpentine) {
          if (cx + 1 < gridW) errCurr[cx + 1] += err * 0.5;
          if (cx - 1 >= 0) errNext[cx - 1] += err * 0.25;
        } else {
          if (cx - 1 >= 0) errCurr[cx - 1] += err * 0.5;
          if (cx + 1 < gridW) errNext[cx + 1] += err * 0.25;
        }
        errNext[cx] += err * 0.25;

        const level = chooseUpper ? lower + 1 : lower;
        const pos = levelToCyclePos(level, clampedLevels);
        cellIndices[cellIdx] = indexFromNormalized(pos, baseOffset);
      }
    }
  } else if (algorithm in ERROR_DIFFUSION_KERNELS) {
    const kernel = ERROR_DIFFUSION_KERNELS[algorithm as keyof typeof ERROR_DIFFUSION_KERNELS];
    const profile = ERROR_DIFFUSION_PROFILES[algorithm as keyof typeof ERROR_DIFFUSION_PROFILES];
    const errBuf = new Float32Array(gridW * gridH);
    const jitterScale = profile.jitterBase / Math.max(1, clampedLevels - 1);

    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) continue;

      const useSerpentine = kernel.serpentine !== false;
      const leftToRight = useSerpentine ? (cy & 1) === 0 : true;
      const start = leftToRight ? 0 : activeRow.length - 1;
      const end = leftToRight ? activeRow.length : -1;
      const step = leftToRight ? 1 : -1;

      for (let i = start; i !== end; i += step) {
        const cx = activeRow[i];
        const cellIdx = cy * gridW + cx;
        let scaled = (cellCoverage[cellIdx] / 255) * (clampedLevels - 1);
        scaled += errBuf[cellIdx] || 0;
        if (jitterScale > 0) {
          scaled += (noiseAt(cx, cy) - 0.5) * jitterScale;
        }
        scaled = Math.max(0, Math.min(clampedLevels - 1, scaled));

        const lower = Math.floor(scaled);
        const upper = Math.min(clampedLevels - 1, lower + 1);
        const frac = scaled - lower;
        const level = frac >= profile.threshold ? upper : lower;
        const err = scaled - level;

        if (err !== 0) {
          const norm = 1 / Math.max(1, kernel.divisor);
          for (let k = 0; k < kernel.taps.length; k += 1) {
            const tap = kernel.taps[k];
            const nx = cx + (leftToRight ? tap.dx : -tap.dx);
            const ny = cy + tap.dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (!activeMask[nIdx]) continue;
            errBuf[nIdx] += err * tap.weight * norm;
          }
        }

        const pos = levelToCyclePos(level, clampedLevels);
        cellIndices[cellIdx] = indexFromNormalized(pos, baseOffset);
      }
    }
  } else {
    const phaseX = Math.floor(minX / Math.max(1, cellSize));
    const phaseY = Math.floor(minY / Math.max(1, cellSize));
    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) continue;
      for (let i = 0; i < activeRow.length; i += 1) {
        const cx = activeRow[i];
        const cellIdx = cy * gridW + cx;
        const scaled = (cellCoverage[cellIdx] / 255) * (clampedLevels - 1);
        const lower = Math.max(0, Math.min(clampedLevels - 1, Math.floor(scaled)));
        const frac = scaled - lower;
        const threshold = resolveOrderedThreshold(
          algorithm,
          patternStyle,
          cx + phaseX,
          cy + phaseY
        );
        const chooseUpper = lower < clampedLevels - 1 && frac >= threshold;
        const level = chooseUpper ? lower + 1 : lower;
        const pos = levelToCyclePos(level, clampedLevels);
        cellIndices[cellIdx] = indexFromNormalized(pos, baseOffset);
      }
    }
  }

  if (useWholeEdgeCells) {
    for (let cy = 0; cy < gridH; cy += 1) {
      const activeRow = activeCellsByRow[cy];
      if (!activeRow.length) {
        continue;
      }
      const rowOffset = cy * gridW;
      const yStart = minY + cy * cellSize;
      const yEnd = Math.min(maxY, yStart + cellSize - 1);
      for (let y = yStart; y <= yEnd; y += 1) {
        if (yieldIfNeeded) {
          await yieldIfNeeded(y - minY);
        }
        for (let i = 0; i < activeRow.length; i += 1) {
          const cx = activeRow[i];
          if (cx < 0 || cx >= gridW) continue;
          const index = cellIndices[rowOffset + cx];
          const cellX = minX + cx * cellSize;
          const cellXEnd = Math.min(maxX, cellX + cellSize - 1);

          if (index <= 0 && !fillBackground) {
            // In whole-cell edge mode, avoid clearing previous painted cells when BG fill is off.
            // This preserves prior CC shapes and only expands newly painted pixels to full cells.
            continue;
          }

          for (let x = cellX; x <= cellXEnd; x += 1) {
            if (logSetIndexSample) {
              logSetIndexSample(x, y);
            }
            writeIndex(x, y, index);
          }
        }
      }
    }
    return;
  }

  for (let row = 0; row < bboxHeight; row += 1) {
    const y = minY + row;
    if (yieldIfNeeded) {
      await yieldIfNeeded(row);
    }
    const spans = rowSpans[row];
    if (!spans.length) continue;

    const cy = Math.max(0, Math.min(gridH - 1, Math.floor((y - minY) / cellSize)));
    const rowOffset = cy * gridW;

    for (let i = 0; i < spans.length; i += 1) {
      const [startX, endX] = spans[i];
      const startCell = Math.floor((startX - minX) / cellSize);
      const endCell = Math.floor((endX - minX) / cellSize);

      for (let cx = startCell; cx <= endCell; cx += 1) {
        if (cx < 0 || cx >= gridW) continue;
        const index = cellIndices[rowOffset + cx];
        if (index <= 0) {
          if (!fillBackground) {
            const cellX = minX + cx * cellSize;
            const cellXEnd = Math.min(endX, cellX + cellSize - 1);
            const fillStart = Math.max(startX, cellX);
            if (fillStart <= cellXEnd) {
              for (let x = fillStart; x <= cellXEnd; x += 1) {
                if (logSetIndexSample) {
                  logSetIndexSample(x, y);
                }
                writeIndex(x, y, 0);
              }
            }
          }
          continue;
        }

        const cellX = minX + cx * cellSize;
        const cellXEnd = Math.min(endX, cellX + cellSize - 1);
        const fillStart = Math.max(startX, cellX);
        if (fillStart > cellXEnd) continue;

        for (let x = fillStart; x <= cellXEnd; x += 1) {
          if (logSetIndexSample) {
            logSetIndexSample(x, y);
          }
          writeIndex(x, y, index);
        }
      }
    }
  }
};
