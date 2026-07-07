import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { PatternStyle } from '@/utils/ditherAlgorithms';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

import {
  getErrorDiffusionKernel,
  isErrorDiffusionAlgorithm,
  isTileMaskAlgorithm,
  nowMs,
  resolveStampDitherBucket,
  STAMP_DITHER_BUCKETS,
  type StampDitherAlgorithm,
  type StampDitherConfig,
} from './coverage';
import {
  getStampDitherTile,
  hashStampDitherCellNoise,
  resolveStampDitherBaseSize,
  resolveStampDitherTileSample,
} from './tile';
import { resolveStampDitherSecondaryIndex } from './mask';
import type { StampDitherRuntime } from './runtime';
import type { StampDitherStrokeData } from './state';

const hasRecordedStampScales = (strokeData: StampDitherStrokeData): boolean =>
  Array.isArray(strokeData.stampSeqMeta) && strokeData.stampSeqMeta.length > 0;

const resolvePatternFinalizeFallbackScale = (
  strokeData: StampDitherStrokeData,
  config: StampDitherConfig,
): number => {
  if (hasRecordedStampScales(strokeData)) {
    return Math.max(1, strokeData.stampDitherStrokeScale ?? config.pixelSize);
  }
  return Math.max(1, config.pixelSize);
};

export const sampleStampDitherReplayMask = ({
  runtime,
  x,
  y,
  coverage,
  seed,
  tileScale,
  originX,
  originY,
  algorithm,
  patternStyle,
  imageTileThresholdResolver,
}: {
  runtime: StampDitherRuntime;
  x: number;
  y: number;
  coverage: number;
  seed: number;
  tileScale: number;
  originX: number;
  originY: number;
  algorithm: StampDitherAlgorithm;
  patternStyle: PatternStyle;
  imageTileThresholdResolver?: (x: number, y: number) => number | null;
}): number => {
  const scale = Math.max(1, Math.floor(tileScale));
  const clampedCoverage = Math.max(0, Math.min(1, coverage));
  const bucket = resolveStampDitherBucket(clampedCoverage);
  const baseSize = resolveStampDitherBaseSize(scale);
  const tile = getStampDitherTile(
    runtime,
    bucket,
    scale,
    baseSize,
    algorithm,
    patternStyle,
    imageTileThresholdResolver,
  );
  return resolveStampDitherTileSample(
    tile,
    baseSize * scale,
    x,
    y,
    originX,
    originY,
    seed >>> 0,
  );
};

const buildStampSeqToTileScale = (strokeData: StampDitherStrokeData, fallbackScale: number): Uint16Array => {
  const maxSeq = strokeData.stampDitherStampSeq ?? 0;
  let lut = strokeData.stampSeqToTileScale;
  if (!lut || lut.length !== maxSeq + 1) {
    lut = new Uint16Array(maxSeq + 1);
  } else {
    lut.fill(0);
  }
  const meta = strokeData.stampSeqMeta ?? [];
  for (const [seq, scale] of meta) {
    if (seq >= 0 && seq <= maxSeq) {
      lut[seq] = Math.max(1, Math.min(0xffff, scale | 0));
    }
  }
  if (lut.length > 0 && fallbackScale > 0) {
    lut[0] = Math.max(1, Math.min(0xffff, fallbackScale | 0));
  }
  strokeData.stampSeqToTileScale = lut;
  return lut;
};

export const recomposeStampDitherOverlay = (args: {
  state: StampDitherStrokeData;
  config: StampDitherConfig;
  runtime: StampDitherRuntime;
  animator: ColorCycleAnimator;
  flowSlot: number;
  cycleSpeed: number;
  tileScale: number;
}): void => {
  const {
    state,
    config,
    runtime,
    animator,
    flowSlot,
    cycleSpeed,
    tileScale,
  } = args;
  const bounds = state.stampDitherBounds;
  const tag = state.stampDitherTag;
  const primary = state.stampDitherPrimaryBuffer;
  const base = state.stampDitherBaseIdx;
  const baseG = state.stampDitherBaseGid;
  const baseTag = state.stampDitherBaseTag;
  if (!bounds || !tag || !primary) return;
  const rawAlgo = config.algorithm || 'sierra-lite';
  const algo = rawAlgo === 'pattern' ? 'pattern' : 'sierra-lite';
  const bucket = state.stampDitherLockedBucket ?? 1;
  const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  const seed = config.seed ?? 0;
  const bgFillOff = !config.bgFill;
  if (bgFillOff && (!base || !baseTag)) {
    return;
  }
  const basePixelSize = Math.max(1, config.pixelSize);
  const fallbackScale = Math.max(1, tileScale || basePixelSize);
  const lut = buildStampSeqToTileScale(state, fallbackScale);
  const tileCache = new Map<number, { tile: Uint8Array; tileClamp: number; originX: number; originY: number }>();

  const handle = state.stampDitherFillHandle ?? animator.beginDirectFill();
  const shouldCloseHandle = !state.stampDitherFillHandle;
  const data = handle.data;
  const gid = handle.gradientId;
  const spd = handle.speedData;
  const def = state.gradientDefIdBuffer;
  const speedByte = encodeColorCycleSpeedByte(cycleSpeed);
  const w = handle.width;
  const h = handle.height;
  const minX = Math.max(0, Math.min(w - 1, bounds.minX));
  const maxX = Math.max(0, Math.min(w - 1, bounds.maxX));
  const minY = Math.max(0, Math.min(h - 1, bounds.minY));
  const maxY = Math.max(0, Math.min(h - 1, bounds.maxY));

  const strokeEpoch = state.stampDitherStrokeEpoch ?? 1;
  const coverageByte = Math.max(0, Math.min(255, Math.round(coverage * 255)));
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * w;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = row + x;
      const tagValue = tag[idx];
      if ((tagValue >>> 16) !== strokeEpoch) continue;
      const seq = tagValue & 0xffff;
      if (seq === 0) continue;
      const seqScale = lut[seq] || fallbackScale;
      let tileEntry = tileCache.get(seqScale);
      if (!tileEntry) {
        const baseSize = resolveStampDitherBaseSize(seqScale);
        const originU = {
          x: (seed % baseSize) | 0,
          y: ((seed >>> 16) % baseSize) | 0,
        };
        const originX = -originU.x * seqScale;
        const originY = -originU.y * seqScale;
        const tileClamp = baseSize * seqScale;
        const tile = getStampDitherTile(
          runtime,
          bucket,
          seqScale,
          baseSize,
          algo === 'pattern' ? 'pattern' : 'sierra-lite',
          config.patternStyle ?? 'dots',
          config.imageTileThresholdResolver,
        );
        tileEntry = { tile, tileClamp, originX, originY };
        tileCache.set(seqScale, tileEntry);
      }
      const localY = ((y - tileEntry.originY) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
      const tileRow = localY * tileEntry.tileClamp;
      const localX = ((x - tileEntry.originX) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
      const tIdx = tileRow + localX;
      const p = primary[idx];
      const usePrimary =
        algo === 'pattern'
          ? (tileEntry.tile[tIdx] === 1)
          : (tileEntry.tile[tIdx] <= coverageByte);
      if (usePrimary) {
        data[idx] = p;
        gid[idx] = p === 0 ? 0 : flowSlot;
        spd[idx] = p === 0 ? 0 : speedByte;
        if (def) def[idx] = 0;
        continue;
      }
      if (bgFillOff) {
        if (base && baseTag && base.length === data.length && baseTag[idx] === strokeEpoch) {
          const v = base[idx];
          data[idx] = v;
          if (v === 0) {
            gid[idx] = 0;
            spd[idx] = 0;
            if (def) def[idx] = 0;
          } else if (baseG && baseG.length === gid.length) {
            gid[idx] = baseG[idx];
            if (def) {
              def[idx] = 0;
            }
          } else {
            gid[idx] = flowSlot;
            if (def) def[idx] = 0;
          }
        }
        continue;
      }
      const secondary = resolveStampDitherSecondaryIndex(p);
      data[idx] = secondary;
      gid[idx] = secondary === 0 ? 0 : flowSlot;
      spd[idx] = secondary === 0 ? 0 : speedByte;
      if (def) def[idx] = 0;
    }
  }

  if (shouldCloseHandle) {
    const needsUpload = animator.hasWebGL?.() ?? false;
    animator.endDirectFill({ markDirty: needsUpload });
  }
  animator.markDirtyBounds({
    minX,
    minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });
};

export const scheduleStampDitherRecompose = (args: {
  state: StampDitherStrokeData;
  onRecompose: (tileScale: number) => void;
}): void => {
  const { state, onRecompose } = args;
  const now = nowMs();
  const last = state.stampDitherRecomposeLastMs ?? 0;
  const minInterval = 50;
  if (state.stampDitherRecomposePending) {
    return;
  }
  const run = () => {
    state.stampDitherRecomposePending = false;
    state.stampDitherRecomposeLastMs = nowMs();
    const nextScale = state.stampDitherRecomposeScale ?? 1;
    onRecompose(nextScale);
  };
  const elapsed = now - last;
  state.stampDitherRecomposePending = true;
  if (elapsed >= minInterval) {
    requestAnimationFrame(run);
  } else {
    const delay = Math.max(0, minInterval - elapsed);
    setTimeout(() => {
      requestAnimationFrame(run);
    }, delay);
  }
};

export const finalizeStampDither = (args: {
  animator: ColorCycleAnimator;
  state: StampDitherStrokeData;
  config: StampDitherConfig;
  runtime: StampDitherRuntime;
  width: number;
  height: number;
  flowSlot: number;
  cycleSpeed: number;
  ditherStrength: number;
}): boolean => {
  const {
    animator,
    state,
    config,
    runtime,
    width,
    height,
    flowSlot,
    cycleSpeed,
    ditherStrength,
  } = args;
  const bounds = state.stampDitherBounds;
  const tag = state.stampDitherTag;
  const primary = state.stampDitherPrimaryBuffer;
  if (!bounds || !tag || !primary) return false;

  const algo = config.algorithm ?? 'sierra-lite';
  const isErrorDiffusion = isErrorDiffusionAlgorithm(algo);
  const isTileMask = isTileMaskAlgorithm(algo);
  if (!isErrorDiffusion && !isTileMask) return false;

  const fallbackScale = algo === 'pattern'
    ? resolvePatternFinalizeFallbackScale(state, config)
    : Math.max(1, state.stampDitherStrokeScale ?? config.pixelSize);
  const lut = buildStampSeqToTileScale(state, fallbackScale);

  const minX = Math.max(0, Math.min(width - 1, bounds.minX));
  const maxX = Math.max(0, Math.min(width - 1, bounds.maxX));
  const minY = Math.max(0, Math.min(height - 1, bounds.minY));
  const maxY = Math.max(0, Math.min(height - 1, bounds.maxY));
  if (maxX < minX || maxY < minY) return false;

  const choice = state.stampDitherChoice && state.stampDitherChoice.length === width * height
    ? state.stampDitherChoice
    : new Uint8Array(width * height);
  state.stampDitherChoice = choice;

  const scaleBounds = new Map<number, { minX: number; minY: number; maxX: number; maxY: number }>();
  const strokeEpoch = state.stampDitherStrokeEpoch ?? 1;
  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = row + x;
      const tagValue = tag[idx];
      if ((tagValue >>> 16) !== strokeEpoch) continue;
      const seq = tagValue & 0xffff;
      if (seq === 0) continue;
      const scale = lut[seq] || fallbackScale;
      let entry = scaleBounds.get(scale);
      if (!entry) {
        entry = { minX: x, minY: y, maxX: x, maxY: y };
        scaleBounds.set(scale, entry);
        continue;
      }
      entry.minX = Math.min(entry.minX, x);
      entry.minY = Math.min(entry.minY, y);
      entry.maxX = Math.max(entry.maxX, x);
      entry.maxY = Math.max(entry.maxY, y);
    }
  }

  if (scaleBounds.size === 0) return false;

  const bucket = state.stampDitherLockedBucket ?? 1;
  const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  const seed = config.seed ?? 0;

  if (isErrorDiffusion) {
    const kernel = getErrorDiffusionKernel(algo);
    const effectiveStrength = ditherStrength > 0 ? ditherStrength : 1;
    const errorIntensity = Math.max(0, Math.min(1, effectiveStrength)) * kernel.errorScale;
    const jitterScale = 0.1 * errorIntensity;

    for (const [scale, scaleBound] of scaleBounds) {
      const cellSize = Math.max(1, scale);
      const minCellX = Math.floor(scaleBound.minX / cellSize);
      const maxCellX = Math.floor(scaleBound.maxX / cellSize);
      const minCellY = Math.floor(scaleBound.minY / cellSize);
      const maxCellY = Math.floor(scaleBound.maxY / cellSize);
      const gridW = Math.max(1, maxCellX - minCellX + 1);
      const gridH = Math.max(1, maxCellY - minCellY + 1);
      const cellCount = gridW * gridH;

      const cellMask = new Uint8Array(cellCount);
      for (let y = scaleBound.minY; y <= scaleBound.maxY; y += 1) {
        const row = y * width;
        const cellY = Math.floor(y / cellSize) - minCellY;
        for (let x = scaleBound.minX; x <= scaleBound.maxX; x += 1) {
          const idx = row + x;
          const tagValue = tag[idx];
          if ((tagValue >>> 16) !== strokeEpoch) continue;
          const seq = tagValue & 0xffff;
          if (seq === 0) continue;
          const seqScale = lut[seq] || fallbackScale;
          if (seqScale !== scale) continue;
          const cellX = Math.floor(x / cellSize) - minCellX;
          const cellIdx = cellY * gridW + cellX;
          cellMask[cellIdx] = 1;
        }
      }

      const cellChoice = new Uint8Array(cellCount);
      const errBuf = new Float32Array(cellCount);

      for (let cy = 0; cy < gridH; cy += 1) {
        const leftToRight = kernel.serpentine ? (cy & 1) === 0 : true;
        const xStart = leftToRight ? 0 : gridW - 1;
        const xEnd = leftToRight ? gridW : -1;
        const xStep = leftToRight ? 1 : -1;

        for (let cx = xStart; cx !== xEnd; cx += xStep) {
          const cellIdx = cy * gridW + cx;
          if (cellMask[cellIdx] === 0) continue;
          const globalCellX = cx + minCellX;
          const globalCellY = cy + minCellY;
          const jitter = jitterScale > 0
            ? (hashStampDitherCellNoise(seed, globalCellX, globalCellY) - 0.5) * 2 * jitterScale
            : 0;
          const value = Math.max(0, Math.min(1, coverage + errBuf[cellIdx] + jitter));
          const quant = value >= 0.5 ? 1 : 0;
          cellChoice[cellIdx] = quant;
          const error = (value - quant) * errorIntensity;
          if (error === 0) continue;
          for (const tap of kernel.taps) {
            const nx = cx + (leftToRight ? tap.dx : -tap.dx);
            const ny = cy + tap.dy;
            if (nx < 0 || nx >= gridW || ny < 0 || ny >= gridH) continue;
            const nIdx = ny * gridW + nx;
            if (cellMask[nIdx] === 0) continue;
            errBuf[nIdx] += (error * tap.weight) / kernel.divisor;
          }
        }
      }

      for (let y = scaleBound.minY; y <= scaleBound.maxY; y += 1) {
        const row = y * width;
        const cellY = Math.floor(y / cellSize) - minCellY;
        for (let x = scaleBound.minX; x <= scaleBound.maxX; x += 1) {
          const idx = row + x;
          const tagValue = tag[idx];
          if ((tagValue >>> 16) !== strokeEpoch) continue;
          const seq = tagValue & 0xffff;
          if (seq === 0) continue;
          const seqScale = lut[seq] || fallbackScale;
          if (seqScale !== scale) continue;
          const cellX = Math.floor(x / cellSize) - minCellX;
          const cellIdx = cellY * gridW + cellX;
          choice[idx] = cellChoice[cellIdx];
        }
      }
    }
  } else {
    const tileCache = new Map<number, { tile: Uint8Array; tileClamp: number; originX: number; originY: number }>();
    const coverageByte = Math.max(0, Math.min(255, Math.round(coverage * 255)));

    for (let y = minY; y <= maxY; y += 1) {
      const row = y * width;
      for (let x = minX; x <= maxX; x += 1) {
        const idx = row + x;
        const tagValue = tag[idx];
        if ((tagValue >>> 16) !== strokeEpoch) continue;
        const seq = tagValue & 0xffff;
        if (seq === 0) continue;
        const seqScale = lut[seq] || fallbackScale;
        let tileEntry = tileCache.get(seqScale);
        if (!tileEntry) {
          const baseSize = resolveStampDitherBaseSize(seqScale);
          const originU = {
            x: (seed % baseSize) | 0,
            y: ((seed >>> 16) % baseSize) | 0,
          };
          const originX = -originU.x * seqScale;
          const originY = -originU.y * seqScale;
          const tileClamp = baseSize * seqScale;
          const tile = getStampDitherTile(
            runtime,
            bucket,
            seqScale,
            baseSize,
            algo,
            config.patternStyle ?? 'dots',
            config.imageTileThresholdResolver,
          );
          tileEntry = { tile, tileClamp, originX, originY };
          tileCache.set(seqScale, tileEntry);
        }

        const localY = ((y - tileEntry.originY) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
        const tileRow = localY * tileEntry.tileClamp;
        const localX = ((x - tileEntry.originX) % tileEntry.tileClamp + tileEntry.tileClamp) % tileEntry.tileClamp;
        const tileValue = tileEntry.tile[tileRow + localX];
        choice[idx] = algo === 'pattern'
          ? (tileValue === 1 ? 1 : 0)
          : (tileValue <= coverageByte ? 1 : 0);
      }
    }
  }

  const handle = state.stampDitherFillHandle ?? animator.beginDirectFill();
  const shouldCloseHandle = !state.stampDitherFillHandle;
  const data = handle.data;
  const gid = handle.gradientId;
  const spd = handle.speedData;
  const speedByte = encodeColorCycleSpeedByte(cycleSpeed);
  const bgFillOff = !config.bgFill;
  const base = state.stampDitherBaseIdx;
  const baseG = state.stampDitherBaseGid;
  const baseTag = state.stampDitherBaseTag;
  const def = state.gradientDefIdBuffer;

  for (let y = minY; y <= maxY; y += 1) {
    const row = y * width;
    for (let x = minX; x <= maxX; x += 1) {
      const idx = row + x;
      const tagValue = tag[idx];
      if ((tagValue >>> 16) !== strokeEpoch) continue;
      if ((tagValue & 0xffff) === 0) continue;
      const usePrimary = choice[idx] === 1;
      const primaryIndex = primary[idx];
      if (usePrimary) {
        data[idx] = primaryIndex;
        gid[idx] = primaryIndex === 0 ? 0 : flowSlot;
        spd[idx] = primaryIndex === 0 ? 0 : speedByte;
        if (def) def[idx] = 0;
        continue;
      }
      if (bgFillOff) {
        if (base && baseTag && base.length === data.length && baseTag[idx] === strokeEpoch) {
          const v = base[idx];
          data[idx] = v;
          if (v === 0) {
            gid[idx] = 0;
            spd[idx] = 0;
            if (def) def[idx] = 0;
          } else if (baseG && baseG.length === gid.length) {
            gid[idx] = baseG[idx];
            if (def) {
              def[idx] = 0;
            }
          } else {
            gid[idx] = flowSlot;
            if (def) def[idx] = 0;
          }
        }
        continue;
      }
      const secondary = resolveStampDitherSecondaryIndex(primaryIndex);
      data[idx] = secondary;
      gid[idx] = secondary === 0 ? 0 : flowSlot;
      spd[idx] = secondary === 0 ? 0 : speedByte;
      if (def) def[idx] = 0;
    }
  }

  if (shouldCloseHandle) {
    const needsUpload = animator.hasWebGL?.() ?? false;
    animator.endDirectFill({ markDirty: needsUpload });
  }
  animator.markDirtyBounds({
    minX,
    minY,
    width: maxX - minX + 1,
    height: maxY - minY + 1,
  });

  return true;
};
