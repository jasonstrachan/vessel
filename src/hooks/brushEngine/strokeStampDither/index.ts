import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import { encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';
import { isCumulativeThresholdResolver } from '@/utils/ditherPatterns/cumulativeThresholdPattern';
import type { StampDitherRuntime } from './runtime';
import {
  nowMs,
  resolvePressureLinkedTileScale,
  resolveStampDitherBucket,
  resolveStampDitherCoverage,
  resolveStampDitherPatternBucket,
  STAMP_DITHER_BUCKETS,
  type StampDitherAlgorithm,
  type StampDitherConfig,
} from './coverage';
import {
  getStampDitherTile,
  resolveStampDitherBaseSize,
} from './tile';
import {
  applyStampDitherMask,
  resolveStampDitherSecondaryIndex,
  type StampDitherBgFillWriter,
} from './mask';
import {
  ensureStampDitherBaseBuffers,
  type StampDitherShape,
  type StampDitherStrokeData,
} from './state';
export {
  finalizeStampDither,
  recomposeStampDitherOverlay,
  sampleStampDitherReplayMask,
  scheduleStampDitherRecompose,
} from './replay';
export {
  clearStampDitherRuntime,
  createStampDitherRuntime,
  syncStampDitherRuntimeVersion,
  type StampDitherRuntime,
} from './runtime';
export {
  resolveStampDitherBucket,
  resolveStampDitherCoverage,
  resolveStampDitherPatternBucket,
  STAMP_DITHER_FINALIZE_ERROR_DIFFUSION_ALGOS,
  type StampDitherAlgorithm,
  type StampDitherConfig,
} from './coverage';
export {
  resolveStampDitherBaseSize,
  resolveStampDitherTileSample,
  STAMP_DITHER_BUCKETS,
} from './tile';
export {
  ensureStampDitherBaseBuffers,
  ensureStampDitherBuffers,
  ensureStampDitherTag,
  type StampDitherShape,
  type StampDitherState,
  type StampDitherStrokeData,
} from './state';
export { resolveStampDitherSecondaryIndex } from './mask';

const applyStampDitherToRegion = (
  strokeData: StampDitherStrokeData,
  animator: ColorCycleAnimator,
  bounds: { minX: number; minY: number; maxX: number; maxY: number },
  tile: Uint8Array,
  tileSize: number,
  maskOriginX: number,
  maskOriginY: number,
  flowSlot: number,
  stampSeq: number,
  cycleSpeed: number,
  bgFill: boolean,
  algo: StampDitherAlgorithm,
  coverage: number
) => {
  const primary = strokeData.stampDitherPrimaryBuffer;
  const tag = strokeData.stampDitherTag;
  if (!primary || !tag) {
    return;
  }
  const strokeEpoch = strokeData.stampDitherStrokeEpoch ?? 1;
  const tagValue = ((strokeEpoch & 0xffff) << 16) | (stampSeq & 0xffff);

  const handle = strokeData.stampDitherFillHandle ?? animator.beginDirectFill();
  const shouldCloseHandle = !strokeData.stampDitherFillHandle;
  const data = handle.data;
  const gradientId = handle.gradientId;
  const speedData = handle.speedData;
  const defData = strokeData.gradientDefIdBuffer;
  const speedByte = encodeColorCycleSpeedByte(cycleSpeed);
  const width = handle.width;
  const minX = Math.max(0, Math.min(width - 1, bounds.minX));
  const maxX = Math.max(0, Math.min(width - 1, bounds.maxX));
  const minY = Math.max(0, Math.min(handle.height - 1, bounds.minY));
  const maxY = Math.max(0, Math.min(handle.height - 1, bounds.maxY));
  const tileClamp = Math.max(1, Math.floor(tileSize));
  const bgFillOff = !bgFill;

  const coverageByte = Math.max(0, Math.min(255, Math.round(coverage * 255)));
  if (!bgFillOff) {
    const usePattern = algo === 'pattern';
    for (let py = minY; py <= maxY; py++) {
      const rowOffset = py * width;
      const localY = ((py - maskOriginY) % tileClamp + tileClamp) % tileClamp;
      const tileRow = localY * tileClamp;
      let localX = ((minX - maskOriginX) % tileClamp + tileClamp) % tileClamp;
      for (let px = minX; px <= maxX; px++) {
        const idx = rowOffset + px;
        if (tag[idx] !== tagValue) {
          localX += 1;
          if (localX === tileClamp) localX = 0;
          continue;
        }
        const t = tile ? tile[tileRow + localX] : 0;
        const usePrimary = usePattern ? t === 1 : t <= coverageByte;
        const nextIndex = usePrimary
          ? primary[idx]
          : resolveStampDitherSecondaryIndex(primary[idx]);
        data[idx] = nextIndex;
        gradientId[idx] = nextIndex === 0 ? 0 : flowSlot;
        speedData[idx] = nextIndex === 0 ? 0 : speedByte;
        if (defData) defData[idx] = 0;
        localX += 1;
        if (localX === tileClamp) localX = 0;
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
    return;
  }

  for (let py = minY; py <= maxY; py++) {
    const rowOffset = py * width;
    const localY = ((py - maskOriginY) % tileClamp + tileClamp) % tileClamp;
    const tileRow = localY * tileClamp;
    let localX = ((minX - maskOriginX) % tileClamp + tileClamp) % tileClamp;
    for (let px = minX; px <= maxX; px++) {
      const idx = rowOffset + px;
      if (tag[idx] !== tagValue) {
        localX += 1;
        if (localX === tileClamp) localX = 0;
        continue;
      }
      const tileIdx = tileRow + localX;
      const t = tile ? tile[tileIdx] : 0;
      const usePrimary =
        algo === 'pattern'
          ? (t === 1)
          : (t <= coverageByte);
      if (bgFillOff && !usePrimary) {
        const base = strokeData.stampDitherBaseIdx;
        const baseG = strokeData.stampDitherBaseGid;
        const baseTag = strokeData.stampDitherBaseTag;
        if (base && baseTag && base.length === data.length && baseTag[idx] === strokeEpoch) {
          const v = base[idx];
          data[idx] = v;
          if (v === 0) {
            gradientId[idx] = 0;
            speedData[idx] = 0;
            if (defData) defData[idx] = 0;
          } else if (baseG && baseG.length === gradientId.length) {
            gradientId[idx] = baseG[idx];
            if (defData) {
              defData[idx] = 0;
            }
          } else {
            gradientId[idx] = flowSlot;
            if (defData) defData[idx] = 0;
          }
        } else {
          localX += 1;
          if (localX === tileClamp) localX = 0;
          continue;
        }
        localX += 1;
        if (localX === tileClamp) localX = 0;
        continue;
      }
      const primaryIndex = primary[idx];

      if (usePrimary) {
        data[idx] = primaryIndex;
        gradientId[idx] = primaryIndex === 0 ? 0 : flowSlot;
        speedData[idx] = primaryIndex === 0 ? 0 : speedByte;
        if (defData) defData[idx] = 0;
        localX += 1;
        if (localX === tileClamp) localX = 0;
        continue;
      }

      const secondary = resolveStampDitherSecondaryIndex(primaryIndex);
      data[idx] = secondary;
      gradientId[idx] = secondary === 0 ? 0 : flowSlot;
      speedData[idx] = secondary === 0 ? 0 : speedByte;
      if (defData) defData[idx] = 0;
      localX += 1;
      if (localX === tileClamp) localX = 0;
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

export const applyStampDitherStamp = (args: {
  animator: ColorCycleAnimator;
  state: StampDitherStrokeData;
  config: StampDitherConfig;
  runtime: StampDitherRuntime;
  stampShape: StampDitherShape;
  x: number;
  y: number;
  pressure: number;
  pressureSize: number;
  primaryIndex: number;
  flowSlot: number;
  cycleSpeed: number;
  width: number;
  height: number;
  isAnimating: boolean;
  onScheduleRecompose?: (tileScale: number) => void;
  perf?: {
    onMask?: (ms: number, bounds: { minX: number; minY: number; maxX: number; maxY: number }) => void;
    onApply?: (ms: number) => void;
  };
}): { didApply: boolean; bounds?: { minX: number; minY: number; maxX: number; maxY: number } } => {
  const {
    animator,
    state,
    config,
    runtime,
    stampShape,
    x,
    y,
    pressure,
    pressureSize,
    primaryIndex,
    flowSlot,
    cycleSpeed,
    width,
    height,
    isAnimating,
    onScheduleRecompose,
  } = args;

  const baseTileScale = Math.max(1, config.pixelSize);
  const diversity = state.stampDitherDiversity ?? Math.max(0, Math.min(1, config.diversity ?? 1));
  state.stampDitherDiversity = diversity;
  let tileScale = baseTileScale;
  if (config.pressureLinked) {
    tileScale = resolvePressureLinkedTileScale(state, baseTileScale, pressure);
    if (state.stampSeqMeta?.length) {
      state.stampSeqMeta = undefined;
      state.stampSeqToTileScale = undefined;
    }
  } else {
    state.stampDitherPressureState = null;
    state.stampDitherStrokeScale = undefined;
  }
  state.stampDitherStrokeScale = tileScale;
  const tileScaleInt = tileScale;
  let tileSize = 0;

  if (!config.bgFill && !state.stampDitherBaseTag) {
    ensureStampDitherBaseBuffers(state, width, height);
  }
  const rawAlgo = config.algorithm || 'sierra-lite';
  const algo: StampDitherAlgorithm = rawAlgo === 'pattern' ? 'pattern' : 'sierra-lite';
  const isMarkTonePattern = algo === 'pattern' &&
    isCumulativeThresholdResolver(config.imageTileThresholdResolver) &&
    config.imageTileThresholdResolver.coveragePolicy === 'mark-tone-map';
  const shouldLockPatternTone = isMarkTonePattern;
  const isFirstStamp = (state.stampDitherStampSeq ?? 0) === 0;
  if (state.stampDitherLockedBucket == null || (shouldLockPatternTone && isFirstStamp)) {
    const phaseForMask = 0.5;
    const coverage = resolveStampDitherCoverage(phaseForMask, primaryIndex, isAnimating);
    const rawBucket = resolveStampDitherBucket(coverage);
    state.stampDitherLockedBucket = shouldLockPatternTone
      ? resolveStampDitherPatternBucket(
          rawBucket,
          config.patternStyle,
          primaryIndex,
          config.imageTileThresholdResolver,
          true,
        )
      : Math.min(STAMP_DITHER_BUCKETS - 2, Math.max(1, rawBucket));
  }

  const lastScale = state.stampDitherLastTileScale;
  if (lastScale == null) {
    state.stampDitherLastTileScale = tileScaleInt;
  } else if (lastScale !== tileScaleInt) {
    state.stampDitherLastTileScale = tileScaleInt;
    onScheduleRecompose?.(tileScaleInt);
  }

  const baseSize = resolveStampDitherBaseSize(tileScaleInt);
  if (!state.stampDitherOriginUnits || state.stampDitherOriginBaseSize !== baseSize) {
    const seed = config.seed ?? 0;
    state.stampDitherOriginUnits = {
      x: (seed % baseSize) | 0,
      y: ((seed >>> 16) % baseSize) | 0,
    };
    state.stampDitherOriginBaseSize = baseSize;
  }
  tileSize = baseSize * tileScaleInt;
  const originU = state.stampDitherOriginUnits ?? { x: 0, y: 0 };
  const maskOriginX = -originU.x * tileScaleInt;
  const maskOriginY = -originU.y * tileScaleInt;
  state.stampDitherOrigin = { x: maskOriginX, y: maskOriginY };

  const lockedBucket = state.stampDitherLockedBucket ?? 1;
  const bucket = algo === 'pattern' && !shouldLockPatternTone
    ? resolveStampDitherPatternBucket(
        lockedBucket,
        config.patternStyle,
        primaryIndex,
        config.imageTileThresholdResolver,
      )
    : lockedBucket;
  const tile = getStampDitherTile(
    runtime,
    bucket,
    tileScaleInt,
    baseSize,
    algo,
    config.patternStyle ?? 'dots',
    config.imageTileThresholdResolver,
    diversity,
  );

  const nextSeq = (state.stampDitherStampSeq ?? 0) + 1;
  state.stampDitherStampSeq = nextSeq > 0xffff ? 0xffff : nextSeq;
  const stampSeq = state.stampDitherStampSeq ?? 1;
  const coverage = bucket / Math.max(1, STAMP_DITHER_BUCKETS - 1);
  const fusedBgFill = config.bgFill;
  const fusedHandle = fusedBgFill ? (state.stampDitherFillHandle ?? animator.beginDirectFill()) : undefined;
  const fusedShouldCloseHandle = fusedBgFill && !state.stampDitherFillHandle;
  const fusedWriter: StampDitherBgFillWriter | undefined = fusedHandle
    ? {
        data: fusedHandle.data,
        gradientId: fusedHandle.gradientId,
        speedData: fusedHandle.speedData,
        defData: state.gradientDefIdBuffer,
        tile,
        tileClamp: tileSize,
        maskOriginX,
        maskOriginY,
        flowSlot,
        speedByte: encodeColorCycleSpeedByte(cycleSpeed),
        coverageByte: Math.max(0, Math.min(255, Math.round(coverage * 255))),
        usePattern: algo === 'pattern',
      }
    : undefined;

  const maskStart = nowMs();
  const stampBounds = applyStampDitherMask(
    state,
    width,
    height,
    stampShape,
    x,
    y,
    pressureSize,
    primaryIndex,
    stampSeq,
    config.bgFill,
    fusedWriter
  );
  const maskMs = Math.max(0, nowMs() - maskStart);
  if (stampBounds) {
    args.perf?.onMask?.(maskMs, stampBounds);
  }
  if (stampBounds && state.stampSeqMeta) {
    state.stampSeqMeta.push([stampSeq, tileScaleInt]);
  }

  if (fusedBgFill) {
    if (fusedShouldCloseHandle) {
      const needsUpload = animator.hasWebGL?.() ?? false;
      animator.endDirectFill({ markDirty: needsUpload });
    }
    animator.markDirtyBounds({
      minX: stampBounds.minX,
      minY: stampBounds.minY,
      width: stampBounds.maxX - stampBounds.minX + 1,
      height: stampBounds.maxY - stampBounds.minY + 1,
    });
    args.perf?.onApply?.(0);
    return { didApply: true, bounds: stampBounds };
  }

  const applyStart = nowMs();
  applyStampDitherToRegion(
    state,
    animator,
    stampBounds,
    tile,
    tileSize,
    maskOriginX ?? stampBounds.minX,
    maskOriginY ?? stampBounds.minY,
    flowSlot,
    stampSeq,
    cycleSpeed,
    config.bgFill,
    algo,
    coverage
  );
  args.perf?.onApply?.(Math.max(0, nowMs() - applyStart));

  return { didApply: true, bounds: stampBounds };
};
