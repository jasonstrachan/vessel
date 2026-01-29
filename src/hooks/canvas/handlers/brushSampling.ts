import type React from 'react';
import type { AppState } from '@/stores/useAppStore';
import { BrushShape } from '@/types';
import { debugLog } from '@/utils/debug';
import {
  AUTO_SAMPLE_MAX_STOPS,
  MIN_AUTO_SAMPLE_PREVIEW_DISTANCE,
  computeAutoSampleStopsFromPolyline,
  computeDitherGradSampleStopsFromPolyline,
  dedupePolylineForSampling,
  type PolyPoint,
} from '@/hooks/canvas/utils/autoSampleGradient';
import { getColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import { setLayerColorCycleGradient, setSharedColorCycleGradient } from '@/utils/colorCycleGradients';

const SAMPLE_PREVIEW_STROKE_STYLE = 'rgba(255, 214, 102, 0.95)';

export type BrushSamplingDeps = {
  storeRef: React.MutableRefObject<AppState>;
  drawingCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  drawingCtxRef: React.MutableRefObject<CanvasRenderingContext2D | null>;
  drawingCanvasHasContent: React.MutableRefObject<boolean>;
  sampleColorAt?: (x: number, y: number) => string;
};

export const resetAutoSampleState = ({
  storeRef,
  autoSamplePointsRef,
  autoSampleLastUpdateRef,
  brushSamplingPreviewActiveRef,
  disableGradient = true,
}: {
  storeRef: React.MutableRefObject<AppState>;
  autoSamplePointsRef: React.MutableRefObject<Array<{ x: number; y: number }>>;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  brushSamplingPreviewActiveRef: React.MutableRefObject<boolean>;
  disableGradient?: boolean;
}): void => {
  autoSamplePointsRef.current = [];
  autoSampleLastUpdateRef.current = 0;
  brushSamplingPreviewActiveRef.current = false;
  if (!disableGradient) {
    return;
  }
  try {
    const st = storeRef.current;
    if (st.tools.brushSettings.autoSampleGradient && !st.tools.brushSettings.autoSampleGradientRealtime) {
      st.setBrushSettings({ autoSampleGradient: false });
    }
  } catch {}
};

export const sampleHexAt = ({
  x,
  y,
  deps,
}: {
  x: number;
  y: number;
  deps: BrushSamplingDeps;
}): string => {
  try {
    if (typeof deps.sampleColorAt === 'function') {
      return deps.sampleColorAt(x, y);
    }
    const toHex = (v: number) => v.toString(16).padStart(2, '0');

    const comp = deps.storeRef.current.currentOffscreenCanvas;
    if (comp) {
      const ctx = comp.getContext('2d', { willReadFrequently: true });
      if (ctx) {
        const clampedX = Math.max(0, Math.min(comp.width - 1, Math.floor(x)));
        const clampedY = Math.max(0, Math.min(comp.height - 1, Math.floor(y)));
        const img = ctx.getImageData(clampedX, clampedY, 1, 1);
        let [r, g, b] = img.data;
        const a = img.data[3];
        if (a < 10) return '#ffffff';
        if (r <= 30 && g <= 30 && b <= 30) { r = 0; g = 0; b = 0; }
        if (r >= 225 && g >= 225 && b >= 225) { r = 255; g = 255; b = 255; }
        return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
      }
    }
    debugLog('auto-sample', {
      phase: 'fallback',
      reason: 'no-offscreen',
      hasComp: Boolean(comp),
    });

    const overlay = deps.drawingCanvasRef.current;
    if (overlay) {
      const octx = overlay.getContext('2d', { willReadFrequently: true });
      if (octx) {
        const clampedX = Math.max(0, Math.min(overlay.width - 1, Math.floor(x)));
        const clampedY = Math.max(0, Math.min(overlay.height - 1, Math.floor(y)));
        const img = octx.getImageData(clampedX, clampedY, 1, 1);
        let [r, g, b] = img.data;
        const a = img.data[3];
        if (a > 10) {
          if (r <= 30 && g <= 30 && b <= 30) { r = 0; g = 0; b = 0; }
          if (r >= 225 && g >= 225 && b >= 225) { r = 255; g = 255; b = 255; }
          debugLog('auto-sample', {
            phase: 'overlay',
            x: clampedX,
            y: clampedY,
            r,
            g,
            b,
            a
          });
          return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
        }
      }
    }
  } catch {}
  return '#ffffff';
};

export const equidistantPointsOnPolyline = (
  pts: Array<{ x: number; y: number }>,
  count: number
): Array<{ x: number; y: number }> => {
  if (pts.length === 0) return [] as Array<{ x: number; y: number }>;
  if (pts.length === 1 || count === 1) return [pts[0]];
  const deduped = dedupePolylineForSampling(pts);
  if (deduped.length === 0) return [];
  if (deduped.length === 1) return [deduped[0]];
  const segLens: number[] = [];
  let total = 0;
  for (let i = 0; i < deduped.length - 1; i++) {
    const dx = deduped[i + 1].x - deduped[i].x;
    const dy = deduped[i + 1].y - deduped[i].y;
    const len = Math.hypot(dx, dy);
    segLens.push(len);
    total += len;
  }
  if (total === 0) return [deduped[0]];
  const result: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < count; i++) {
    const d = (i / Math.max(1, count - 1)) * total;
    let acc = 0;
    let segIndex = 0;
    while (segIndex < segLens.length && acc + segLens[segIndex] < d) {
      acc += segLens[segIndex];
      segIndex++;
    }
    if (segIndex >= segLens.length) {
      result.push(deduped[deduped.length - 1]);
      continue;
    }
    const segStart = deduped[segIndex];
    const segEnd = deduped[segIndex + 1];
    const segLen = segLens[segIndex] || 1;
    const t = (d - acc) / segLen;
    result.push({ x: segStart.x + (segEnd.x - segStart.x) * t, y: segStart.y + (segEnd.y - segStart.y) * t });
  }
  return result;
};

export const computeAutoSampleStops = ({
  sourcePts,
  sampleColor,
  options = {},
}: {
  sourcePts: Array<{ x: number; y: number }>;
  sampleColor: (x: number, y: number) => string;
  options?: { allowTiny?: boolean };
}): Array<{ position: number; color: string }> | null =>
  computeAutoSampleStopsFromPolyline(
    sourcePts,
    sampleColor,
    equidistantPointsOnPolyline,
    {
      allowTiny: options.allowTiny,
      minDistance: MIN_AUTO_SAMPLE_PREVIEW_DISTANCE
    }
  );

export const renderBrushSamplingPreview = ({
  points,
  deps,
}: {
  points: PolyPoint[];
  deps: BrushSamplingDeps;
}): void => {
  const canvas = deps.drawingCanvasRef.current;
  const ctx = deps.drawingCtxRef.current;
  if (!canvas || !ctx) {
    return;
  }

  ctx.save();
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  if (points.length >= 2) {
    ctx.lineWidth = 2;
    ctx.strokeStyle = SAMPLE_PREVIEW_STROKE_STYLE;
    ctx.setLineDash([6, 6]);
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(points[0].x, points[0].y);
    for (let i = 1; i < points.length; i += 1) {
      ctx.lineTo(points[i].x, points[i].y);
    }
    ctx.stroke();
    deps.drawingCanvasHasContent.current = true;
  }

  ctx.restore();
};

export const clearBrushSamplingPreview = ({
  deps,
}: {
  deps: BrushSamplingDeps;
}): void => {
  const canvas = deps.drawingCanvasRef.current;
  const ctx = deps.drawingCtxRef.current;
  if (!canvas || !ctx) {
    return;
  }
  ctx.save();
  ctx.setLineDash([]);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.restore();
  deps.drawingCanvasHasContent.current = false;
};

export const updateAutoSampledGradient = ({
  sourcePts,
  now,
  autoSampleLastUpdateRef,
  autoSampleForkRef,
  autoSampleLastAppliedHashRef,
  deps,
}: {
  sourcePts: Array<{ x: number; y: number }>;
  now: number;
  autoSampleLastUpdateRef: React.MutableRefObject<number>;
  autoSampleForkRef: React.MutableRefObject<boolean>;
  autoSampleLastAppliedHashRef: React.MutableRefObject<string>;
  deps: BrushSamplingDeps;
}): void => {
  if (now - autoSampleLastUpdateRef.current < 120) return;

  const stops = computeAutoSampleStops({
    sourcePts,
    sampleColor: (x, y) =>
      typeof deps.sampleColorAt === 'function' ? deps.sampleColorAt(x, y) : sampleHexAt({ x, y, deps }),
  });
  if (!stops) {
    return;
  }
  autoSampleLastUpdateRef.current = now;

  const hash = stops
    .map((stop) => `${Math.round(stop.position * 1000)}:${stop.color}`)
    .join('|');
  if (hash === autoSampleLastAppliedHashRef.current) {
    return;
  }
  autoSampleLastAppliedHashRef.current = hash;

  const store = deps.storeRef.current;
  const isRealtimeSample = Boolean(store.tools.brushSettings.autoSampleGradientRealtime);
  const current = store.tools.brushSettings.colorCycleGradient || [];
  const same = JSON.stringify(current) === JSON.stringify(stops);
  if (same) return;

  try {
    const gb = store.tools.brushSettings.gradientBands || 0;
    if (gb < stops.length) {
      store.setBrushSettings({ gradientBands: stops.length });
    }
  } catch {}

  try {
    if (isRealtimeSample) {
      setLayerColorCycleGradient(stops, store.activeLayerId ?? undefined, {
        fork: autoSampleForkRef.current,
        allowForegroundOverride: true,
        skipRender: true,
      });
      try {
        store.setBrushSettings({ colorCycleGradient: stops });
      } catch {}
      try {
        const refreshed = deps.storeRef.current;
        const activeLayer = refreshed.layers.find(l => l.id === refreshed.activeLayerId);
        if (activeLayer?.layerType === 'color-cycle' && activeLayer.colorCycleData) {
          const defs = activeLayer.colorCycleData.gradientDefs ?? [];
          const activeId = activeLayer.colorCycleData.activeGradientId ?? defs[0]?.id;
          const activeDef = defs.find(entry => entry.id === activeId) ?? defs[0];
          const slot = activeDef?.currentSlot ?? 0;
          const manager = getColorCycleBrushManager();
          const brush = manager.getBrush(activeLayer.id);
          if (brush) {
            brush.setGradientSlot?.(activeLayer.id, slot, stops);
            brush.setActiveGradientSlot?.(activeLayer.id, slot);
          }
        }
      } catch {}
    } else {
      setSharedColorCycleGradient(stops, { fork: autoSampleForkRef.current });
    }
    autoSampleForkRef.current = false;
  } catch {
    try {
      store.setBrushSettings({ colorCycleGradient: stops });
    } catch {}
  }

  if (!isRealtimeSample) {
    const activeLayer = store.layers.find(l => l.id === store.activeLayerId);
    if (activeLayer && activeLayer.layerType === 'color-cycle') {
      try {
        const updatedColorCycleData: AppState['layers'][number]['colorCycleData'] = {
          ...(activeLayer.colorCycleData ?? {}),
          gradient: stops,
          isAnimating: activeLayer.colorCycleData?.isAnimating ?? false,
        };
        store.updateLayer(activeLayer.id, { colorCycleData: updatedColorCycleData });
      } catch {}
    }
  }
};

export const updateDitherGradSamples = ({
  sourcePts,
  now,
  ditherGradSampleLastUpdateRef,
  deps,
}: {
  sourcePts: Array<{ x: number; y: number }>;
  now: number;
  ditherGradSampleLastUpdateRef: React.MutableRefObject<number>;
  deps: BrushSamplingDeps;
}): void => {
  if (now - ditherGradSampleLastUpdateRef.current < 120) {
    return;
  }

  const store = deps.storeRef.current;
  const settings = store.tools.brushSettings;
  if (settings.brushShape !== BrushShape.DITHER_GRADIENT || !settings.ditherGradSampleEnabled) {
    return;
  }

  const sampler = typeof deps.sampleColorAt === 'function' ? deps.sampleColorAt : (x: number, y: number) => sampleHexAt({ x, y, deps });
  const stops = computeDitherGradSampleStopsFromPolyline(
    sourcePts,
    sampler,
    equidistantPointsOnPolyline,
    Math.min(AUTO_SAMPLE_MAX_STOPS, Math.round(settings.ditherGradStops?.length ?? 2))
  );
  if (!stops) {
    return;
  }
  ditherGradSampleLastUpdateRef.current = now;

  const current = settings.ditherGradStops ?? [];
  const same = JSON.stringify(current) === JSON.stringify(stops);
  if (same) return;

  const rawTrans = settings.trans;
  const parsedTrans = Number(rawTrans);
  const clampedTrans = Number.isFinite(parsedTrans)
    ? Math.max(0, Math.min(1, parsedTrans))
    : undefined;
  const shouldUpdateTrans = clampedTrans !== undefined && clampedTrans !== rawTrans;

  if (shouldUpdateTrans) {
    store.setBrushSettings({ ditherGradStops: stops, trans: clampedTrans });
  } else {
    store.setBrushSettings({ ditherGradStops: stops });
  }
};
