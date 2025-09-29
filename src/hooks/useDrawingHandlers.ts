import { useCallback, useEffect, useRef } from 'react';
import { useAppStore } from '../stores/useAppStore';
import { useBrushEngineSimplified } from './useBrushEngineSimplified';
import { useUserBrushEngine } from './useUserBrushEngine';
import { BrushShape, type BrushSettings, type CustomBrush, type Layer } from '../types';
import { getRisographPattern } from '../utils/risographTexture';
import { shouldApplyGridSnapPure, snapToGridPure, calculateGridSpacing } from '../hooks/brushEngine/utilities';
import { shouldDrawStamp, createPixelQueue } from '../hooks/brushEngine/strokeProcessor';
import { getColorCycleBrushManager } from '../stores/colorCycleBrushManager';
import { appendSegmentWithDynamicResampling } from '../utils/shapeMaker';
import { logError, debugWarn } from '../utils/debug';
import { RecolorManager } from '../lib/colorCycle/RecolorManager';
import { getColorCycleAnimationState } from '../components/toolbar/BrushControls';
import { setSharedColorCycleGradient } from '../utils/colorCycleGradients';
import { toggleGlobalColorCyclePlayback } from '../utils/colorCyclePlayback';
import type { ColorCycleBrushImplementation } from '@/hooks/brushEngine/ColorCycleBrushMigration';
import type { CustomBrushStrokeData } from './brushEngine/BrushEngineFacade';

interface UseDrawingHandlersProps {
  project: { width: number; height: number } | null;
  screenToWorld: (x: number, y: number) => { x: number; y: number };
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  canvasRef: React.RefObject<HTMLCanvasElement>;
  isBusyRef?: React.MutableRefObject<boolean>;
}

type ManagedColorCycleBrush = ColorCycleBrushImplementation & {
  commitCurrentStroke?: (layerId?: string) => void;
  finalizeCurrentStroke?: (layerId?: string) => void;
  commitToLayer?: (canvas: HTMLCanvasElement, layerId: string) => void;
  renderDirectToCanvas?: (canvas: HTMLCanvasElement, layerId: string) => void;
  clearPaintBuffer?: (layerId?: string) => void;
};

/**
 * Clips a line segment to a rectangular boundary.
 */
function clipLineSegment(
  p1: { x: number; y: number },
  p2: { x: number; y: number },
  rect: { x: number; y: number; width: number; height: number }
): [{ x: number; y: number }, { x: number; y: number }] | null {
  const x1 = p1.x, y1 = p1.y, x2 = p2.x, y2 = p2.y;
  const { x: xmin, y: ymin, width, height } = rect;
  const xmax = xmin + width;
  const ymax = ymin + height;

  let t0 = 0, t1 = 1;
  const dx = x2 - x1;
  const dy = y2 - y1;

  const checks = [
    { p: -dx, q: x1 - xmin },
    { p: dx, q: xmax - x1 },
    { p: -dy, q: y1 - ymin },
    { p: dy, q: ymax - y1 }
  ];

  for (const { p, q } of checks) {
    if (p === 0 && q < 0) return null;

    const r = q / p;
    if (p < 0) {
      if (r > t1) return null;
      if (r > t0) t0 = r;
    } else if (p > 0) {
      if (r < t0) return null;
      if (r < t1) t1 = r;
    }
  }

  return [
    { x: x1 + t0 * dx, y: y1 + t0 * dy },
    { x: x1 + t1 * dx, y: y1 + t1 * dy }
  ];
}

export function useDrawingHandlers({
  project,
  isBusyRef,
}: UseDrawingHandlersProps) {
  const brushEngine = useBrushEngineSimplified();
  const userBrushEngine = useUserBrushEngine();
  const { captureCanvasToActiveLayer, saveCanvasState, tools, activeLayerId } = useAppStore();
  
  // Feedback message state
  const feedbackMessageRef = useRef<((message: string) => void) | null>(null);
  
  const drawingCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  const drawingCanvasHasContent = useRef(false);
  const isCapturing = useRef(false);
  const lastDrawPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Performance optimization: Throttling for stroke processing
  const strokeBatchRef = useRef<Array<{ pos: { x: number; y: number }, pressure: number }>>([]);
  const strokeBatchTimerRef = useRef<number | null>(null);
  const lastProcessedTimeRef = useRef<number>(0);
  const THROTTLE_MS = 8; // Process strokes at ~120fps max
  
  // OPTIMIZATION: The separate eraser mask canvas is no longer needed.
  // We will perform erasing directly on the drawingCanvas.
  
  const shapePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const isDrawingShapeRef = useRef(false);
  const isSelectingDirectionRef = useRef(false);
  const directionPreviewRef = useRef<{ x: number; y: number } | null>(null);
  
  // Store resampler brush data for the entire stroke
  const resamplerBrushDataRef = useRef<CustomBrushStrokeData | undefined>(undefined);
  
  // Track stamp count for continuous resampling
  const stampCounterRef = useRef<number>(0);
  
  // Animation frame for color cycle rendering
  const colorCycleAnimationRef = useRef<number | null>(null);
  
  // Track distance for color cycle stamp spacing
  const colorCycleDistanceRef = useRef<number>(0);
  const colorCycleLastPosRef = useRef<{ x: number; y: number } | null>(null);
  
  // Pixel queue for color cycle dashed pattern support
  const colorCyclePixelQueue = useRef(createPixelQueue());
  
  // Continuous animation for color cycle when play button is pressed
  const continuousColorCycleAnimationRef = useRef<number | null>(null);
  const continuousColorCycleAnimationActiveRef = useRef(false);

  // Stable refs to call start/stop CC animation from early hooks
  const startCCRef = useRef<() => void>(() => {});
  const stopCCRef = useRef<() => void>(() => {});

  // Auto-sample gradient (for color cycle brushes)
  const autoSamplePointsRef = useRef<Array<{ x: number; y: number }>>([]);
  const autoSampleLastUpdateRef = useRef<number>(0);

  const sampleHexAt = useCallback((x: number, y: number): string => {
    // Unify sampling for stroke and shape: always sample the composited canvas
    // so results reflect existing artwork, not the transient overlay.
    try {
      const toHex = (v: number) => v.toString(16).padStart(2, '0');

      const comp = useAppStore.getState().currentOffscreenCanvas;
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

      // Fallback: if offscreen composite is unavailable, try overlay as a last resort
      const overlay = drawingCanvasRef.current;
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
            return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
          }
        }
      }
    } catch {}
    return '#ffffff';
  }, []);

  const equidistantPointsOnPolyline = useCallback((pts: Array<{ x: number; y: number }>, count: number) => {
    if (pts.length === 0) return [] as Array<{ x: number; y: number }>;
    if (pts.length === 1 || count === 1) return [pts[0]];
    // Deduplicate nearly-identical consecutive points to avoid zero-length total
    const deduped: Array<{ x: number; y: number }> = [];
    const EPS = 0.25; // ~subpixel tolerance
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      const last = deduped[deduped.length - 1];
      if (!last || Math.hypot(p.x - last.x, p.y - last.y) > EPS) {
        deduped.push(p);
      }
    }
    if (deduped.length === 0) return [];
    if (deduped.length === 1) return [deduped[0]];
    // Compute cumulative lengths
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
      // Find segment containing this distance
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
  }, []);

  const updateAutoSampledGradient = useCallback((sourcePts: Array<{ x: number; y: number }>) => {
    const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (now - autoSampleLastUpdateRef.current < 120) return; // throttle ~8fps
    autoSampleLastUpdateRef.current = now;

    // Dynamically choose sample count based on total path length so preview builds up quickly
    // Compute polyline length with basic dedupe to avoid zero-length segments
    const EPS = 0.25;
    let last = null as { x: number; y: number } | null;
    let totalLen = 0;
    for (let i = 0; i < sourcePts.length; i++) {
      const p = sourcePts[i];
      if (!last) { last = p; continue; }
      const dx = p.x - last.x; const dy = p.y - last.y;
      const d = Math.hypot(dx, dy);
      if (d > EPS) {
        totalLen += d;
        last = p;
      }
    }
    const maxStops = 8;
    const dynamicCount = Math.min(maxStops, Math.max(2, Math.floor(totalLen / 64) + 2));
    const samplePts = equidistantPointsOnPolyline(sourcePts, dynamicCount);
    if (samplePts.length === 0) return;

    const colors = samplePts.map(p => sampleHexAt(p.x, p.y));
    // Build gradient stops spaced 0..1
    const stops = colors.map((c, i) => ({ position: samplePts.length === 1 ? 0 : i / (samplePts.length - 1), color: c }));
    const store = useAppStore.getState();
    // Avoid redundant updates
    const current = store.tools.brushSettings.colorCycleGradient || [];
    const same = JSON.stringify(current) === JSON.stringify(stops);
    if (same) return;

    // Ensure we have enough bands to display distinct sampled colors
    try {
      const gb = store.tools.brushSettings.gradientBands || 0;
      if (gb < stops.length) {
        store.setBrushSettings({ gradientBands: stops.length });
      }
    } catch {}

    // Use shared setter to propagate to tools + active CC layer consistently
    try {
      setSharedColorCycleGradient(stops);
    } catch {
      // Fallback: update brush and active layer directly
      store.setBrushSettings({ colorCycleGradient: stops });
      const activeId = store.activeLayerId;
      if (activeId) {
        const layer = store.layers.find(l => l.id === activeId);
        if (layer && layer.layerType === 'color-cycle') {
          const updatedColorCycleData: Layer['colorCycleData'] = {
            ...(layer.colorCycleData ?? {}),
            gradient: stops,
            isAnimating: layer.colorCycleData?.isAnimating ?? false,
          };
          store.updateLayer(activeId, { colorCycleData: updatedColorCycleData });
        }
      }
    }

    // Also push updated gradient into the active ColorCycle brush instance
    try {
      brushEngine.updateColorCycleGradient?.(stops);
    } catch {}
  }, [brushEngine, equidistantPointsOnPolyline, sampleHexAt]);

  // Track which CC layers were animating so we can resume them after interaction
  const pausedCCLayerIdsRef = useRef<string[]>([]);
  const recolorWasAnimatingRef = useRef<boolean>(false);
  const shouldResumeColorCycleAfterInteractionRef = useRef<boolean>(false);
  // Tracks if we've already paused for the current CC shape preview
  const ccShapePreviewPauseStartedRef = useRef<boolean>(false);

  // Helper: pause animation for all brush-based CC layers and remember which were playing
  const pauseAllBrushCCAnimationsNow = useCallback(() => {
    
    const state = useAppStore.getState();
    const toResume: string[] = [];
    state.layers.forEach(layer => {
      if (layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor') {
        if (layer.colorCycleData?.isAnimating) {
          toResume.push(layer.id);
        }
        // Flip flag off
        const updatedColorCycleData: Layer['colorCycleData'] = {
          ...(layer.colorCycleData ?? {}),
          isAnimating: false,
        };
        state.updateLayer(layer.id, { colorCycleData: updatedColorCycleData });
        // Pause brush animator instance if present
        try {
          const mgr = getColorCycleBrushManager();
          const brush = mgr.getBrush(layer.id);
          brush?.pause?.();
          brush?.stopAnimation?.();
        } catch {}
      }
    });
    
    // Stop any global continuous loop (defensive)
    if (continuousColorCycleAnimationRef.current) {
      continuousColorCycleAnimationActiveRef.current = false;
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
    }
    
    // Also pause recolor animation if active
    try {
      const rm = RecolorManager.getInstance();
      recolorWasAnimatingRef.current = rm.isAnimating();
      if (recolorWasAnimatingRef.current) rm.pause();
      
    } catch {}
    // Check global brush play state (toolbar) so we can resume even if no per-layer flags were set
    let globalShouldResume = false;
    try {
      if (typeof getColorCycleAnimationState === 'function') {
        globalShouldResume = !!getColorCycleAnimationState();
      }
    } catch {}
    // Record and report state
    pausedCCLayerIdsRef.current = toResume;
    try { window.dispatchEvent(new CustomEvent('colorCycleAnimationState', { detail: { isPlaying: false, source: 'brush' } })); } catch {}
    
    return toResume.length > 0 || globalShouldResume || recolorWasAnimatingRef.current;
  }, []);

  const pauseColorCycleForNonCCInteraction = useCallback(() => {
    if (shouldResumeColorCycleAfterInteractionRef.current) {
      return;
    }

    const wasPlaying = getColorCycleAnimationState();
    pauseAllBrushCCAnimationsNow();

    if (wasPlaying) {
      shouldResumeColorCycleAfterInteractionRef.current = true;
      void toggleGlobalColorCyclePlayback(false);
    }
  }, [pauseAllBrushCCAnimationsNow]);

  const resumeColorCycleAfterInteraction = useCallback(async () => {
    if (!shouldResumeColorCycleAfterInteractionRef.current) {
      return;
    }

    shouldResumeColorCycleAfterInteractionRef.current = false;

    if (!getColorCycleAnimationState()) {
      await toggleGlobalColorCyclePlayback(true);
    }
  }, []);

  // Helper: resume previously paused brush-based CC layers
  // NOTE: Currently unused because global playback flow handles resume/restoration.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const resumePausedBrushCCAnimations = useCallback(() => {
    const state = useAppStore.getState();
    const mgr = getColorCycleBrushManager();
    const ids = pausedCCLayerIdsRef.current;
    let resumedAny = false;

    if (ids && ids.length > 0) {
      ids.forEach(id => {
        try {
          const layer = state.layers.find(l => l.id === id);
          if (!layer) return;
          const updatedColorCycleData: Layer['colorCycleData'] = {
            ...(layer.colorCycleData ?? {}),
            isAnimating: true,
          };
          state.updateLayer(id, { colorCycleData: updatedColorCycleData });
          const brush = mgr.getBrush(id);
          brush?.startAnimation?.();
          resumedAny = true;
        } catch {}
      });
    }
    pausedCCLayerIdsRef.current = [];

    // Resume recolor animation if it was playing
    if (recolorWasAnimatingRef.current) {
      try {
        RecolorManager.getInstance().resume();
        resumedAny = true;
      } catch {}
      recolorWasAnimatingRef.current = false;
    }

    let globalIsPlaying = false;
    try {
      if (typeof getColorCycleAnimationState === 'function') {
        globalIsPlaying = !!getColorCycleAnimationState();
      }
    } catch {}

    if (globalIsPlaying) {
      const ccLayers = state.layers.filter(layer => layer.layerType === 'color-cycle' && layer.colorCycleData?.mode !== 'recolor');
      ccLayers.forEach(layer => {
        const wasAnimating = !!layer.colorCycleData?.isAnimating;
        if (!wasAnimating) {
          const resumedData: Layer['colorCycleData'] = {
            ...(layer.colorCycleData ?? {}),
            isAnimating: true,
          };
          state.updateLayer(layer.id, { colorCycleData: resumedData });
        }
        try {
          const brush = mgr.getBrush(layer.id);
          brush?.startAnimation?.();
        } catch {}
      });
      if (ccLayers.length > 0) {
        resumedAny = true;
        startCCRef.current?.();
      }
    }

    if (resumedAny || globalIsPlaying) {
      try { window.dispatchEvent(new CustomEvent('colorCycleAnimationState', { detail: { isPlaying: true, source: 'brush' } })); } catch {}
    }
  }, []);
  
  const initDrawingCanvas = useCallback(() => {
    if (!project) return;

    if (!drawingCanvasRef.current) {
      drawingCanvasRef.current = document.createElement('canvas');
      drawingCanvasRef.current.width = project.width;
      drawingCanvasRef.current.height = project.height;
    } else {
      // Resize if project dimensions have changed
      if (drawingCanvasRef.current.width !== project.width || 
          drawingCanvasRef.current.height !== project.height) {
        drawingCanvasRef.current.width = project.width;
        drawingCanvasRef.current.height = project.height;
      }
    }
    // Always get a fresh context, especially after resizing
    drawingCtxRef.current = drawingCanvasRef.current.getContext('2d', { 
      willReadFrequently: true,
      alpha: true,
      desynchronized: true 
    });
  }, [project]);

  // OPTIMIZATION: Helper function to draw an eraser segment. Using a stroked
  // line is often faster than stamping multiple circles.
  const drawEraserSegment = useCallback((
    ctx: CanvasRenderingContext2D,
    p1: { x: number; y: number },
    p2: { x: number; y: number }
  ) => {
    const { tools } = useAppStore.getState();
    const brushSize = tools.brushSettings.size || 20;  // Use brushSettings.size for consistency
    const opacity = tools.eraserSettings.opacity || 1;

    ctx.lineWidth = brushSize * 2; // Diameter to match circle-based approach
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    // The "color" of the eraser determines its strength. Black with opacity.
    ctx.strokeStyle = `rgba(0, 0, 0, ${opacity})`;
    
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }, []);
  
  const startDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    const currentState = useAppStore.getState();
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    const brushSettings = currentState.tools.brushSettings;
    const ccFlags = getColorCycleBrushFlags(brushSettings);


    // Early return if no project
    if (!project) return;

    // Layer type handling and validation
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer) {
      // Prevent drawing on hidden layers - show cursor but don't draw
      if (!activeLayer.visible) {
        return; // Exit silently, cursor will still show
      }
      const isStandardColorCycleBrush = ccFlags.isStandard;
      const isCustomColorCycleBrush = ccFlags.isCustom;
      const isAnyColorCycleBrush = ccFlags.isAny;
      
      // IMPORTANT: Layers can NEVER be converted from one type to another.
      // You simply can't draw on the wrong layer with a CC brush and vice versa.
      {
        // Validate layer/brush compatibility - STRICT ENFORCEMENT
        const isColorCycleLayer = activeLayer.layerType === 'color-cycle';
        
        
        // Check for incompatible combinations
        if (isAnyColorCycleBrush && !isColorCycleLayer) {
          // CC brush on normal layer
          if (feedbackMessageRef.current) {
            feedbackMessageRef.current("Can't use Color Cycle brush on a normal layer. Create a new layer.");
          }
          return; // Block drawing
        }
        
        if (!isAnyColorCycleBrush && isColorCycleLayer && currentTool !== 'eraser') {
          // Normal brush on CC layer (allow eraser on any layer)
          if (feedbackMessageRef.current) {
            feedbackMessageRef.current("Can't use regular brushes on a Color Cycle layer. Switch layers.");
          }
          return; // Block drawing
        }
        
        // Check gradient compatibility for CC layers
        if (isStandardColorCycleBrush && isColorCycleLayer) {
          // Ensure the CC layer has Canvas2D brush initialized
          const colorCycleBrushManager = getColorCycleBrushManager();
          if (!colorCycleBrushManager.getBrush(activeLayer.id)) {
            // Initialize it now if needed
            currentState.initColorCycleForLayer(activeLayer.id, project.width, project.height);
          }
          
          const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
          const layerGradient = activeLayer.colorCycleData?.gradient;
          
          
          // Only check gradient compatibility if both exist
          // If brush has no gradient, allow it to use the layer's gradient
          if (brushGradient && layerGradient) {
            // Compare gradients
            const gradientsMatch = JSON.stringify(brushGradient) === JSON.stringify(layerGradient);
            if (!gradientsMatch) {
              if (feedbackMessageRef.current) {
                feedbackMessageRef.current("This layer uses a different gradient");
              }
              return; // Block drawing
            }
          }
        }
        if (isCustomColorCycleBrush && isColorCycleLayer) {
          const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
          const layerGradient = activeLayer.colorCycleData?.gradient;
          if (brushGradient && layerGradient) {
            const gradientsMatch = JSON.stringify(brushGradient) === JSON.stringify(layerGradient);
            if (!gradientsMatch) {
              if (feedbackMessageRef.current) {
                feedbackMessageRef.current("This layer uses a different gradient");
              }
              return;
            }
          }
        }
      }
    }
    
    initDrawingCanvas();

    // Initialize auto-sampling for color cycle stroke
    try {
      const isCCStroke = ccFlags.isAny;
      const autoSample = !!currentState.tools.brushSettings.autoSampleGradient;
      if (isCCStroke && autoSample) {
        autoSamplePointsRef.current = [worldPos];
        autoSampleLastUpdateRef.current = 0;
        // Apply an initial sample immediately (single point)
        updateAutoSampledGradient(autoSamplePointsRef.current);
      }
    } catch {}
    
    // Reset stroke for new drawing (modular engine)
    if (brushEngine.resetStroke) {
      brushEngine.resetStroke();
    }

    // Only pause animations for NON-CC brushes
    // CC brushes should auto-start animations instead
    if (ccFlags.isAny) {
      // AUTO-START animations when using a CC brush
      if (!getColorCycleAnimationState()) {
        toggleGlobalColorCyclePlayback(true);
      }
    } else {
      // Pause animations for non-CC brushes only
      pauseColorCycleForNonCCInteraction();
    }

    // Reset color cycle brush for new stroke and start animation
    if (ccFlags.isAny) {
      // Don't set up callback here - let startContinuousColorCycleAnimation handle it
      const shouldAnimateLive = true;

      if (shouldAnimateLive) {
        brushEngine.resetColorCycle();
      }

      // Reset distance tracking for consistent spacing
      colorCycleDistanceRef.current = 0;
      colorCycleLastPosRef.current = null;

      // Reset pixel queue for dashed pattern support
      colorCyclePixelQueue.current = createPixelQueue();
      
      // Start animation loop for rendering color cycle during drawing
      // This will continuously update the animation while drawing
      let lastRenderTime = 0;
      const targetFPS = 24;
      const frameInterval = 1000 / targetFPS;
      
      const animateWhileDrawing = (timestamp: number) => {
        // Only animate if we're still in color cycle mode
        if (!colorCycleAnimationRef.current) return;

        if (timestamp - lastRenderTime >= frameInterval) {
          if (drawingCtxRef.current && drawingCanvasRef.current) {
            // Clear once for all layers
            drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
            
            // Inline render for color cycle layers to avoid closure issues
            const currentState = useAppStore.getState();
            let hasRendered = false;
            
            // Check active layer for color cycle
            const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
            if (activeLayer?.visible && activeLayer.layerType === 'color-cycle' && 
                activeLayer.colorCycleData?.canvas) {
              
              const colorCycleBrushManager = getColorCycleBrushManager();
              const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayer.id);
              if (!colorCycleBrush) return;
              
              // Render WITHOUT advancing animation while drawing
              colorCycleBrush.renderDirectToCanvas(activeLayer.colorCycleData.canvas, activeLayer.id);
              
              // Draw to drawing canvas
              const brushSettings = currentState.tools.brushSettings;
              drawingCtxRef.current.globalAlpha = brushSettings.opacity || 1;
              drawingCtxRef.current.globalCompositeOperation = brushSettings.blendMode || 'source-over';
              drawingCtxRef.current.drawImage(activeLayer.colorCycleData.canvas, 0, 0);
              hasRendered = true;
            }
            
            // If no color cycle layer was found, fallback to legacy
            if (!hasRendered) {
              // Render current state only; do not call updateColorCycleAnimation here
              brushEngine.renderColorCycle(drawingCtxRef.current, true);
            }
            drawingCanvasHasContent.current = true;
          }
          lastRenderTime = timestamp;
        }

        colorCycleAnimationRef.current = requestAnimationFrame(animateWhileDrawing);
      };

      // Start the animation
      if (shouldAnimateLive) {
        colorCycleAnimationRef.current = requestAnimationFrame(animateWhileDrawing);
      } else {
        colorCycleAnimationRef.current = null;
      }
    }
    
    // Reset stamp counter for continuous sampling
    stampCounterRef.current = 0;
    const drawCtx = drawingCtxRef.current;
    if (!drawCtx || !drawingCanvasRef.current || !project) return;
      
    drawCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    drawingCanvasHasContent.current = true;
    lastDrawPosRef.current = worldPos;
    
    if (currentTool === 'eraser') {
      // OPTIMIZATION: Copy the active layer to the drawing canvas ONCE at the start.
      const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
      if (activeLayer?.imageData) {
        drawCtx.putImageData(activeLayer.imageData, 0, 0);
      }
      
      // OPTIMIZATION: Prepare the context for erasing. We will now "cut out"
      // from the image we just placed on the drawing canvas.
      drawCtx.globalCompositeOperation = 'destination-out';
      
      // Draw the initial eraser point.
      drawEraserSegment(drawCtx, worldPos, worldPos);

    } else { // Brush tool
      drawCtx.globalAlpha = 1.0;
      drawCtx.globalCompositeOperation = 'source-over';
      
      // Check if this is a user brush
      if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
        userBrushEngine.setActiveBrush(currentBrushId);
        userBrushEngine.startStroke(drawCtx, worldPos.x, worldPos.y, pressure);
      } else if (brushEngine) {
        let customBrushData: CustomBrushStrokeData | undefined = resolveActiveCustomBrushData(currentState);
        const ccStrokeFlags = getColorCycleBrushFlags(currentState.tools.brushSettings);

        if (ccStrokeFlags.isAny) {
          const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';

          if (!isColorCycleLayer) {
            return;
          }

          const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
          const layerGradient = activeLayer.colorCycleData?.gradient;
          const gradientsMatch =
            !brushGradient ||
            !layerGradient ||
            JSON.stringify(brushGradient) === JSON.stringify(layerGradient);

          if (!gradientsMatch) {
            return;
          }

          const spacing = currentState.tools.brushSettings.spacing || 1;

          if (ccStrokeFlags.isCustom) {
            const brushData = customBrushData ?? resamplerBrushDataRef.current;
            if (!brushData) {
              return;
            }

            if (colorCycleLastPosRef.current) {
              const dx = worldPos.x - colorCycleLastPosRef.current.x;
              const dy = worldPos.y - colorCycleLastPosRef.current.y;
              const distance = Math.sqrt(dx * dx + dy * dy);

              colorCycleDistanceRef.current += distance;

              if (colorCycleDistanceRef.current >= spacing) {
                const rotation = currentState.tools.brushSettings.rotationEnabled
                  ? Math.atan2(dy, dx)
                  : 0;
                brushEngine.drawColorCycle(drawCtx, worldPos.x, worldPos.y, pressure, rotation, {
                  customStamp: brushData
                });
                colorCycleDistanceRef.current = 0;
              }
            } else {
              brushEngine.drawColorCycle(drawCtx, worldPos.x, worldPos.y, pressure, 0, {
                customStamp: brushData
              });
            }

            colorCycleLastPosRef.current = worldPos;
            return;
          }

          if (colorCycleLastPosRef.current) {
            const dx = worldPos.x - colorCycleLastPosRef.current.x;
            const dy = worldPos.y - colorCycleLastPosRef.current.y;
            const distance = Math.sqrt(dx * dx + dy * dy);

            colorCycleDistanceRef.current += distance;

            if (colorCycleDistanceRef.current >= spacing) {
              const rotation = currentState.tools.brushSettings.rotationEnabled
                ? Math.atan2(dy, dx)
                : 0;
              brushEngine.drawColorCycle(drawCtx, worldPos.x, worldPos.y, pressure, rotation);
              colorCycleDistanceRef.current = 0;
            }
          } else {
            brushEngine.drawColorCycle(drawCtx, worldPos.x, worldPos.y, pressure, 0);
          }

          colorCycleLastPosRef.current = worldPos;
          return;
        } else if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER &&
            !currentState.tools.brushSettings.continuousSampling) {
          // Use the exact same approach as CustomBrushPanel for capturing
          const brushSize = currentState.tools.brushSettings.size || 20;
          const halfSize = brushSize / 2;
          
          
          const compositeCanvas = currentState.currentOffscreenCanvas;
          if (compositeCanvas) {
            // Calculate bounds exactly like CustomBrushPanel
            const minX = Math.floor(worldPos.x - halfSize);
            const minY = Math.floor(worldPos.y - halfSize);
            const maxX = Math.floor(worldPos.x + halfSize);
            const maxY = Math.floor(worldPos.y + halfSize);
            
            // Clamp to canvas bounds
            const sampleX = Math.max(0, minX);
            const sampleY = Math.max(0, minY);
            const sampleEndX = Math.min(compositeCanvas.width, maxX);
            const sampleEndY = Math.min(compositeCanvas.height, maxY);
            const width = sampleEndX - sampleX;
            const height = sampleEndY - sampleY;
            
            if (width > 0 && height > 0) {
              // Create canvas to capture the selection - EXACTLY like CustomBrushPanel
              const captureCanvas = document.createElement('canvas');
              captureCanvas.width = width;
              captureCanvas.height = height;
              const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
              
              if (captureCtx) {
                // Capture the selection area from the composite canvas
                try {
                  captureCtx.drawImage(
                    compositeCanvas,
                    sampleX, sampleY, width, height, // Source rectangle
                    0, 0, width, height              // Destination rectangle
                  );
                  
                  // Get ImageData for the brush
                  const imageData = captureCtx.getImageData(0, 0, width, height);
                  
                  customBrushData = {
                    imageData,
                    width,
                    height,
                    isColorizable: false,
                    isResampler: true,
                    cacheKey: 'resampler:single'
                  };

                  resamplerBrushDataRef.current = customBrushData;
                  
                  // DON'T change brush size - keep it as is so the sample matches cursor size
                  // The captured area is already the right size based on current brush size
                  
                } catch (error) {
                  debugWarn('resampler', 'Failed to sample canvas for Resampler brush:', error);
                }
              }
            }
          }
        }

        if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER) {
          customBrushData = resamplerBrushDataRef.current ?? customBrushData;
        }

        brushEngine.drawBrush(
          drawCtx,
          worldPos,
          worldPos,
          { pressure, customBrushData }
        );
      }
    }
    
    // Initial point drawn - parent component will handle redraw
  }, [
    initDrawingCanvas,
    brushEngine,
    userBrushEngine,
    project,
    drawEraserSegment,
    pauseColorCycleForNonCCInteraction,
    updateAutoSampledGradient
  ]);

  // Process batched stroke points
  const processBatchedStrokes = useCallback(() => {
    const batch = strokeBatchRef.current;
    if (batch.length === 0) return;
    
    const currentState = useAppStore.getState();
    const currentTool = currentState.tools.currentTool;
    const currentBrushId = currentState.currentBrushPreset?.id;
    const drawCtx = drawingCtxRef.current;
    
    if (!drawCtx || !project) {
      strokeBatchRef.current = [];
      return;
    }
    
    const boundary = { x: 0, y: 0, width: project.width, height: project.height };
    const ccProcessFlags = getColorCycleBrushFlags(currentState.tools.brushSettings);
    
    // Process all points in the batch
    for (let i = 0; i < batch.length; i++) {
      const { pos: worldPos, pressure } = batch[i];
      const lastPoint = lastDrawPosRef.current;
      
      if (!lastPoint) {
        lastDrawPosRef.current = worldPos;
        continue;
      }
      
      const clippedSegment = clipLineSegment(lastPoint, worldPos, boundary);
      
      if (clippedSegment) {
        const [clippedStart, clippedEnd] = clippedSegment;
        
        if (currentTool === 'eraser') {
          drawEraserSegment(drawCtx, clippedStart, clippedEnd);
        } else {
          if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
            userBrushEngine.continueStroke(drawCtx, clippedEnd.x, clippedEnd.y, pressure);
          } else if (brushEngine) {
            drawCtx.globalAlpha = 1.0;
            drawCtx.globalCompositeOperation = 'source-over';
            
            // Check if we're using a custom brush or resampler
            let customBrushData: CustomBrushStrokeData | undefined = resolveActiveCustomBrushData(currentState);
            
            // Check for Color Cycle brush with stroke processor features
            if (ccProcessFlags.isAny) {
              // GUARD: Verify layer compatibility before calling color cycle functions
              const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
              const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
              
              if (!isColorCycleLayer && activeLayer?.layerType) {
                // Color cycle brush on non-CC layer - skip processing to prevent crash
                continue; // Skip this batch item and continue with next
              }
              
              const brushGradient = currentState.tools.brushSettings.colorCycleGradient;
              const layerGradient = activeLayer?.colorCycleData?.gradient;
              const gradientsMatch =
                !brushGradient ||
                !layerGradient ||
                JSON.stringify(brushGradient) === JSON.stringify(layerGradient);

              if (!gradientsMatch) {
                continue;
              }

              const usingCustomStamp = ccProcessFlags.isCustom;
              const stampData = usingCustomStamp
                ? customBrushData ?? resamplerBrushDataRef.current
                : undefined;

              if (usingCustomStamp && !stampData) {
                continue;
              }
              
              // Use the spacing setting from brush controls - now in pixels directly
              const spacing = currentState.tools.brushSettings.spacing || 1;
              
              if (colorCycleLastPosRef.current) {
                const dx = clippedEnd.x - colorCycleLastPosRef.current.x;
                const dy = clippedEnd.y - colorCycleLastPosRef.current.y;
                const distance = Math.sqrt(dx * dx + dy * dy);
                
                colorCycleDistanceRef.current += distance;
                
                // Calculate rotation if enabled
                const rotation = currentState.tools.brushSettings.rotationEnabled 
                  ? Math.atan2(dy, dx) 
                  : 0;
                
                // Draw stamps at consistent intervals with stroke processor features
                while (colorCycleDistanceRef.current >= spacing) {
                  const t = 1 - (colorCycleDistanceRef.current - spacing) / distance;
                  let stampX = colorCycleLastPosRef.current.x + dx * t;
                  let stampY = colorCycleLastPosRef.current.y + dy * t;
                  
                  // Apply grid snapping if enabled
                  if (shouldApplyGridSnapPure(currentState.tools.brushSettings)) {
                    const gridSpacing = calculateGridSpacing();
                    const snapped = snapToGridPure(stampX, stampY, gridSpacing);
                    stampX = snapped.x;
                    stampY = snapped.y;
                  }
                  
                  // Check dashed pattern before drawing
                  if (shouldDrawStamp(currentState.tools.brushSettings, colorCyclePixelQueue.current, currentState.tools.brushSettings.size)) {
                    if (usingCustomStamp) {
                      brushEngine.drawColorCycle(drawCtx, stampX, stampY, pressure, rotation, {
                        customStamp: stampData!
                      });
                    } else if (currentState.tools.brushSettings.rotationEnabled && rotation !== 0) {
                      brushEngine.drawColorCycle(drawCtx, stampX, stampY, pressure, rotation);
                    } else {
                      brushEngine.drawColorCycle(drawCtx, stampX, stampY, pressure, 0);
                    }
                  }
                  
                  colorCycleDistanceRef.current -= spacing;
                }
              }
              
              colorCycleLastPosRef.current = clippedEnd;
              continue;
            } else if (currentState.tools.brushSettings.brushShape === BrushShape.RESAMPLER) {
              if (currentState.tools.brushSettings.continuousSampling) {
                // Continuous sampling mode - check if we need to resample
                stampCounterRef.current++;
                const resampleInterval = currentState.tools.brushSettings.resampleInterval || 5;
                
                // Resample when counter reaches interval or if we don't have data yet
                if (stampCounterRef.current >= resampleInterval || !resamplerBrushDataRef.current) {
                  // Reset counter
                  stampCounterRef.current = 0;
                  
                  // Capture new sample at current position
                  const brushSize = currentState.tools.brushSettings.size || 20;
                  const halfSize = brushSize / 2;
                  const compositeCanvas = currentState.currentOffscreenCanvas;
                  
                  if (compositeCanvas) {
                    // Use clippedEnd position for sampling
                    const samplePos = clippedEnd;
                    
                    // Calculate bounds
                    const minX = Math.floor(samplePos.x - halfSize);
                    const minY = Math.floor(samplePos.y - halfSize);
                    const maxX = Math.floor(samplePos.x + halfSize);
                    const maxY = Math.floor(samplePos.y + halfSize);
                    
                    // Clamp to canvas bounds
                    const sampleX = Math.max(0, minX);
                    const sampleY = Math.max(0, minY);
                    const sampleEndX = Math.min(compositeCanvas.width, maxX);
                    const sampleEndY = Math.min(compositeCanvas.height, maxY);
                    const width = sampleEndX - sampleX;
                    const height = sampleEndY - sampleY;
                    
                    if (width > 0 && height > 0) {
                      // Create canvas to capture the selection
                      const captureCanvas = document.createElement('canvas');
                      captureCanvas.width = width;
                      captureCanvas.height = height;
                      const captureCtx = captureCanvas.getContext('2d', { willReadFrequently: true });
                      
                      if (captureCtx) {
                        // Capture the selection area from the composite canvas
                        try {
                          captureCtx.drawImage(
                            compositeCanvas,
                            sampleX, sampleY, width, height, // Source rectangle
                            0, 0, width, height              // Destination rectangle
                          );
                          
                          // Get ImageData for the brush
                          const imageData = captureCtx.getImageData(0, 0, width, height);
                          
                          resamplerBrushDataRef.current = {
                            imageData,
                            width,
                            height,
                            isColorizable: false,
                            isResampler: true,
                            cacheKey: 'resampler:continuous'
                          };
                        } catch (error) {
                          debugWarn('resampler', 'Failed to sample canvas for continuous Resampler:', error);
                        }
                      }
                    }
                  }
                }
                
                // Use the current resampler data
                if (resamplerBrushDataRef.current) {
                  customBrushData = resamplerBrushDataRef.current;
                }
              } else if (resamplerBrushDataRef.current) {
                customBrushData = resamplerBrushDataRef.current;
              }
            }
            
            brushEngine.drawBrush(
              drawCtx,
              clippedStart,
              clippedEnd,
              { pressure, customBrushData }
            );
          }
        }
      }
      
      lastDrawPosRef.current = worldPos;

      // Record points for auto-sampling and defer gradient update to finalize
      try {
        const state = useAppStore.getState();
        const isCCStroke = getColorCycleBrushFlags(state.tools.brushSettings).isAny;
        if (isCCStroke && state.tools.brushSettings.autoSampleGradient) {
          autoSamplePointsRef.current.push(worldPos);
          if (autoSamplePointsRef.current.length > 5000) {
            autoSamplePointsRef.current.splice(0, autoSamplePointsRef.current.length - 5000);
          }
          // Live, throttled gradient update based on the whole stroke path so far
          updateAutoSampledGradient(autoSamplePointsRef.current);
        }
      } catch {}
    }
    
    // Clear the batch
    strokeBatchRef.current = [];
    strokeBatchTimerRef.current = null;
  }, [brushEngine, userBrushEngine, project, drawEraserSegment, updateAutoSampledGradient]);

  const continueDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    // Check if layer is still visible before continuing drawing
    const currentState = useAppStore.getState();
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer && !activeLayer.visible) {
      return; // Exit silently if layer became hidden mid-stroke
    }
    
    const now = performance.now();
    
    // Add to batch
    strokeBatchRef.current.push({ pos: worldPos, pressure });
    
    // Check if we should process immediately (throttling)
    if (now - lastProcessedTimeRef.current >= THROTTLE_MS) {
      // Process immediately
      processBatchedStrokes();
      lastProcessedTimeRef.current = now;
    } else {
      // Schedule batch processing if not already scheduled
      if (!strokeBatchTimerRef.current) {
        strokeBatchTimerRef.current = window.requestAnimationFrame(() => {
          processBatchedStrokes();
          lastProcessedTimeRef.current = performance.now();
        });
      }
    }
  }, [processBatchedStrokes]);
  
  const finalizeDrawing = useCallback(async (skipSave = false) => {
    if (isBusyRef?.current || !drawingCanvasRef.current || !drawingCanvasHasContent.current || !project) return;
    
    try {
      if (isBusyRef) isBusyRef.current = true;
      
      // Process any remaining batched strokes
      if (strokeBatchRef.current.length > 0) {
        processBatchedStrokes();
      }
      
      // Cancel any pending batch timer
      if (strokeBatchTimerRef.current) {
        cancelAnimationFrame(strokeBatchTimerRef.current);
        strokeBatchTimerRef.current = null;
      }
      
      lastDrawPosRef.current = null;
      
      // Clear resampler data and reset counter after stroke ends
      resamplerBrushDataRef.current = undefined;
      stampCounterRef.current = 0;

      // Finalize the stroke (draw any waiting pixels) for modular engine
      if (brushEngine.finalizeStroke && drawingCtxRef.current) {
        brushEngine.finalizeStroke(drawingCtxRef.current);
      }

      let currentState = useAppStore.getState();
      let activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
      const currentTool = currentState.tools.currentTool;
      const currentBrushId = currentState.currentBrushPreset?.id;
      
      // End stroke for user brushes
      if (currentBrushId && userBrushEngine.isUserBrush(currentBrushId)) {
        userBrushEngine.endStroke();
      }

      if (activeLayer) {
        if (currentTool === 'eraser') {
          // OPTIMIZATION: The drawingCanvas already has the final erased result.
          // We can capture it directly without any extra compositing.
          await captureCanvasToActiveLayer(drawingCanvasRef.current);
          saveCanvasState(drawingCanvasRef.current, 'eraser', 'Erased stroke');
          
        } else { // Brush tool
          const activeSettings = currentState.tools.brushSettings;
          const activeFlags = getColorCycleBrushFlags(activeSettings);
          
          // For color cycle brush, stop the animation and do final render
          if (activeFlags.isAny && drawingCtxRef.current) {
            // If auto-sampling is enabled, compute final 8-stop gradient across full stroke path now
            try {
              if (activeSettings.autoSampleGradient && autoSamplePointsRef.current.length > 0) {
                const finalPts = [...autoSamplePointsRef.current];
                const maxStops = 8;
                const samplePts = equidistantPointsOnPolyline(finalPts, Math.min(maxStops, Math.max(1, finalPts.length)));
                if (samplePts.length > 0) {
                  const colors = samplePts.map(p => sampleHexAt(p.x, p.y));
                  const stops = colors.map((c, i) => ({ position: samplePts.length === 1 ? 0 : i / (samplePts.length - 1), color: c }));
                  try {
                    setSharedColorCycleGradient(stops);
                  } catch {
                    useAppStore.getState().setBrushSettings({ colorCycleGradient: stops });
                  }
                  // Push into live brush
                  try { brushEngine.updateColorCycleGradient?.(stops); } catch {}
                  // One-shot: auto-disable sampling after applying
                  try {
                    const st = useAppStore.getState();
                    if (st.tools.brushSettings.autoSampleGradient) {
                      st.setBrushSettings({ autoSampleGradient: false });
                    }
                  } catch {}
                }
              }
            } catch {}
            // Stop animation loop
            if (colorCycleAnimationRef.current) {
              cancelAnimationFrame(colorCycleAnimationRef.current);
              colorCycleAnimationRef.current = null;
            }
            
            // End stroke and do final render
            brushEngine.endColorCycleStroke();
            
            // Phase 3: Direct rendering approach
            const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
            const colorCycleBrushManager = getColorCycleBrushManager();
            const colorCycleBrush = activeLayer ? colorCycleBrushManager.getBrush(activeLayer.id) : undefined;
            
            if (colorCycleBrush && activeLayer?.colorCycleData?.canvas) {
              // Final render directly to layer canvas at full opacity
              colorCycleBrush.renderDirectToCanvas(activeLayer.colorCycleData.canvas, activeLayer.id);
              
              // Copy to drawing canvas for final composite
              drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
              drawingCtxRef.current.globalAlpha = 1.0; // Full opacity for final
              drawingCtxRef.current.drawImage(activeLayer.colorCycleData.canvas, 0, 0);
            } else {
              // Fallback: Clear and do one final render at FULL OPACITY
              drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
              brushEngine.renderColorCycle(drawingCtxRef.current, false); // false = don't apply opacity
            }
            
            // IMPORTANT: Check if we should continue animating after stroke ends
            // The animation should continue if the play button is active
            // We'll rely on the DrawingCanvas to restart it based on UI state
          }
          
          // Handle capture differently for CC layers vs regular layers
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          // Treat stroke, shape, and custom CC variants as CC for saving
          const saveFlags = getColorCycleBrushFlags(activeSettings);
          const isColorCycleBrush = saveFlags.isAny;

          // Ensure CC layer has a canvas before attempting to save
          if (isColorCycleLayer && !activeLayer?.colorCycleData?.canvas && currentState.project) {
            try {
              useAppStore.getState().initColorCycleForLayer(activeLayer.id, currentState.project.width, currentState.project.height);
              // Refresh state references after init
              currentState = useAppStore.getState();
              activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
            } catch {
              // Suppressed debug warn for finalize init
            }
          }

          if (!activeLayer) {
            return;
          }

          if (isColorCycleLayer && isColorCycleBrush && activeLayer?.colorCycleData?.canvas) {
            const layerCanvas = activeLayer.colorCycleData.canvas;
            try {
              const colorCycleBrushManager = getColorCycleBrushManager();
              const brush = colorCycleBrushManager.getBrush(activeLayer.id) as ManagedColorCycleBrush | undefined;
              if (brush) {
                if (typeof brush.commitCurrentStroke === 'function') {
                  brush.commitCurrentStroke(activeLayer.id);
                } else {
                  brush.finalizeCurrentStroke?.(activeLayer.id);
                }

                if (typeof brush.commitToLayer === 'function') {
                  brush.commitToLayer(layerCanvas, activeLayer.id);
                } else {
                  brush.renderDirectToCanvas?.(layerCanvas, activeLayer.id);
                }

                brush.clearPaintBuffer?.(activeLayer.id);
              } else if (drawingCanvasRef.current) {
                try {
                  const targetCtx = layerCanvas.getContext('2d', { willReadFrequently: true });
                  if (targetCtx) {
                    targetCtx.save();
                    targetCtx.globalCompositeOperation = activeSettings.blendMode || 'source-over';
                    targetCtx.globalAlpha = activeSettings.opacity ?? 1;
                    targetCtx.drawImage(drawingCanvasRef.current, 0, 0);
                    targetCtx.restore();
                  }
                } catch {}
              }
            } catch {
              // Suppressed debug warn for buffer commit
            }

            // For CC layers, capture directly from the layer's canvas
            await captureCanvasToActiveLayer(layerCanvas);

            // Optional sampling: verify we saved the actual layer canvas (not paint buffer)
            try {
              const ctx = layerCanvas.getContext('2d', { willReadFrequently: true });
              ctx?.getImageData(0, 0, 1, 1);
            } catch {}

            // Skip saving if requested (for CC shapes that already saved)
            if (!skipSave) {
              const description = currentState.tools.shapeMode ? 'CC Shape' : 'CC Drawing stroke';
              saveCanvasState(layerCanvas, 'brush', description);
               
            } else {
               
            }
          } else if (isColorCycleLayer) {
            // On a color-cycle layer without a valid CC canvas, do not fall back to
            // regular layer saving, as that would create a misleading 'Drawing stroke'
            // history entry and break CC undo granularity. Skip saving in this edge case.
            // Reduce noise: suppressed finalize debug
          } else {
            // Regular layers: composite drawing onto layer
            const tempCanvas = document.createElement('canvas');
            tempCanvas.width = project.width;
            tempCanvas.height = project.height;
            const tempCtx = tempCanvas.getContext('2d', {
              willReadFrequently: true,
              alpha: true
            });
            
            if (tempCtx) {
              if (activeLayer.imageData) {
                tempCtx.putImageData(activeLayer.imageData, 0, 0);
              }
              // Don't re-apply opacity and blend mode - they were already applied during drawing
              tempCtx.globalCompositeOperation = 'source-over';
              tempCtx.globalAlpha = 1;
              tempCtx.drawImage(drawingCanvasRef.current, 0, 0);
              
              await captureCanvasToActiveLayer(tempCanvas);
              saveCanvasState(tempCanvas, 'brush', 'Drawing stroke');
              
              
              
              // Clean up temporary canvas to prevent memory leak
              tempCanvas.width = 1;
              tempCanvas.height = 1;
              tempCtx.clearRect(0, 0, 1, 1);
            }
          }
        }
      }
      
      // FIXED: Don't clear drawing canvas for CC shapes to prevent them from disappearing
      // Only clear for non-CC layers to prevent stale content issues
      const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
      const isAnyColorCycleBrush = getColorCycleBrushFlags(currentState.tools.brushSettings).isAny;

      if (!isColorCycleLayer || !isAnyColorCycleBrush) {
        // Clear the drawing canvas immediately after finalizing to prevent stale content
        // from appearing/disappearing when brush settings change
        if (drawingCtxRef.current && drawingCanvasRef.current) {
          drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        }
        drawingCanvasHasContent.current = false;
      }
      
      // Parent component will handle final redraw
    } catch (error) {
      logError('Error during finalization:', error);
    } finally {
      // Reset auto-sample state after stroke ends
      autoSamplePointsRef.current = [];
      autoSampleLastUpdateRef.current = 0;
      // Safety net: ensure one-shot sampling is turned off at end of stroke
      try {
        const st = useAppStore.getState();
        if (st.tools.brushSettings.autoSampleGradient) {
          st.setBrushSettings({ autoSampleGradient: false });
        }
      } catch {}
      await resumeColorCycleAfterInteraction();
      if (isBusyRef) isBusyRef.current = false;
    }
  }, [
    project,
    captureCanvasToActiveLayer,
    saveCanvasState,
    isBusyRef,
    userBrushEngine,
    brushEngine,
    processBatchedStrokes,
    equidistantPointsOnPolyline,
    sampleHexAt,
    resumeColorCycleAfterInteraction
  ]);

  const finalizeStroke = useCallback(() => {
    void finalizeDrawing(false);
  }, [finalizeDrawing]);
  
  const clearDrawingCanvas = useCallback(() => {
    if (drawingCtxRef.current && drawingCanvasRef.current) {
      drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
    }
    drawingCanvasHasContent.current = false;
    lastDrawPosRef.current = null;
  }, []);
  
  const startShapeDrawing = useCallback((worldPos: { x: number; y: number }, pressure: number = 0.5) => {
    // If we're selecting direction for linear gradient, record the direction
    if (isSelectingDirectionRef.current) {
      directionPreviewRef.current = worldPos;
      // Direction selection will be finalized in finalizeShapeDrawing
      return;
    }

    if (tools.shapeMode) {
      const state = useAppStore.getState();
      const isCCShape = state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;

      if (isCCShape) {
        // AUTO-START animations when using CC shape brush
        if (!getColorCycleAnimationState()) {
          toggleGlobalColorCyclePlayback(true);
        }
      } else {
        // Only pause for non-CC shape brushes
        pauseColorCycleForNonCCInteraction();
      }
      // quiet
      // Avoid allocating the full-size drawing canvas at the first vertex for
      // Color Cycle Shape previews. We render previews on the lightweight overlay
      // canvas and defer allocation until direction selection or finalization.
      try {
        const st = useAppStore.getState();
        const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
        if (!isCCShape) {
          initDrawingCanvas();
        }
      } catch {
        initDrawingCanvas();
      }
      // Support click-to-add vertices: if already drawing a shape, append point instead of resetting
      if (isDrawingShapeRef.current && shapePointsRef.current.length > 0) {
        shapePointsRef.current.push(worldPos);
      } else {
        shapePointsRef.current = [worldPos];
        isDrawingShapeRef.current = true;
        // Initialize auto-sampling for CC shape
        try {
          const st = useAppStore.getState();
          const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
          if (isCCShape && st.tools.brushSettings.autoSampleGradient) {
            autoSamplePointsRef.current = [...shapePointsRef.current];
            autoSampleLastUpdateRef.current = 0;
            updateAutoSampledGradient(autoSamplePointsRef.current);
          }
        } catch {}
      }
    } else {
      startDrawing(worldPos, pressure);
    }
  }, [tools.shapeMode, initDrawingCanvas, startDrawing, pauseColorCycleForNonCCInteraction, updateAutoSampledGradient]);
  
  const continueShapeDrawing = useCallback((worldPos: { x: number; y: number }) => {
    // Handle animations based on brush type
    if (tools.shapeMode && !ccShapePreviewPauseStartedRef.current) {
      const state = useAppStore.getState();
      const isCCShape = state.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;

      if (isCCShape) {
        // AUTO-START for CC shapes
        if (!getColorCycleAnimationState()) {
          toggleGlobalColorCyclePlayback(true);
        }
      } else {
        // Only pause for non-CC shapes
        pauseColorCycleForNonCCInteraction();
      }
      ccShapePreviewPauseStartedRef.current = true;
    }
    // Check if layer is still visible before continuing shape drawing
    const currentState = useAppStore.getState();
    const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
    if (activeLayer && !activeLayer.visible) {
      return; // Exit silently if layer became hidden mid-stroke
    }
    
    // If we're selecting direction, show preview line
    if (isSelectingDirectionRef.current && shapePointsRef.current.length >= 3) {
      // quiet
      
      // Make sure we have drawing context
      if (!drawingCtxRef.current || !drawingCanvasRef.current) {
        // quiet
        initDrawingCanvas();
      }
      
      const drawCtx = drawingCtxRef.current;
      if (drawCtx && drawingCanvasRef.current) {
        // quiet
        // Clear and redraw shape with transparent fill
        drawCtx.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
        
        // Draw shape with transparent black fill (same as preview during drawing)
        drawCtx.fillStyle = 'rgba(0, 0, 0, 0.3)';
        drawCtx.beginPath();
        drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
        for (let i = 1; i < shapePointsRef.current.length; i++) {
          drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
        }
        drawCtx.closePath();
        drawCtx.fill();
        
        // Calculate shape center
        let centerX = 0, centerY = 0;
        for (const p of shapePointsRef.current) {
          centerX += p.x;
          centerY += p.y;
        }
        centerX /= shapePointsRef.current.length;
        centerY /= shapePointsRef.current.length;
        
        // Draw direction line with difference blending mode
        drawCtx.save();
        drawCtx.globalCompositeOperation = 'difference';
        drawCtx.strokeStyle = '#000000';  // Black line
        drawCtx.lineWidth = 1;  // 1px width
        drawCtx.beginPath();
        drawCtx.moveTo(centerX, centerY);
        drawCtx.lineTo(worldPos.x, worldPos.y);
        drawCtx.stroke();
        drawCtx.restore();
      }
      return;
    }
    
    if (tools.shapeMode && isDrawingShapeRef.current) {
      const store = useAppStore.getState();
      const zoom = store.canvas?.zoom || 1;
      const brushSize = store.tools.brushSettings.size || 20;
      const added = appendSegmentWithDynamicResampling(shapePointsRef.current, worldPos, zoom, brushSize, 0.25, 0.6);
      if (added > 0) {
        // Live auto-sampling for CC Shape while adding vertices/segments
        try {
          const isCCShape = store.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
          if (isCCShape && store.tools.brushSettings.autoSampleGradient) {
            // Use the current polyline of the shape for sampling
            autoSamplePointsRef.current = [...shapePointsRef.current];
            updateAutoSampledGradient(autoSamplePointsRef.current);
          }
        } catch {}
      }
    } else if (!tools.shapeMode) {
      continueDrawing(worldPos);
    }
  }, [tools.shapeMode, continueDrawing, pauseColorCycleForNonCCInteraction, updateAutoSampledGradient, initDrawingCanvas]);
  
  const finalizeShapeDrawing = useCallback(async () => {
    if (!tools.shapeMode) {
      return finalizeDrawing();
    }
    
    if (isBusyRef?.current) return;
    
    // Check if we're in direction selection mode for linear gradient
    if (isSelectingDirectionRef.current && directionPreviewRef.current) {
      try {
        if (isBusyRef) isBusyRef.current = true;
        
        const drawCtx = drawingCtxRef.current;
        if (drawCtx && brushEngine && shapePointsRef.current.length >= 3) {
          // Calculate shape center
          let centerX = 0, centerY = 0;
          for (const p of shapePointsRef.current) {
            centerX += p.x;
            centerY += p.y;
          }
          centerX /= shapePointsRef.current.length;
          centerY /= shapePointsRef.current.length;
          
          // Calculate direction vector from center to click point
          const direction = {
            x: directionPreviewRef.current.x - centerX,
            y: directionPreviewRef.current.y - centerY
          };
          
          // Clear the canvas first
          drawCtx.clearRect(0, 0, drawingCanvasRef.current?.width || 0, drawingCanvasRef.current?.height || 0);
          
          // Reset and fill with linear gradient
          // Pass false to keep existing shapes (we save state elsewhere)
          brushEngine.resetColorCycle(false);
          brushEngine.fillColorCycleShapeLinear(shapePointsRef.current, direction);
          
          // Handle color cycle layer finalization
          const currentState = useAppStore.getState();
          const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          
          if (isColorCycleLayer && activeLayer?.colorCycleData?.canvas) {
            brushEngine.updateColorCycleTexture();
            
            const colorCycleBrushManager = getColorCycleBrushManager();
            const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayerId || '');
            if (colorCycleBrush) {
              colorCycleBrush.renderDirectToCanvas(activeLayer.colorCycleData.canvas, activeLayerId || '');
            }
            
            drawCtx.clearRect(0, 0, drawingCanvasRef.current?.width || 0, drawingCanvasRef.current?.height || 0);
            drawCtx.globalAlpha = 1.0;
            drawCtx.globalCompositeOperation = 'source-over';
            drawCtx.drawImage(activeLayer.colorCycleData.canvas, 0, 0);
            
            // For CC layers, avoid an extra full-canvas capture; snapshot will
            // record CC state separately. Save history directly.
            saveCanvasState(activeLayer.colorCycleData.canvas, 'fill', 'CC Shape Linear');
          }
          
          drawingCanvasHasContent.current = true;
        }
        
        // Reset state
        isSelectingDirectionRef.current = false;
        directionPreviewRef.current = null;
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
        
        ccShapePreviewPauseStartedRef.current = false;

        await resumeColorCycleAfterInteraction();
        if (isBusyRef) isBusyRef.current = false;
        return;
    } catch (error) {
      logError('Error during linear gradient direction selection:', error);
      } finally {
        if (isBusyRef) isBusyRef.current = false;
      }
    }
    
    try {
      // Ensure drawing canvas/context exist before we render any final content
      if (!drawingCtxRef.current || !drawingCanvasRef.current) {
        initDrawingCanvas();
      }
      if (isBusyRef) isBusyRef.current = true;
      
      // quiet
      if (isDrawingShapeRef.current && shapePointsRef.current.length >= 3) {
        const drawCtx = drawingCtxRef.current;
        if (drawCtx && brushEngine) {
          // quiet
          drawCtx.globalAlpha = 1.0;
          drawCtx.globalCompositeOperation = 'source-over';
          
          // Check if we're using a pixel brush - need crisp edges
          const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND || 
            (tools.brushSettings.brushShape === BrushShape.SQUARE && !tools.brushSettings.antialiasing);
          
          // Set ALL smoothing properties to ensure pixel-perfect shapes
          if (isPixelBrush) {
            drawCtx.imageSmoothingEnabled = false;
            drawCtx.imageSmoothingQuality = 'low';
          } else {
            drawCtx.imageSmoothingEnabled = true;
            drawCtx.imageSmoothingQuality = 'high';
          }
          
          // If drawing a Color Cycle Shape and auto-sampling is enabled, finalize gradient now
          try {
            const st = useAppStore.getState();
            const isCCShape = st.tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_SHAPE;
            if (isCCShape && st.tools.brushSettings.autoSampleGradient) {
              const finalPts = [...shapePointsRef.current];
              const maxStops = 8;
              const samplePts = equidistantPointsOnPolyline(finalPts, Math.min(maxStops, Math.max(1, finalPts.length)));
              if (samplePts.length > 0) {
                const colors = samplePts.map(p => sampleHexAt(p.x, p.y));
                const stops = colors.map((c, i) => ({ position: samplePts.length === 1 ? 0 : i / (samplePts.length - 1), color: c }));
                try {
                  setSharedColorCycleGradient(stops);
                } catch {
                  useAppStore.getState().setBrushSettings({ colorCycleGradient: stops });
                }
                try { brushEngine.updateColorCycleGradient?.(stops); } catch {}
                // One-shot: auto-disable sampling after applying for shapes
                try {
                  if (st.tools.brushSettings.autoSampleGradient) {
                    st.setBrushSettings({ autoSampleGradient: false });
                  }
                } catch {}
              }
            }
          } catch {}

          // Check if we're using a custom brush
          const isCustomBrush = tools.brushSettings.brushShape === BrushShape.CUSTOM;
          let customBrushImageData: ImageData | null = null;
          let customBrushWidth = 0;
          let customBrushHeight = 0;
          let isColorizable = false;
          
          if (isCustomBrush) {
            // Try to get custom brush from currentBrushTip first
            if (tools.brushSettings.currentBrushTip) {
              const brushTip = tools.brushSettings.currentBrushTip;
              customBrushImageData = brushTip.imageData;
              customBrushWidth = brushTip.width || brushTip.imageData.width;
              customBrushHeight = brushTip.height || brushTip.imageData.height;
              isColorizable = brushTip.isColorizable || tools.brushSettings.useSwatchColor || !!tools.brushSettings.customBrushColorCycle;
            } else if (tools.brushSettings.selectedCustomBrush) {
              // Look for custom brush in project's custom brushes from the store
              const currentState = useAppStore.getState();
              
              // First check temporary brush
              if (currentState.temporaryCustomBrush?.id === tools.brushSettings.selectedCustomBrush) {
                const tempBrush = currentState.temporaryCustomBrush;
                customBrushImageData = tempBrush.imageData;
                customBrushWidth = tempBrush.width;
                customBrushHeight = tempBrush.height;
                isColorizable = tools.brushSettings.useSwatchColor || !!tools.brushSettings.customBrushColorCycle;
              } else {
                // Then check saved custom brushes
                const customBrush = currentState.project?.customBrushes?.find(b => b.id === tools.brushSettings.selectedCustomBrush);
                if (customBrush) {
                  customBrushImageData = customBrush.imageData;
                  customBrushWidth = customBrush.width;
                  customBrushHeight = customBrush.height;
                  isColorizable = tools.brushSettings.useSwatchColor || !!tools.brushSettings.customBrushColorCycle;
                }
              }
            }
          }
          
          if (isCustomBrush && customBrushImageData) {
            try {
            // quiet
            } catch {}
            // Calculate scaled size based on brush settings, maintaining aspect ratio
            const scale = tools.brushSettings.size / 100;
            // Ensure at least 1px to avoid zero-size tiles causing artifacts
            const scaledWidth = Math.max(1, Math.round(customBrushWidth * scale));
            const scaledHeight = Math.max(1, Math.round(customBrushHeight * scale));
            
            // Create a pattern canvas at the scaled size
            const patternCanvas = document.createElement('canvas');
            patternCanvas.width = scaledWidth;
            patternCanvas.height = scaledHeight;
            const patternCtx = patternCanvas.getContext('2d');
            
            if (patternCtx) {
              // Create temp canvas for the original brush tip
              const tipCanvas = document.createElement('canvas');
              tipCanvas.width = customBrushWidth;
              tipCanvas.height = customBrushHeight;
              const tipCtx = tipCanvas.getContext('2d');
              
              if (tipCtx) {
                tipCtx.putImageData(customBrushImageData, 0, 0);
                
                // Apply color if the brush is colorizable
                if (isColorizable) {
                  tipCtx.globalCompositeOperation = 'source-atop';
                  tipCtx.fillStyle = tools.brushSettings.color;
                  tipCtx.fillRect(0, 0, tipCanvas.width, tipCanvas.height);
                }
                
                // Scale and draw to pattern canvas
                // Disable smoothing to prevent subpixel seams when the pattern repeats
                if (patternCtx) {
                  patternCtx.imageSmoothingEnabled = false;
                  try {
                    // Some browsers support this hint
                    patternCtx.imageSmoothingQuality = 'low';
                  } catch {}
                }
                // Use explicit src/dst rect signature to avoid implicit resampling differences
                patternCtx.drawImage(
                  tipCanvas,
                  0,
                  0,
                  tipCanvas.width,
                  tipCanvas.height,
                  0,
                  0,
                  scaledWidth,
                  scaledHeight
                );
                
                // Create pattern from the scaled brush
                const pattern = drawCtx.createPattern(patternCanvas, 'repeat');
                if (pattern) {
                  // Ensure no smoothing when painting the pattern fill
                  drawCtx.imageSmoothingEnabled = false;
                  drawCtx.fillStyle = pattern;
                  // quiet
                } else {
                  drawCtx.fillStyle = tools.brushSettings.color;
                  // quiet
                }
                
                // Clean up tip canvas to prevent memory leak
                tipCanvas.width = 1;
                tipCanvas.height = 1;
                tipCtx.clearRect(0, 0, 1, 1);
              } else {
                drawCtx.fillStyle = tools.brushSettings.color;
              }
              
              // Note: Do not mutate patternCanvas here; keep it intact until after fill
            } else {
              drawCtx.fillStyle = tools.brushSettings.color;
              
              // Leave patternCanvas intact; rely on GC after draw
            }
          } else {
            // Use solid color for non-custom brushes or if custom brush not found
            drawCtx.fillStyle = tools.brushSettings.color;
          }

          // Check if we're on a color cycle layer - if so, skip regular shape drawing
          const currentState = useAppStore.getState();
          const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          
          if (!isColorCycleLayer) {
            // Only draw regular shapes if NOT on a color cycle layer
            drawCtx.beginPath();
          if (isPixelBrush) {
            // For pixel brushes, snap all coordinates to integer pixels for crisp edges
            drawCtx.moveTo(Math.round(shapePointsRef.current[0].x), Math.round(shapePointsRef.current[0].y));
            for (let i = 1; i < shapePointsRef.current.length; i++) {
              drawCtx.lineTo(Math.round(shapePointsRef.current[i].x), Math.round(shapePointsRef.current[i].y));
            }
          } else {
            // Use original coordinates for smooth brushes
            drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
            for (let i = 1; i < shapePointsRef.current.length; i++) {
              drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
            }
          }
          drawCtx.closePath();
          drawCtx.fill();
          
          // Apply risograph effect if enabled (matching monolithic implementation)
          const risographIntensity = tools.brushSettings.risographIntensity || 0;
          if (risographIntensity > 0) {
            // Use GPU-accelerated risograph effect with cached pattern
            const pattern = getRisographPattern(drawCtx);
            
            if (pattern) {
              // Save current state
              drawCtx.save();
              
              // Add misregistration offset
              const effectStrength = risographIntensity / 100;
              const misregX = (Math.random() - 0.5) * effectStrength * 2;
              const misregY = (Math.random() - 0.5) * effectStrength * 2;
              drawCtx.translate(misregX, misregY);
              
              // Create clipping path for the polygon (with optional roughness)
              drawCtx.beginPath();
              if (isPixelBrush) {
                // For pixel brushes, use pixel-aligned coordinates
                drawCtx.moveTo(Math.round(shapePointsRef.current[0].x), Math.round(shapePointsRef.current[0].y));
                for (let i = 1; i < shapePointsRef.current.length; i++) {
                  if (tools.brushSettings.risographOutline) {
                    // Add slight roughness to edges only if outline is enabled
                    const roughX = Math.round(shapePointsRef.current[i].x + (Math.random() - 0.5) * effectStrength);
                    const roughY = Math.round(shapePointsRef.current[i].y + (Math.random() - 0.5) * effectStrength);
                    drawCtx.lineTo(roughX, roughY);
                  } else {
                    // Clean edges without roughness, pixel-aligned
                    drawCtx.lineTo(Math.round(shapePointsRef.current[i].x), Math.round(shapePointsRef.current[i].y));
                  }
                }
              } else {
                // For smooth brushes, use original coordinates
                drawCtx.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
                for (let i = 1; i < shapePointsRef.current.length; i++) {
                  if (tools.brushSettings.risographOutline) {
                    // Add slight roughness to edges only if outline is enabled
                    const roughX = shapePointsRef.current[i].x + (Math.random() - 0.5) * effectStrength;
                    const roughY = shapePointsRef.current[i].y + (Math.random() - 0.5) * effectStrength;
                    drawCtx.lineTo(roughX, roughY);
                  } else {
                    // Clean edges without roughness
                    drawCtx.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
                  }
                }
              }
              drawCtx.closePath();
              drawCtx.clip();
              
              // Apply texture with appropriate alpha based on brush type
              // Shape fills need stronger effect since they don't have overlapping stamps like strokes
              // Use higher multiplier to match visual strength of strokes
              const risoAlpha = isPixelBrush ? 0.8 : 0.5;
              
              drawCtx.globalCompositeOperation = 'multiply';
              drawCtx.globalAlpha = effectStrength * risoAlpha;
              drawCtx.fillStyle = pattern;
              drawCtx.fillRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
              
              // Restore state
              drawCtx.restore();
            }
          }
          } // End of !isColorCycleLayer block
          
          // Don't need to check again - we already have isColorCycleLayer from above
          
          // For color cycle layer, we need to fill the shape and render it
          if (isColorCycleLayer && drawCtx) {
            // Don't stop the animation - let it continue if it's playing
            // We'll just add the shape to the color cycle layers
            
            // Reset and fill the shape with color cycle gradient
            // Pass false to keep existing shapes (we already saved state above)
            brushEngine.resetColorCycle(false);
            
            // Check fill mode and fill accordingly
            if (shapePointsRef.current.length >= 3) {
              const fillMode = tools.brushSettings.colorCycleFillMode || 'concentric';
              // quiet
              
              if (fillMode === 'linear') {
                // For linear mode, enter direction selection phase
                // quiet
                isSelectingDirectionRef.current = true;
                isDrawingShapeRef.current = false;
                
                // Stop any color cycle animation during direction selection to prevent flickering
                if (colorCycleAnimationRef.current) {
                  cancelAnimationFrame(colorCycleAnimationRef.current);
                  colorCycleAnimationRef.current = null;
                }
                if (continuousColorCycleAnimationRef.current) {
                  stopCCRef.current();
                }
                
                
                // Keep the shape points for when direction is selected
                // Make sure drawing canvas is initialized
                if (!drawingCanvasRef.current || !drawingCtxRef.current) {
                  // quiet
                  initDrawingCanvas();
                }
                
                // Draw a preview of the shape with dashed outline
                if (drawingCtxRef.current && drawingCanvasRef.current) {
                  drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
                  drawingCtxRef.current.save();
                  drawingCtxRef.current.globalCompositeOperation = 'difference';
                  drawingCtxRef.current.strokeStyle = '#000000';  // Black with difference mode
                  drawingCtxRef.current.lineWidth = 2;
                  drawingCtxRef.current.beginPath();
                  drawingCtxRef.current.moveTo(shapePointsRef.current[0].x, shapePointsRef.current[0].y);
                  for (let i = 1; i < shapePointsRef.current.length; i++) {
                    drawingCtxRef.current.lineTo(shapePointsRef.current[i].x, shapePointsRef.current[i].y);
                  }
                  drawingCtxRef.current.closePath();
                  drawingCtxRef.current.stroke();
                  drawingCtxRef.current.restore();
                  
                  drawingCanvasHasContent.current = true;
      // quiet
                } else {
                  // quiet
                }
                
                // Exit early - don't finalize yet, wait for direction click
                if (isBusyRef) isBusyRef.current = false;
                // quiet
                return;
              } else {
                // Concentric fill (default)
                brushEngine.fillColorCycleShape(shapePointsRef.current);
                
                // CRITICAL FIX: Ensure the CC layer's canvas is updated with the shape
                // This should ONLY happen for concentric mode, not linear (which needs direction first)
                if (activeLayerId && activeLayer.colorCycleData?.canvas) {
                  // Force immediate texture update and render to the layer's canvas
                  brushEngine.updateColorCycleTexture();
                  
                  // Get the color cycle brush and render directly to the layer's canvas
                  const colorCycleBrushManager = getColorCycleBrushManager();
                  const colorCycleBrush = colorCycleBrushManager.getBrush(activeLayerId);
                  if (colorCycleBrush) {
                    // Render directly to the layer's canvas to ensure it's updated
                    colorCycleBrush.renderDirectToCanvas(activeLayer.colorCycleData.canvas, activeLayerId);
                  }
                  
                  // Now render from the layer's canvas to the drawing canvas for display
                  drawCtx.clearRect(0, 0, drawingCanvasRef.current?.width || 0, drawingCanvasRef.current?.height || 0);
                  drawCtx.globalAlpha = 1.0; // Full opacity for finalization
                  drawCtx.globalCompositeOperation = 'source-over';
                  drawCtx.drawImage(activeLayer.colorCycleData.canvas, 0, 0);
                  
                  // Save state AFTER the shape is rendered (no extra capture)
                  // Mark as important to avoid debounce coalescing multiple shapes
                  saveCanvasState(activeLayer.colorCycleData.canvas, 'fill', 'CC Shape');

                  // Force composite refresh so the persisted shape appears even if
                  // the overlay is suppressed by CC animation state.
                  try { window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate')); } catch {}
                }
                
                drawingCanvasHasContent.current = true;
              }
            }
          }
          
          drawingCanvasHasContent.current = true;
        }
        
        // Only clear shape points if we're NOT in direction selection mode
        // Linear mode needs to keep the points for when direction is selected
        // quiet
        if (!isSelectingDirectionRef.current) {
          // quiet
          shapePointsRef.current = [];
          isDrawingShapeRef.current = false;
        } else {
          // quiet
        }
        
        // FIXED: For CC shapes on CC layers, handle finalization directly without calling finalizeDrawing
        // which would clear the drawing canvas and make the shape disappear
        const currentState = useAppStore.getState();
        const activeLayer = currentState.layers.find(l => l.id === currentState.activeLayerId);
        const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
        
        if (isColorCycleLayer && drawingCanvasHasContent.current) {
          // For CC layers, the save already happened after drawing the shape
          // No need to save again here

          // Reset auto-sample state after shape ends
          autoSamplePointsRef.current = [];
          autoSampleLastUpdateRef.current = 0;
          await resumeColorCycleAfterInteraction();
          if (isBusyRef) isBusyRef.current = false;
          return;
        }

        if (isBusyRef) isBusyRef.current = false;
        await finalizeDrawing();
        ccShapePreviewPauseStartedRef.current = false;
        await resumeColorCycleAfterInteraction();
        return;
      } else if (isDrawingShapeRef.current) {
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
      }
    } catch (error) {
      logError('Error during shape finalization:', error);
    } finally {
      if (isBusyRef) isBusyRef.current = false;
    }
  }, [tools.shapeMode, tools.brushSettings, brushEngine, finalizeDrawing, isBusyRef, saveCanvasState, activeLayerId, initDrawingCanvas, equidistantPointsOnPolyline, sampleHexAt, resumeColorCycleAfterInteraction]);
  
  // Helper function to render all visible color cycle layers
  const renderAllColorCycleLayers = useCallback((targetCtx: CanvasRenderingContext2D, onlyActiveLayer: boolean = false) => {
    const currentState = useAppStore.getState();
    let hasRendered = false;
    
    // Iterate through all layers and render color cycles
    currentState.layers.forEach(layer => {
      // Skip if we only want active layer and this isn't it
      if (onlyActiveLayer && layer.id !== currentState.activeLayerId) {
        return;
      }
      
      // Check if layer has color cycle and is visible
      if (layer.visible && layer.layerType === 'color-cycle' && 
          layer.colorCycleData?.canvas) {
        
        const colorCycleBrushManager = getColorCycleBrushManager();
        const colorCycleBrush = colorCycleBrushManager.getBrush(layer.id);
        if (!colorCycleBrush) return;
        
        // Advance strictly when the store marks this layer as animating
        // This ensures Pause reliably stops updates regardless of internal animator state.
        if (layer.colorCycleData.isAnimating) {
          colorCycleBrush.updateAnimation();
          colorCycleBrush.renderDirectToCanvas(layer.colorCycleData.canvas, layer.id);
        }
        
        // Composite this layer onto the target canvas
        if (layer.id === currentState.activeLayerId || !onlyActiveLayer) {
          targetCtx.globalAlpha = layer.opacity;
          targetCtx.globalCompositeOperation = layer.blendMode || 'source-over';
          targetCtx.drawImage(layer.colorCycleData.canvas, 0, 0);
          hasRendered = true;
        }
      }
    });
    
    return hasRendered;
  }, []);

  // Start continuous color cycle animation (for when play button is pressed)
  const startContinuousColorCycleAnimation = useCallback(() => {
    const state = useAppStore.getState();
    // Consider ALL brush-based color-cycle layers, regardless of active selection
    const ccLayers = state.layers.filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor');
    if (ccLayers.length === 0) {
      // Nothing to animate
      return;
    }

    // Stop any existing continuous animation
    if (continuousColorCycleAnimationRef.current) {
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
    }

    // Initialize drawing canvas if needed
    if (!drawingCanvasRef.current || !drawingCtxRef.current) {
      initDrawingCanvas();
    }

    // Check again after initialization
    if (!drawingCtxRef.current || !drawingCanvasRef.current) {
      logError('[DrawingHandlers] Failed to initialize drawing canvas');
      return;
    }

    // Ensure CC brushes exist for all CC layers (idempotent)
    try {
      const mgr = getColorCycleBrushManager();
      const projW = state.project?.width || 1024;
      const projH = state.project?.height || 1024;
      ccLayers.forEach(l => {
        const hasBrush = !!mgr.getBrush(l.id);
        if (!hasBrush) {
          // Delegate to store action to create and wire layer canvas/metadata
          try { state.initColorCycleForLayer(l.id, projW, projH); } catch {}
        }
      });
    } catch {}

    // Mark ALL brush-based CC layers as animating so render loop advances them
    try {
      const st = useAppStore.getState();
      ccLayers.forEach(layer => {
        const updatedData: Layer['colorCycleData'] = {
          ...(layer.colorCycleData ?? {}),
          isAnimating: true,
        };
        st.updateLayer(layer.id, { colorCycleData: updatedData });
      });
    } catch {}

    // IMPORTANT: Do an initial render to show existing content across all CC layers
    if (drawingCtxRef.current && drawingCanvasRef.current) {
      drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      const had = renderAllColorCycleLayers(drawingCtxRef.current, false);
      if (!had) {
        // Fallback: Legacy rendering for compatibility
        try { brushEngine.renderColorCycle(drawingCtxRef.current, true); } catch {}
      }
      try {
        // Force a composite refresh so base layers are redrawn
        window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
      } catch {}
    }

    // Resume the color cycle brush animation explicitly (avoid toggle side-effects) for active brush engine
    try {
      if (brushEngine && !brushEngine.isColorCycleAnimating?.()) {
        brushEngine.resumeColorCycleAnimation?.();
      }
    } catch {}

    // Mark that the drawing canvas has content so it gets rendered
    drawingCanvasHasContent.current = true;
    
    let lastRenderTime = 0;
    const targetFPS = 30; // Increased for smoother animation
    const frameInterval = 1000 / targetFPS;
    
    // Store the animation state on the ref so stop can access it
    continuousColorCycleAnimationActiveRef.current = true;

    const animateContinuousColorCycle = (timestamp: number) => {
      // IMMEDIATELY schedule the next frame to ensure continuity
      if (continuousColorCycleAnimationActiveRef.current) {
        continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);
      } else {
        continuousColorCycleAnimationRef.current = null;
        return;
      }
      
      // Then do the rendering work
      if (timestamp - lastRenderTime >= frameInterval) {
        if (drawingCtxRef.current && drawingCanvasRef.current) {
          // Clear drawing canvas once
          drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
          
          // Use the helper to render all color cycle layers
          // During continuous animation, show all color cycle layers
          const hasColorCycleContent = renderAllColorCycleLayers(drawingCtxRef.current, false);
          
          // If no color cycle layers were rendered, try legacy fallback
          if (!hasColorCycleContent) {
            // Fallback: Legacy rendering for compatibility
            // IMPORTANT: Do not advance animation when paused
            let shouldAdvance = false;
            try {
              // Respect brush animator state
              shouldAdvance = !!(brushEngine.isColorCycleAnimating && brushEngine.isColorCycleAnimating());
              if (!shouldAdvance) {
                // Also check store flags in case animator is out-of-sync
                const st = useAppStore.getState();
                shouldAdvance = st.layers.some(l => l.layerType === 'color-cycle' && !!l.colorCycleData?.isAnimating);
              }
            } catch {}
            if (shouldAdvance) {
              brushEngine.updateColorCycleAnimation?.();
            }
            brushEngine.renderColorCycle(drawingCtxRef.current, true);
            drawingCanvasHasContent.current = true;
          } else {
            drawingCanvasHasContent.current = true;
          }
          
          // Trigger main canvas to re-composite layers with updated CC canvases
          window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));
        }
        lastRenderTime = timestamp;
      }
    };
    
    // Start the animation
    continuousColorCycleAnimationRef.current = requestAnimationFrame(animateContinuousColorCycle);

    // Broadcast unified animation state for brush-based CC
    try {
      window.dispatchEvent(new CustomEvent('colorCycleAnimationState', { detail: { isPlaying: true, source: 'brush' } }));
    } catch {}
  }, [brushEngine, initDrawingCanvas, renderAllColorCycleLayers]);
  
  // Stop continuous color cycle animation AND pause it (applies to all brush-based CC layers)
  const stopContinuousColorCycleAnimation = useCallback(() => {
    pauseAllBrushCCAnimationsNow();
    // DO NOT track for auto-resume - animations stay paused

    continuousColorCycleAnimationActiveRef.current = false;
    if (continuousColorCycleAnimationRef.current) {
      cancelAnimationFrame(continuousColorCycleAnimationRef.current);
      continuousColorCycleAnimationRef.current = null;
    }

    // Ensure store flags reflect paused state so overlay preview can render
    try {
      const st = useAppStore.getState();
      st.layers.forEach(layer => {
        const shouldPause =
          layer.layerType === 'color-cycle' &&
          layer.colorCycleData?.mode !== 'recolor' &&
          layer.colorCycleData?.isAnimating;

        if (!shouldPause || !layer.colorCycleData) {
          return;
        }

        const updatedData: Layer['colorCycleData'] = {
          ...layer.colorCycleData,
          isAnimating: false,
        };

        st.updateLayer(layer.id, { colorCycleData: updatedData });
      });
    } catch {}

    // Clear the overlay drawing canvas so CC frames don't sit above the layer stack
    try {
      if (drawingCtxRef.current && drawingCanvasRef.current) {
        drawingCtxRef.current.clearRect(0, 0, drawingCanvasRef.current.width, drawingCanvasRef.current.height);
      }
    } catch {}

    // Mark no overlay content; rely on compositeLayersToCanvas for final display
    drawingCanvasHasContent.current = false;

    // Ask the main canvas to recompose with current layer order
    try { window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate')); } catch {}
  }, [pauseAllBrushCCAnimationsNow]);

  // Keep callable refs in sync with the real animation controls
  useEffect(() => {
    startCCRef.current = startContinuousColorCycleAnimation;
    stopCCRef.current = stopContinuousColorCycleAnimation;
  }, [startContinuousColorCycleAnimation, stopContinuousColorCycleAnimation]);
  
  // Setter for feedback message callback
  const setFeedbackCallback = useCallback((callback: (message: string) => void) => {
    feedbackMessageRef.current = callback;
  }, []);
  
  return {
    drawingCanvasRef,
    drawingCanvasHasContent,
    isCapturing,
    initDrawingCanvas,
    startDrawing,
    continueDrawing,
    finalizeDrawing,
    finalizeStroke,
    clearDrawingCanvas,
    startShapeDrawing,
    continueShapeDrawing,
    finalizeShapeDrawing,
    shapePointsRef,
    isDrawingShapeRef,
    isSelectingDirectionRef,  // Export this so DrawingCanvas knows we're in direction selection mode
    startContinuousColorCycleAnimation,
    stopContinuousColorCycleAnimation,
    setFeedbackCallback
  };
}

export type DrawingHandlers = ReturnType<typeof useDrawingHandlers>;

type CustomBrushStoreState = {
  tools: {
    brushSettings: BrushSettings;
  };
  temporaryCustomBrush?: CustomBrush | null;
  project?: {
    customBrushes?: CustomBrush[];
  } | null;
};

function resolveActiveCustomBrushData(state: CustomBrushStoreState): CustomBrushStrokeData | undefined {
  const settings = state.tools.brushSettings;

  if (settings.currentBrushTip) {
    const brushTip = settings.currentBrushTip;
    return {
      imageData: brushTip.imageData,
      width: brushTip.width || brushTip.imageData.width,
      height: brushTip.height || brushTip.imageData.height,
      isColorizable:
        brushTip.isColorizable || settings.useSwatchColor || !!settings.customBrushColorCycle,
      cacheKey: `tip:${brushTip.brushId ?? 'anon'}`
    };
  }

  if (settings.selectedCustomBrush) {
    if (state.temporaryCustomBrush?.id === settings.selectedCustomBrush) {
      const tempBrush = state.temporaryCustomBrush;
      return {
        imageData: tempBrush.imageData,
        width: tempBrush.width,
        height: tempBrush.height,
        isColorizable: settings.useSwatchColor || !!settings.customBrushColorCycle,
        cacheKey: `temp:${tempBrush.id ?? 'anon'}`
      };
    }

    const saved = state.project?.customBrushes?.find(
      brush => brush.id === settings.selectedCustomBrush
    );
    if (saved) {
      return {
        imageData: saved.imageData,
        width: saved.width,
        height: saved.height,
        isColorizable: settings.useSwatchColor || !!settings.customBrushColorCycle,
        cacheKey: `project:${saved.id ?? 'anon'}`
      };
    }
  }

  return undefined;
}

function getColorCycleBrushFlags(settings: BrushSettings) {
  const shape = settings.brushShape;
  const isStandard = shape === BrushShape.COLOR_CYCLE;
  const isShapeVariant = shape === BrushShape.COLOR_CYCLE_SHAPE;
  const isCustom = shape === BrushShape.CUSTOM && settings.customBrushColorCycle === true;
  return {
    isStandard,
    isShapeVariant,
    isCustom,
    isAny: isStandard || isShapeVariant || isCustom
  };
}
