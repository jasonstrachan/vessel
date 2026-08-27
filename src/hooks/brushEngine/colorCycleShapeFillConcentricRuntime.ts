import { getAppStoreState } from '@/stores/appStoreAccess';
import { normalizeColorCycleSampledMotion } from '@/utils/colorCycleSampledMotion';
import { debugLog, debugWarn, isDebugEnabled } from '@/utils/debug';
import { ccWarn } from '@/utils/colorCycle/ccDebug';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import { resolveStableFlatSeed } from '@/utils/colorCycle/ccFlatSeed';
import { computeConcentricMaxDistance, fillConcentricIndices } from '@/utils/colorCycle/concentricFillCore';
import { simplifyToVertexLimit } from '@/utils/polygonSimplify';
import { recordColorCycleFillPerf } from '@/utils/perf/ccPerfProbe';
import { runConcentricFillJob } from '@/workers/colorCycleFillClient';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';

import type { FillOptions } from './colorCycleCanvas2DTypes';
import { createYieldController, nowMs } from './colorCycleCanvas2DUtils';
import { applyLostEdgeFromWrittenMask, captureRegionU16, captureRegionU8 } from './colorCycleShapeFillBuffers';
import { tryRunConcentricPerceptualFill } from './colorCycleShapeFillConcentricPerceptualRuntime';
import type { ColorCycleShapeFillExecutionContext } from './colorCycleShapeFillExecutionTypes';

const logCcGradientDitherCall = (event: string, data: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  appendCCDebugOverlayEntry('log', `cc gradient dither call: ${event}`, data);
};

export async function runColorCycleConcentricShapeFill(
  context: ColorCycleShapeFillExecutionContext,
  vertices: Array<{ x: number; y: number }>,
  layerId: string,
  spacing?: number,
  options?: FillOptions
) {
  if (!layerId) {
    throw new Error('fillShape requires a layerId');
  }

  if (!vertices || !Array.isArray(vertices)) {
    debugWarn('raw-console', 'Invalid vertices provided to fillShape');
    return;
  }

  if (vertices.length < 3) {
    debugWarn('raw-console', 'fillShape requires at least 3 vertices');
    return;
  }

  const id = layerId;
  const yieldIfNeeded = createYieldController();
  const {
    animator,
    strokeData,
    activeSlot,
    activeDefId,
    flowSlot,
  } = context.prepareShapeFillLayer({
    layerId: id,
    options,
    canvasPixelCount: context.getCanvasPixelCount(),
    hasStrokeState: (targetLayerId) => context.hasStrokeState(targetLayerId),
    createStrokeState: () => context.createLayerStrokeState({ hasContent: true, contentIsOptimistic: true }),
    setStrokeState: (targetLayerId, state) => context.setLayerStrokeState(targetLayerId, state),
    getStrokeState: (targetLayerId) => context.getStrokeState(targetLayerId),
    refreshShapeFillWriteSpeed: (state) => context.refreshShapeFillWriteSpeed(state),
    getActiveSlot: (targetLayerId) => context.getActiveSlot(targetLayerId),
    getFlowMode: () => context.getFlowMode(),
    resolveFlowSlot: (state, slot) => context.resolveFlowSlot(state, slot),
    ensureFullResolution: (targetLayerId) => context.ensureFullResolution(targetLayerId, 'fill'),
    bindStrokeBuffersToAnimator: (state, targetAnimator) => context.bindStrokeBuffersToAnimator(state, targetAnimator),
  });
  const logCcFill = isDebugEnabled('cc-fill');
  if (logCcFill) {
    debugLog('cc-fill', '[CC fill] uses slot', {
      layerId: id,
      activeSlot,
      flowSlot,
      encoded: strokeData?.flow?.encoded,
    });
  }

  let minX = Infinity, maxX = -Infinity;
  let minY = Infinity, maxY = -Infinity;

  for (const v of vertices) {
    minX = Math.min(minX, v.x);
    maxX = Math.max(maxX, v.x);
    minY = Math.min(minY, v.y);
    maxY = Math.max(maxY, v.y);
  }

  minX = Math.max(0, Math.floor(minX));
  maxX = Math.min(context.getCanvasWidth() - 1, Math.ceil(maxX));
  minY = Math.max(0, Math.floor(minY));
  maxY = Math.min(context.getCanvasHeight() - 1, Math.ceil(maxY));

  const fullMinX = minX;
  const fullMaxX = maxX;
  const fullMinY = minY;
  const fullMaxY = maxY;

  let fillMinX = fullMinX;
  let fillMaxX = fullMaxX;
  let fillMinY = fullMinY;
  let fillMaxY = fullMaxY;
  if (options?.roi) {
    const roiMinX = Math.floor(options.roi.x);
    const roiMinY = Math.floor(options.roi.y);
    const roiMaxX = Math.ceil(options.roi.x + options.roi.width - 1);
    const roiMaxY = Math.ceil(options.roi.y + options.roi.height - 1);
    fillMinX = Math.max(fillMinX, roiMinX);
    fillMinY = Math.max(fillMinY, roiMinY);
    fillMaxX = Math.min(fillMaxX, roiMaxX);
    fillMaxY = Math.min(fillMaxY, roiMaxY);
    if (fillMinX > fillMaxX || fillMinY > fillMaxY) {
      return;
    }
  }

  const noiseSeed = (context.getStampCounter() & 0xffff) / 65535;
  const fullBboxWidth = Math.max(0, Math.ceil(fullMaxX) - Math.floor(fullMinX) + 1);
  const fullBboxHeight = Math.max(0, Math.ceil(fullMaxY) - Math.floor(fullMinY) + 1);
  const fullBBox = {
    minX: Math.floor(fullMinX),
    minY: Math.floor(fullMinY),
    width: Math.max(1, fullBboxWidth),
    height: Math.max(1, fullBboxHeight),
  };
  const bboxWidth = Math.max(0, Math.ceil(fillMaxX) - Math.floor(fillMinX) + 1);
  const bboxHeight = Math.max(0, Math.ceil(fillMaxY) - Math.floor(fillMinY) + 1);
  const bbox = {
    minX: Math.floor(fillMinX),
    minY: Math.floor(fillMinY),
    width: Math.max(1, bboxWidth),
    height: Math.max(1, bboxHeight),
  };
  const prevIdx = captureRegionU8(strokeData?.buffers.paint ?? new Uint8Array(0), context.getCanvasWidth(), bbox);
  const prevGid = strokeData?.buffers.gid
    ? captureRegionU8(strokeData.buffers.gid, context.getCanvasWidth(), bbox)
    : new Uint8Array(bbox.width * bbox.height);
  const prevSpd = strokeData?.buffers.spd
    ? captureRegionU8(strokeData.buffers.spd, context.getCanvasWidth(), bbox)
    : new Uint8Array(bbox.width * bbox.height);
  const prevFlow = strokeData?.buffers.flow
    ? captureRegionU8(strokeData.buffers.flow, context.getCanvasWidth(), bbox)
    : new Uint8Array(bbox.width * bbox.height);
  const prevPhase = strokeData?.buffers.phase
    ? captureRegionU8(strokeData.buffers.phase, context.getCanvasWidth(), bbox)
    : new Uint8Array(bbox.width * bbox.height);
  const prevDef = strokeData?.buffers.def
    ? captureRegionU16(strokeData.buffers.def, context.getCanvasWidth(), bbox)
    : new Uint16Array(bbox.width * bbox.height);
  const writtenMask = new Uint8Array(bbox.width * bbox.height);
  const spacingValue = context.normalizeBandSpacingValue(spacing);
  const maxDist = computeConcentricMaxDistance(vertices, fullBBox);
  const ccGradient = options?.ccGradient === true;
  const lostEdge = Number.isFinite(options?.lostEdge)
    ? Math.max(0, Math.min(100, Math.round(options?.lostEdge as number)))
    : 0;
  const ditherLevels = Number.isFinite(options?.ditherLevels)
    ? Math.max(1, Math.min(254, Math.floor(options?.ditherLevels as number)))
    : null;
  const baseOffset = context.getStampCounter() % 255;
  const numBands = ccGradient
    ? Math.max(2, Math.min(254, Math.floor(context.getGradientBands() || 12)))
    : context.deriveBandCountFromDistance(maxDist, spacingValue);
  const stepPerBand = numBands > 1 ? 254 / (numBands - 1) : 254;
  const fillAlgorithm = context.getStampDitherAlgorithm();
  const pairBandCount = Math.max(0, Math.floor(options?.ditherPairBandCount ?? 0));
  const sampledMotionOverride = normalizeColorCycleSampledMotion(options?.sampledMotionOverride);
  const sampledPhaseOverride = sampledMotionOverride?.phaseByte;
  const { speedByte, flowByte } = sampledMotionOverride ?? context.resolveShapeAnimationBytes(
    strokeData,
    {
      ccGradient,
      pairBandCount,
      ditherAlgorithm: fillAlgorithm,
    },
  );
  const shapePhaseBaseByte = sampledPhaseOverride ?? context.resolveShapePhaseBaseByte({
    ccGradient,
    pairBandCount,
    effectiveColorCount: numBands,
    markId: options?.shapePhaseSeedMarkId ?? null,
    bounds: bbox,
    points: vertices,
  });
  const resolveConcentricPhaseByte = (_x: number, _y: number, colorIndex: number) => {
    if (colorIndex <= 0) {
      return 0;
    }
    if (sampledPhaseOverride !== undefined) {
      return sampledPhaseOverride;
    }
    return context.resolveShapePhaseByte(1, {
      ccGradient,
      pairBandCount,
      effectiveColorCount: numBands,
      shapePhaseBaseByte,
    });
  };

  const flatCycleDither =
    ccGradient && context.isDitherEnabled() && options?.ditherFlatCycle === true;
  if (!context.isPerceptualDitherEnabled() && !flatCycleDither) {
    try {
      const tryGPU = lostEdge <= 0;
      const ditherStrengthGpu = context.isDitherEnabled() ? context.getDitherStrength() : 0;
      const ditherPixelSizeGpu = context.isDitherEnabled() ? Math.max(1, context.getDitherPixelSize()) : 1;
      const runtimeMax = animator.getGLFillMaxVerts() || 256;
      const GPU_MAX_VERTS = Math.max(8, Math.min(256, runtimeMax));
      let gpuVertices = vertices;
      if (tryGPU && vertices.length > GPU_MAX_VERTS) {
        const simplified = simplifyToVertexLimit(vertices, GPU_MAX_VERTS, {
          initialTolerance: 0.25,
          maxTolerance: 10,
          stepFactor: 1.45,
        });
        if (simplified.length <= GPU_MAX_VERTS) {
          gpuVertices = simplified;
        } else {
          ccWarn('[ColorCycleBrush] Concentric GPU fallback (vertex budget)', {
            original: vertices.length,
            simplified: simplified.length,
            limit: GPU_MAX_VERTS,
          });
        }
      }
      if (tryGPU && gpuVertices.length <= GPU_MAX_VERTS) {
        try {
          const gpuStart = nowMs();
          const ok = animator.gpuFillShape(gpuVertices, {
            mode: 'concentric',
            bands: numBands,
            baseOffset,
            colorStep: stepPerBand,
            maxDist,
            bbox,
            ditherStrength: ditherStrengthGpu,
            ditherPixelSize: ditherPixelSizeGpu,
            noiseSeed,
          }, flowSlot, speedByte, flowByte, resolveConcentricPhaseByte);
          if (ok) {
            if (strokeData) {
              context.stampGradientDefForGpuShapeFillResult(strokeData, animator, bbox, activeDefId, flowSlot);
            }
            if (logCcFill) {
              const gpuBuffers = animator.getIndexBuffers();
              context.logShapeFillBufferSnapshot({
                layerId: id,
                mode: 'concentric',
                path: 'gpu',
                ccGradient,
                ditherEnabled: context.isDitherEnabled(),
                colors: numBands,
                bbox,
                width: context.getCanvasWidth(),
                paint: gpuBuffers.data,
                speed: gpuBuffers.spd ?? new Uint8Array(0),
                flow: gpuBuffers.flow ?? new Uint8Array(0),
                phase: gpuBuffers.phase ?? new Uint8Array(0),
              });
            }
            const stampCounter = context.advanceStampCounter(numBands);
            if (strokeData) strokeData.stampCounter = stampCounter;
            context.markPresenterLayerDirty(id);
            animator.forceRender();
            context.render(false);
            recordColorCycleFillPerf({
              path: 'gpu',
              mode: 'concentric',
              durationMs: nowMs() - gpuStart,
              area: bbox.width * bbox.height,
              vertices: gpuVertices.length,
            });
            if (strokeData) {
              context.snapshotFromBuffers(strokeData);
            }
            return;
          }
        } catch (error) {
          ccWarn('[ColorCycleBrush] Concentric GPU path threw; falling back to CPU', error);
        }
      }
    } catch (error) {
      ccWarn('[ColorCycleBrush] Concentric GPU setup failed; falling back to CPU', error);
    }
  }

  const concentricPerf = { start: nowMs(), logged: false };
  const logConcentricFill = (path: 'cpu' | 'worker') => {
    if (concentricPerf.logged) return;
    concentricPerf.logged = true;
    recordColorCycleFillPerf({
      path,
      mode: 'concentric',
      durationMs: nowMs() - concentricPerf.start,
      area: bbox.width * bbox.height,
      vertices: vertices.length,
    });
  };

  const directConcentricHandle = animator.beginDirectFill();
  if (ccGradient && typeof animator.setStrokeSpeedByte === 'function') {
    animator.setStrokeSpeedByte(speedByte);
  }
  if (activeSlot !== 0) {
    animator.markGradientSlotUsed(activeSlot);
  }
  const concentricBuffer = directConcentricHandle.data;
  const concentricGradientId = directConcentricHandle.gradientId;
  const concentricSpeedData = directConcentricHandle.speedData;
  const concentricFlowData = directConcentricHandle.flowData;
  const concentricPhaseData = directConcentricHandle.phaseData;
  const concentricDefData = strokeData?.buffers.def;
  if (strokeData) {
    strokeData.buffers.paint = concentricBuffer;
    strokeData.buffers.gid = concentricGradientId;
    strokeData.buffers.spd = concentricSpeedData;
    strokeData.buffers.flow = concentricFlowData;
    strokeData.buffers.phase = concentricPhaseData;
  }
  const concentricWidth = directConcentricHandle.width;
  const concentricHeight = directConcentricHandle.height;
  const writeConcentricIndex = (
    x: number,
    y: number,
    colorIndex: number,
    phaseByte: number = sampledPhaseOverride ?? 0
  ) => {
    if (x < 0 || y < 0 || x >= concentricWidth || y >= concentricHeight) {
      return;
    }
    const clamped = Math.max(0, Math.min(255, colorIndex | 0));
    const idx = y * concentricWidth + x;
    concentricBuffer[idx] = clamped;
    context.markStrokeStateContentWritten(strokeData);
    concentricGradientId[idx] = clamped === 0 ? 0 : flowSlot;
    concentricSpeedData[idx] = clamped === 0 ? 0 : speedByte;
    concentricFlowData[idx] = clamped === 0 ? 0 : flowByte;
    concentricPhaseData[idx] = clamped === 0 ? 0 : phaseByte;
    if (activeDefId !== null && concentricDefData && concentricDefData.length === concentricBuffer.length) {
      concentricDefData[idx] = clamped === 0 ? 0 : activeDefId;
    }
    const localX = x - bbox.minX;
    const localY = y - bbox.minY;
    if (localX >= 0 && localY >= 0 && localX < bbox.width && localY < bbox.height) {
      if (clamped !== 0) writtenMask[localY * bbox.width + localX] = 255;
    }
  };
  const blitLocalBuffer = (local: Uint8Array) => {
    const bw = bbox.width;
    const bh = bbox.height;
    for (let row = 0; row < bh; row++) {
      const destY = bbox.minY + row;
      if (destY < 0 || destY >= concentricHeight) continue;
      const srcRowOffset = row * bw;
      const destRowOffset = destY * concentricWidth;
      for (let col = 0; col < bw; col++) {
        const value = local[srcRowOffset + col];
        if (value === 0) continue;
        const destX = bbox.minX + col;
        if (destX < 0 || destX >= concentricWidth) continue;
        const destIndex = destRowOffset + destX;
        concentricBuffer[destIndex] = value;
        concentricGradientId[destIndex] = value === 0 ? 0 : flowSlot;
        concentricSpeedData[destIndex] = value === 0 ? 0 : speedByte;
        concentricFlowData[destIndex] = value === 0 ? 0 : flowByte;
        concentricPhaseData[destIndex] = resolveConcentricPhaseByte(destX, destY, value);
        if (activeDefId !== null && concentricDefData && concentricDefData.length === concentricBuffer.length) {
          concentricDefData[destIndex] = activeDefId;
        }
        writtenMask[srcRowOffset + col] = 255;
      }
    }
  };
  const finalizeFill = (path: 'cpu' | 'worker', countOverride?: number) => {
    const count = countOverride ?? numBands;
    if (lostEdge > 0) {
      applyLostEdgeFromWrittenMask({
        writtenMask,
        prevIdx,
        prevGid,
        prevSpd,
        prevFlow,
        prevPhase,
        prevDef,
        paint: concentricBuffer,
        gid: concentricGradientId,
        spd: concentricSpeedData,
        flow: concentricFlowData,
        phase: concentricPhaseData,
        def: concentricDefData,
        fullW: concentricWidth,
        bbox,
        lostEdge,
        tileSize: context.resolveLostEdgeTileSize(),
      });
    }
    const stampCounter = context.advanceStampCounter(count);
    if (strokeData) strokeData.stampCounter = stampCounter;
    context.markPresenterLayerDirty(id);
    animator.markDirtyBounds(bbox);
    if (logCcFill) {
      context.logShapeFillBufferSnapshot({
        layerId: id,
        mode: 'concentric',
        path,
        ccGradient,
        ditherEnabled: context.isDitherEnabled(),
        colors: count,
        bbox,
        width: concentricWidth,
        paint: concentricBuffer,
        speed: concentricSpeedData,
        flow: concentricFlowData,
        phase: concentricPhaseData,
      });
    }
    animator.forceRender();
    context.render(false);
    logConcentricFill(path);
  };

  try {
    const fillPatternStyle = context.getStampDitherPatternStyle();
    if (ccGradient && context.isDitherEnabled()) {
      const quantLevels = ditherLevels ?? (pairBandCount > 0 ? Math.max(2, numBands) : 1);
      const pixelSize = Math.max(1, Math.floor(options?.ditherPixelSize ?? context.getDitherPixelSize()));
      const flatPairSpread =
        options?.ditherPaletteSpread ??
        getAppStoreState().tools?.brushSettings?.ditherPaletteSpread;
      const activeSession = getActiveMarkGradientSession(id);
      const phaseSeedMarkId = options?.shapePhaseSeedMarkId ?? activeSession?.markId ?? null;
      const flatSeed = resolveStableFlatSeed({
        markId: phaseSeedMarkId,
        bounds: {
          minX: bbox.minX,
          minY: bbox.minY,
          width: bbox.width,
          height: bbox.height,
        },
        points: vertices,
      });
      const edges = new Array(vertices.length);
      for (let i = 0; i < vertices.length; i += 1) {
        const v1 = vertices[i];
        const v2 = vertices[(i + 1) % vertices.length];
        const dx = v2.x - v1.x;
        const dy = v2.y - v1.y;
        edges[i] = { v1x: v1.x, v1y: v1.y, dx, dy, len2: dx * dx + dy * dy };
      }
      const safeMaxDist = Math.max(1e-6, maxDist);
      logCcGradientDitherCall('brush-concentric before fill', {
        layerId: id,
        algorithm: fillAlgorithm,
        patternStyle: fillPatternStyle,
        levels: quantLevels,
        pairBandCount,
        numBands,
        gradientBands: context.getGradientBands(),
        ditherEnabled: context.isDitherEnabled(),
        activeSessionSource: activeSession?.source ?? null,
        traceStage: 'brush-concentric',
        traceId: phaseSeedMarkId ? `${phaseSeedMarkId}:brush-concentric` : null,
        flatSeed,
        vertexCount: vertices.length,
        bounds: {
          minX: bbox.minX,
          minY: bbox.minY,
          width: bbox.width,
          height: bbox.height,
        },
      });
      await fillCcGradientDither({
        vertices,
        minX: bbox.minX,
        minY: bbox.minY,
        maxX: bbox.minX + bbox.width - 1,
        maxY: bbox.minY + bbox.height - 1,
        pixelSize,
        levels: quantLevels,
        pairBandCount,
        baseOffset,
        flatPairSpread,
        ditherPatternDiversity: options?.ditherPatternDiversity,
        flatSeed,
        algorithm: fillAlgorithm,
        patternStyle: fillPatternStyle,
        imageTileThresholdResolver: context.getStampDitherImageTileThresholdResolver(),
        sampledFlatTraceId: phaseSeedMarkId
          ? `${phaseSeedMarkId}:brush-concentric`
          : undefined,
        sampledFlatTraceStage: 'brush-concentric',
        fillBackground: options?.ditherBackgroundFill !== false,
        pxlEdge: context.isPxlEdgeEnabled(),
        flatCycle: options?.ditherFlatCycle === true,
        flatCycleBands: options?.ditherFlatCycleBands,
        sampleNormalized: (x, y) => {
          let minDistSq = Infinity;
          for (let k = 0; k < edges.length; k += 1) {
            const e = edges[k];
            if (e.len2 <= 0) continue;
            const tNum = (x - e.v1x) * e.dx + (y - e.v1y) * e.dy;
            const tVal = Math.max(0, Math.min(1, tNum / e.len2));
            const px = e.v1x + tVal * e.dx;
            const py = e.v1y + tVal * e.dy;
            const ddx = x - px;
            const ddy = y - py;
            const d2 = ddx * ddx + ddy * ddy;
            if (d2 < minDistSq) {
              minDistSq = d2;
            }
          }
          return Math.min(1, Math.sqrt(Math.max(0, minDistSq)) / safeMaxDist);
        },
        writeIndex: (x, y, index, phaseByte) => {
          context.logSetIndexSample(id, x, y);
          writeConcentricIndex(x, y, index, phaseByte ?? 0);
        },
        writePhase: (x, y, phaseByte) => {
          if (x < 0 || y < 0 || x >= concentricWidth || y >= concentricHeight) {
            return;
          }
          concentricPhaseData[y * concentricWidth + x] = phaseByte;
        },
        resolvePhaseByte: (_x, _y, index, normalized) =>
          index <= 0
            ? 0
            : sampledPhaseOverride ?? context.resolveShapePhaseByte(normalized, {
                ccGradient,
                pairBandCount,
                effectiveColorCount: quantLevels,
                shapePhaseBaseByte,
              }),
        yieldIfNeeded,
      });
      finalizeFill('cpu', quantLevels);
      if (strokeData) {
        context.snapshotFromBuffers(strokeData);
      }
      return;
    }

    if (context.isDitherEnabled() && (context.isPerceptualDitherEnabled() || (ccGradient && fillAlgorithm !== 'sierra-lite'))) {
      const handledPerceptualFill = await tryRunConcentricPerceptualFill({
        context: {
          isPxlEdgeEnabled: () => context.isPxlEdgeEnabled(),
          isDitherEnabled: () => context.isDitherEnabled(),
          getDitherPixelSize: () => context.getDitherPixelSize(),
          colorAtPosition: (pos, stopsOverride) => context.colorAtPosition(pos, stopsOverride),
          buildQuantizedGradientPalette: (numColors) => context.buildQuantizedGradientPalette(numColors),
        },
        vertices,
        minX,
        minY,
        maxX,
        maxY,
        maxDist,
        numBands,
        baseOffset,
        fillAlgorithm,
        fillPatternStyle,
        writeConcentricIndex,
        resolveConcentricPhaseByte,
        yieldIfNeeded,
        finish: () => {
          const stampCounter = context.advanceStampCounter(numBands);
          if (strokeData) strokeData.stampCounter = stampCounter;
          context.markPresenterLayerDirty(id);
          animator.forceRender();
          context.render(false);
          logConcentricFill('cpu');
          if (strokeData) {
            context.snapshotFromBuffers(strokeData);
          }
        },
      });
      if (handledPerceptualFill) {
        return;
      }
    }

    const preferWorker =
      !context.isPerceptualDitherEnabled() &&
      context.canRunConcentricWorker(bbox.width, bbox.height);
    if (preferWorker) {
      const workerVertices = new Float32Array(vertices.length * 2);
      for (let i = 0; i < vertices.length; i++) {
        workerVertices[i * 2] = vertices[i].x;
        workerVertices[i * 2 + 1] = vertices[i].y;
      }
      const workerJobId = context.beginConcentricWorkerJob();
      try {
        const workerResult = await runConcentricFillJob({
          type: 'concentric-fill',
          vertices: workerVertices,
          bbox,
          bands: numBands,
          baseOffset,
          maxDist,
          ditherEnabled: context.isDitherEnabled(),
          ditherStrength: context.getDitherStrength(),
          ditherPixelSize: context.getDitherPixelSize(),
          noiseSeed,
        });
        if (context.isCurrentConcentricWorkerJob(workerJobId) && workerResult) {
          const buffer = new Uint8Array(workerResult.indices);
          blitLocalBuffer(buffer);
          finalizeFill('worker');
          if (strokeData) {
            context.snapshotFromBuffers(strokeData);
          }
          return;
        }
      } catch (error) {
        ccWarn('[ColorCycleBrush] Concentric worker fill failed; retrying on CPU', error);
      }
    }

    await fillConcentricIndices(
      {
        vertices,
        bbox,
        bands: numBands,
        baseOffset,
        maxDist,
        ditherEnabled: context.isDitherEnabled(),
        ditherStrength: context.getDitherStrength(),
        ditherPixelSize: context.getDitherPixelSize(),
        noiseSeed,
      },
      {
        writeSample: (x, y, colorIndex) => {
          context.logSetIndexSample(id, x, y);
          writeConcentricIndex(x, y, colorIndex, resolveConcentricPhaseByte(x, y, colorIndex));
        },
        yieldIfNeeded,
      }
    );
    finalizeFill('cpu');
    if (strokeData) {
      context.snapshotFromBuffers(strokeData);
    }
  } finally {
    animator.endDirectFill();
  }
}
