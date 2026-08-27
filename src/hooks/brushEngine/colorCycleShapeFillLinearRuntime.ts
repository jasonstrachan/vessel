import { getAppStoreState } from '@/stores/appStoreAccess';
import { normalizeColorCycleSampledMotion } from '@/utils/colorCycleSampledMotion';
import { debugLog, debugWarn, isDebugEnabled } from '@/utils/debug';
import { ccWarn } from '@/utils/colorCycle/ccDebug';
import { appendCCDebugOverlayEntry } from '@/utils/colorCycle/ccDebugOverlayStore';
import { fillCcGradientDither } from '@/utils/colorCycle/ccGradientDither';
import { resolveStableFlatSeed } from '@/utils/colorCycle/ccFlatSeed';
import { simplifyToVertexLimit } from '@/utils/polygonSimplify';
import { recordColorCycleFillPerf } from '@/utils/perf/ccPerfProbe';
import { getActiveMarkGradientSession } from '@/hooks/canvas/utils/colorCycleMarkSession';

import type { FillOptions } from './colorCycleCanvas2DTypes';
import { createYieldController, nowMs } from './colorCycleCanvas2DUtils';
import { applyLostEdgeFromWrittenMask, captureRegionU16, captureRegionU8 } from './colorCycleShapeFillBuffers';
import { tryRunLinearPerceptualFill } from './colorCycleShapeFillLinearPerceptualRuntime';
import { runLinearScanlineFillFallback } from './colorCycleShapeFillLinearScanlineRuntime';
import type { ColorCycleLinearShapeFillContext } from './colorCycleShapeFillLinearTypes';

const logCcGradientDitherCall = (event: string, data: Record<string, unknown>): void => {
  if (process.env.NODE_ENV === 'test') {
    return;
  }
  appendCCDebugOverlayEntry('log', `cc gradient dither call: ${event}`, data);
};
export async function runColorCycleLinearShapeFill(
  context: ColorCycleLinearShapeFillContext,
  vertices: Array<{ x: number; y: number }>,
  direction: { x: number; y: number },
  layerId: string,
  spacing?: number,
  options?: FillOptions
) {
  if (!layerId) {
    throw new Error('fillShapeLinear requires a layerId');
  }

  if (!vertices || !Array.isArray(vertices)) {
    debugWarn('raw-console', 'Invalid vertices provided to fillShapeLinear');
    return;
  }

  if (vertices.length < 3) {
    debugWarn('raw-console', 'fillShapeLinear requires at least 3 vertices');
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

  const requestedGradientSpan = options?.linearGradientSpan;
  const authoredGradientSpan =
    typeof requestedGradientSpan === 'number' &&
    Number.isFinite(requestedGradientSpan) &&
    requestedGradientSpan > 1e-6
      ? requestedGradientSpan
      : null;
  let centerX = (fullMinX + fullMaxX) / 2;
  let centerY = (fullMinY + fullMaxY) / 2;
  if (authoredGradientSpan !== null) {
    centerX = 0;
    centerY = 0;
    for (const vertex of vertices) {
      centerX += vertex.x;
      centerY += vertex.y;
    }
    centerX /= vertices.length;
    centerY /= vertices.length;
  }

  // Normalize direction vector
  const dirLength = Math.sqrt(direction.x * direction.x + direction.y * direction.y);
  const dirX = direction.x / dirLength;
  const dirY = direction.y / dirLength;

  // Calculate projection range for normalization
  let minProjection = authoredGradientSpan !== null
    ? -authoredGradientSpan / 2
    : Infinity;
  let maxProjection = authoredGradientSpan !== null
    ? authoredGradientSpan / 2
    : -Infinity;

  if (authoredGradientSpan === null) {
    // Direction-only callers retain the legacy behavior that fits the
    // gradient to the full shape projection.
    for (const vertex of vertices) {
      const dx = vertex.x - centerX;
      const dy = vertex.y - centerY;
      const projection = dx * dirX + dy * dirY;
      minProjection = Math.min(minProjection, projection);
      maxProjection = Math.max(maxProjection, projection);
    }
  }

  const projectionPadding = authoredGradientSpan === null
    ? 0.5 * (Math.abs(dirX) + Math.abs(dirY))
    : 0;
  const paddedMinProjection = minProjection - projectionPadding;
  const paddedMaxProjection = maxProjection + projectionPadding;
  const projectionRange = paddedMaxProjection - paddedMinProjection;
  const safeProjectionRange = Math.abs(projectionRange) < 1e-6 ? 1 : projectionRange;
  const spacingValue = context.normalizeBandSpacingValue(spacing);
  const projectionSpan = Math.max(1, Math.abs(safeProjectionRange));
  const ccGradient = options?.ccGradient === true;
  const numBands = ccGradient
    ? Math.max(2, Math.min(254, Math.floor(context.getGradientBands() || 12)))
    : context.deriveBandCountFromDistance(projectionSpan, spacingValue);
  const continuous = options?.continuous === true;
  const lostEdge = Number.isFinite(options?.lostEdge)
    ? Math.max(0, Math.min(100, Math.round(options?.lostEdge as number)))
    : 0;
  const ditherLevels = Number.isFinite(options?.ditherLevels)
    ? Math.max(1, Math.min(254, Math.floor(options?.ditherLevels as number)))
    : null;
  const baseOffset = Number.isFinite(options?.ditherBaseOffsetOverride)
    ? Math.max(0, Math.min(254, Math.round(options?.ditherBaseOffsetOverride as number)))
    : context.getStampCounter() % 255;
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
  const resolveLinearPhaseByte = (x: number, y: number, colorIndex: number) => {
    if (colorIndex <= 0) {
      return 0;
    }
    if (sampledPhaseOverride !== undefined) {
      return sampledPhaseOverride;
    }
    const proj = (x + 0.5 - centerX) * dirX + (y + 0.5 - centerY) * dirY;
    const normalized = clamp01((proj - paddedMinProjection) / safeProjectionRange);
    return context.resolveShapePhaseByte(normalized, {
      ccGradient,
      pairBandCount,
      effectiveColorCount: numBands,
      shapePhaseBaseByte,
    });
  };
  if (logCcFill) {
    debugLog('cc-fill', '[CC fill] linear path flags', {
      hasGL: (() => {
        try {
          return animator.hasWebGL();
        } catch {
          return null;
        }
      })(),
      ditherEnabled: context.isDitherEnabled(),
      ditherPixelSize: context.getDitherPixelSize(),
      perceptual: context.isPerceptualDitherEnabled(),
      ccGradient,
      continuous,
      lostEdge,
    });
  }
  const indexFromNormalized = (pos: number): number => {
    const raw = Math.round(pos * 254);
    const shifted = (raw + baseOffset) % 255;
    return Math.max(1, Math.min(255, shifted + 1));
  };
  const clamp01 = (value: number) => Math.min(1, Math.max(0, value));

  const bbox = {
    minX: Math.floor(fillMinX),
    minY: Math.floor(fillMinY),
    width: Math.max(1, Math.ceil(fillMaxX) - Math.floor(fillMinX) + 1),
    height: Math.max(1, Math.ceil(fillMaxY) - Math.floor(fillMinY) + 1)
  };
  const shapePhaseBaseByte = sampledPhaseOverride ?? context.resolveShapePhaseBaseByte({
    ccGradient,
    pairBandCount,
    effectiveColorCount: numBands,
    markId: options?.shapePhaseSeedMarkId ?? null,
    bounds: bbox,
    points: vertices,
  });
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
  const dirNorm = { x: dirX, y: dirY };

  // GPU path (linear fill) when available
  try {
    if (!continuous && lostEdge <= 0) {
      if (context.isDitherEnabled() && context.isPerceptualDitherEnabled()) {
        throw new Error('Perceptual dither requires CPU fill');
      }
      const runtimeMax = animator.getGLFillMaxVerts() || 256;
      const GPU_MAX_VERTS = Math.max(8, Math.min(256, runtimeMax));
      let gpuVertices = vertices;
      if (vertices.length > GPU_MAX_VERTS) {
        const simplified = simplifyToVertexLimit(vertices, GPU_MAX_VERTS, { initialTolerance: 0.25, maxTolerance: 10, stepFactor: 1.45 });
        if (simplified.length <= GPU_MAX_VERTS) {
          gpuVertices = simplified;
        } else {
          ccWarn('[ColorCycleBrush] Linear GPU fallback (vertex budget)', {
            original: vertices.length,
            simplified: simplified.length,
            limit: GPU_MAX_VERTS,
          });
        }
      }

      if (gpuVertices.length >= 3 && gpuVertices.length <= GPU_MAX_VERTS) {
        const ditherStrength = context.isDitherEnabled() ? context.getDitherStrength() : 0;
        const ditherPixelSize = context.isDitherEnabled() ? Math.max(1, context.getDitherPixelSize()) : 1;
        const noiseSeed = (context.getStampCounter() & 0xffff) / 65535;
        const colorStep = numBands > 1 ? 254 / (numBands - 1) : 254;
        const gpuStart = nowMs();
        const ok = animator.gpuFillShape(gpuVertices, {
          mode: 'linear',
          bands: numBands,
          baseOffset,
          colorStep,
          maxDist: 1,
          bbox,
          direction: dirNorm,
          directionOrigin: { x: centerX, y: centerY },
          directionRange: { min: paddedMinProjection, range: safeProjectionRange },
          ditherStrength,
          ditherPixelSize,
          noiseSeed,
        }, flowSlot, speedByte, flowByte, resolveLinearPhaseByte);
        if (ok) {
          if (strokeData) {
            context.stampGradientDefForGpuShapeFillResult(strokeData, animator, bbox, activeDefId, flowSlot);
          }
          if (logCcFill) {
            debugLog('cc-fill', '[CC fill] linear USED GPU', { bbox, bands: numBands });
            const gpuBuffers = animator.getIndexBuffers();
            context.logShapeFillBufferSnapshot({
              layerId: id,
              mode: 'linear',
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
            mode: 'linear',
            durationMs: nowMs() - gpuStart,
            area: bbox.width * bbox.height,
            vertices: gpuVertices.length,
          });
          if (strokeData) {
            context.snapshotFromBuffers(strokeData);
          }
          return;
        }
        ccWarn('[ColorCycleBrush] Linear GPU fill returned empty result', {
          vertices: gpuVertices.length,
          bands: numBands,
          ditherStrength,
        });
      }
    }
  } catch {}

  const directLinearHandle = animator.beginDirectFill();
  if (logCcFill) {
    debugLog('cc-fill', '[CC fill] linear USED CPU', { bbox, bands: numBands });
  }
  if (ccGradient && typeof animator.setStrokeSpeedByte === 'function') {
    animator.setStrokeSpeedByte(speedByte);
  }
  if (activeSlot !== 0) {
    animator.markGradientSlotUsed(activeSlot);
  }
  const linearBuffer = directLinearHandle.data;
  const linearGradientId = directLinearHandle.gradientId;
  const linearSpeedData = directLinearHandle.speedData;
  const linearFlowData = directLinearHandle.flowData;
  const linearPhaseData = directLinearHandle.phaseData;
  const linearDefData = strokeData?.buffers.def;
  if (strokeData) {
    strokeData.buffers.paint = linearBuffer;
    strokeData.buffers.gid = linearGradientId;
    strokeData.buffers.spd = linearSpeedData;
    strokeData.buffers.flow = linearFlowData;
    strokeData.buffers.phase = linearPhaseData;
  }
  const linearBufferWidth = directLinearHandle.width;
  const linearBufferHeight = directLinearHandle.height;
  const writeLinearIndex = (
    x: number,
    y: number,
    colorIndex: number,
    phaseByte: number = sampledPhaseOverride ?? 0
  ) => {
    if (x < 0 || y < 0 || x >= linearBufferWidth || y >= linearBufferHeight) {
      return;
    }
    const clamped = Math.max(0, Math.min(255, colorIndex | 0));
    const idx = y * linearBufferWidth + x;
    linearBuffer[idx] = clamped;
    context.markStrokeStateContentWritten(strokeData);
    linearGradientId[idx] = clamped === 0 ? 0 : flowSlot;
    linearSpeedData[idx] = clamped === 0 ? 0 : speedByte;
    linearFlowData[idx] = clamped === 0 ? 0 : flowByte;
    linearPhaseData[idx] = clamped === 0 ? 0 : phaseByte;
    if (activeDefId !== null && linearDefData && linearDefData.length === linearBuffer.length) {
      linearDefData[idx] = clamped === 0 ? 0 : activeDefId;
    }
    const localX = x - bbox.minX;
    const localY = y - bbox.minY;
    if (localX >= 0 && localY >= 0 && localX < bbox.width && localY < bbox.height) {
      if (clamped !== 0) writtenMask[localY * bbox.width + localX] = 255;
    }
  };

  try {
    const linearPerf = { start: nowMs(), logged: false };
    const logCpuLinear = () => {
      if (linearPerf.logged) {
        return;
      }
      linearPerf.logged = true;
      recordColorCycleFillPerf({
        path: 'cpu',
        mode: 'linear',
        durationMs: nowMs() - linearPerf.start,
        area: bbox.width * bbox.height,
        vertices: vertices.length,
      });
    };

    const fillPatternStyle = context.getStampDitherPatternStyle();
    if (ccGradient && context.isDitherEnabled()) {
      const quantLevels = ditherLevels ?? (pairBandCount > 0 ? Math.max(2, numBands) : 1);
      const pixelSize = Math.max(1, Math.floor(options?.ditherPixelSize ?? context.getDitherPixelSize()));
      const flatPairSpread =
        options?.ditherPaletteSpread ??
        getAppStoreState().tools?.brushSettings?.ditherPaletteSpread;
      const activeSession = getActiveMarkGradientSession(id);
      const phaseSeedMarkId = options?.shapePhaseSeedMarkId ?? activeSession?.markId ?? null;
      const sampledStopsOverride = options?.ditherSampledStops?.length ? options.ditherSampledStops : null;
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
      logCcGradientDitherCall('brush-linear before fill', {
        layerId: id,
        algorithm: fillAlgorithm,
        patternStyle: fillPatternStyle,
        levels: quantLevels,
        pairBandCount,
        numBands,
        gradientBands: context.getGradientBands(),
        ditherEnabled: context.isDitherEnabled(),
        sampledStopsOverrideCount: sampledStopsOverride?.length ?? 0,
        activeSessionSource: activeSession?.source ?? null,
        traceStage: 'brush-linear',
        traceId: phaseSeedMarkId
          ? `${phaseSeedMarkId}:brush-linear`
          : (sampledStopsOverride ? `${id}:brush-linear` : null),
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
        minX: fillMinX,
        minY: fillMinY,
        maxX: fillMaxX,
        maxY: fillMaxY,
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
          ? `${phaseSeedMarkId}:brush-linear`
          : (sampledStopsOverride ? `${id}:brush-linear` : undefined),
        sampledFlatTraceStage: 'brush-linear',
        sampledStopsOverride: sampledStopsOverride ?? undefined,
        fillBackground: options?.ditherBackgroundFill !== false,
        pxlEdge: context.isPxlEdgeEnabled(),
        flatCycle: options?.ditherFlatCycle === true,
        flatCycleBands: options?.ditherFlatCycleBands,
        sampleNormalized: (x, y) => {
          const proj = (x - centerX) * dirX + (y - centerY) * dirY;
          return clamp01((proj - paddedMinProjection) / safeProjectionRange);
        },
        writeIndex: (x, y, index, phaseByte) => {
          writeLinearIndex(x, y, index, phaseByte ?? 0);
        },
        writePhase: (x, y, phaseByte) => {
          if (x < 0 || y < 0 || x >= linearBufferWidth || y >= linearBufferHeight) {
            return;
          }
          linearPhaseData[y * linearBufferWidth + x] = phaseByte;
        },
        resolvePhaseByte: (x, y, index, normalized) => {
          return index <= 0
            ? 0
            : sampledPhaseOverride ?? context.resolveShapePhaseByte(normalized, {
                ccGradient,
                pairBandCount,
                effectiveColorCount: quantLevels,
                shapePhaseBaseByte,
              });
        },
        logSetIndexSample: (x, y) => {
          context.logSetIndexSample(id, x, y);
        },
        yieldIfNeeded,
      });

          if (lostEdge > 0) {
            applyLostEdgeFromWrittenMask({
              writtenMask,
              prevIdx,
              prevGid,
              prevSpd,
              prevFlow,
              prevPhase,
              prevDef,
              paint: linearBuffer,
              gid: linearGradientId,
              spd: linearSpeedData,
              flow: linearFlowData,
              phase: linearPhaseData,
              def: linearDefData,
              fullW: linearBufferWidth,
              bbox,
              lostEdge,
              tileSize: context.resolveLostEdgeTileSize(),
            });
          }

      const stampCounter = context.advanceStampCounter(quantLevels);
      if (strokeData) strokeData.stampCounter = stampCounter;
      context.markPresenterLayerDirty(id);
      animator.markDirtyBounds(bbox);
      if (logCcFill) {
        context.logShapeFillBufferSnapshot({
          layerId: id,
          mode: 'linear',
          path: 'cpu',
          ccGradient,
          ditherEnabled: context.isDitherEnabled(),
          colors: quantLevels,
          bbox,
          width: linearBufferWidth,
          paint: linearBuffer,
          speed: linearSpeedData,
          flow: linearFlowData,
          phase: linearPhaseData,
        });
      }
      animator.forceRender();
      context.render(false);
      if (strokeData) {
        context.snapshotFromBuffers(strokeData);
      }
      logCpuLinear();
      return;
    }

    const linearFillHelperContext = {
      isDitherEnabled: () => context.isDitherEnabled(),
      isPerceptualDitherEnabled: () => context.isPerceptualDitherEnabled(),
      isPxlEdgeEnabled: () => context.isPxlEdgeEnabled(),
      getDitherPixelSize: () => context.getDitherPixelSize(),
      getDitherStrength: () => context.getDitherStrength(),
      canRunPerceptualDitherWorker: (width: number, height: number) =>
        context.canRunPerceptualDitherWorker(width, height),
      colorAtPosition: (pos: number, stopsOverride?: Parameters<typeof context.colorAtPosition>[1]) =>
        context.colorAtPosition(pos, stopsOverride),
      buildQuantizedGradientPalette: (numColors: number) =>
        context.buildQuantizedGradientPalette(numColors),
      logSetIndexSample: (targetLayerId: string, sampleX: number, sampleY: number) =>
        context.logSetIndexSample(targetLayerId, sampleX, sampleY),
      resolveLostEdgeTileSize: () => context.resolveLostEdgeTileSize(),
      advanceStampCounter: (delta: number) => context.advanceStampCounter(delta),
      markPresenterLayerDirty: (targetLayerId: string) => context.markPresenterLayerDirty(targetLayerId),
      logShapeFillBufferSnapshot: (options: Parameters<typeof context.logShapeFillBufferSnapshot>[0]) =>
        context.logShapeFillBufferSnapshot(options),
      render: (force?: boolean) => context.render(force),
      snapshotFromBuffers: (targetStrokeData: typeof strokeData) => {
        if (targetStrokeData) {
          context.snapshotFromBuffers(targetStrokeData);
        }
      },
      resolveShapePhaseByte: (
        normalized: number,
        options: Parameters<typeof context.resolveShapePhaseByte>[1],
      ) => context.resolveShapePhaseByte(normalized, options),
    };

    const handledPerceptualFill = await tryRunLinearPerceptualFill({
      context: linearFillHelperContext,
      animator,
      strokeData,
      vertices,
      gradientProjection: {
        centerX,
        centerY,
        dirX,
        dirY,
        min: paddedMinProjection,
        range: safeProjectionRange,
      },
      layerId: id,
      minX,
      minY,
      maxX,
      maxY,
      bbox,
      buffers: {
        paint: linearBuffer,
        gid: linearGradientId,
        spd: linearSpeedData,
        flow: linearFlowData,
        phase: linearPhaseData,
        def: linearDefData,
        width: linearBufferWidth,
      },
      previous: {
        paint: prevIdx,
        gid: prevGid,
        spd: prevSpd,
        flow: prevFlow,
        phase: prevPhase,
        def: prevDef,
      },
      writtenMask,
      ccGradient,
      fillAlgorithm,
      fillPatternStyle,
      baseOffset,
      ditherLevels,
      numBands,
      lostEdge,
      logCcFill,
      writeLinearIndex,
      yieldIfNeeded,
      logCpuLinear,
    });
    if (handledPerceptualFill) {
      return;
    }

    await runLinearScanlineFillFallback({
      context: linearFillHelperContext,
      vertices,
      layerId: id,
      minX,
      minY,
      maxX,
      maxY,
      centerX,
      centerY,
      dirX,
      dirY,
      paddedMinProjection,
      safeProjectionRange,
      bbox,
      buffers: {
        paint: linearBuffer,
        gid: linearGradientId,
        spd: linearSpeedData,
        flow: linearFlowData,
        phase: linearPhaseData,
        def: linearDefData,
        width: linearBufferWidth,
      },
      previous: {
        paint: prevIdx,
        gid: prevGid,
        spd: prevSpd,
        flow: prevFlow,
        phase: prevPhase,
        def: prevDef,
      },
      writtenMask,
      numBands,
      ditherLevels,
      lostEdge,
      ccGradient,
      pairBandCount,
      shapePhaseBaseByte,
      sampledPhaseOverride,
      continuous,
      indexFromNormalized,
      clamp01,
      writeLinearIndex,
      yieldIfNeeded,
    });

  // Increment stamp counter for next shape
  const stampCounter = context.advanceStampCounter(numBands);
  if (strokeData) {
    strokeData.stampCounter = stampCounter;
  }

  // Mark layer as dirty for rendering
  context.markPresenterLayerDirty(id);
  animator.markDirtyBounds(bbox);
  if (logCcFill) {
    context.logShapeFillBufferSnapshot({
      layerId: id,
      mode: 'linear',
      path: 'cpu',
      ccGradient,
      ditherEnabled: context.isDitherEnabled(),
      colors: numBands,
      bbox,
      width: linearBufferWidth,
      paint: linearBuffer,
      speed: linearSpeedData,
      flow: linearFlowData,
      phase: linearPhaseData,
    });
  }

  // Force immediate render
  animator.forceRender();
  context.render(false);
  if (strokeData) {
    context.snapshotFromBuffers(strokeData);
  }
  logCpuLinear();
  } finally {
    animator.endDirectFill();
  }
}
