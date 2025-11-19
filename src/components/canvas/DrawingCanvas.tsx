import React, { useRef, useEffect, useCallback, useState, useMemo, useLayoutEffect } from 'react';
import { useFeatureFlag } from '@/config/featureFlags';
import { selectEffectiveColorCyclePlaying, useAppStore } from '@/stores/useAppStore';
import {
  selectActiveLayerId,
  selectLayers,
  selectLayersNeedRecomposition,
  selectReferenceLayerId,
  selectSetLayersNeedRecomposition,
} from '@/stores/selectors/layersSelectors';
import { selectFloatingPaste } from '@/stores/selectors/pasteSelectors';
import {
  selectBrushSettings,
  selectCurrentTool,
  selectEraserSettings,
  selectFillSettings,
  selectGlobalBrushSize,
  selectPolygonGradientState,
  selectPreviousTool,
  selectRecolorSampling,
  selectShapeMode,
} from '@/stores/selectors/toolsSelectors';
import { useBrushEngineSimplified, refreshLayerCCSurface } from '@/hooks/useBrushEngineSimplified';
import { useCanvasInteraction } from '@/hooks/useCanvasInteraction';
import { useCanvasStateMachine } from '@/hooks/useCanvasStateMachine';
import { useSimplePan, type PanSnapshot, type PanEvent } from '@/hooks/useSimplePan';
import { useToolStateMachine } from '@/hooks/useToolStateMachine';
import { useComprehensiveKeyboard } from '@/hooks/useComprehensiveKeyboard';
import { useDrawingHandlers } from '@/hooks/useDrawingHandlers';
import { useCanvasEventHandlers } from '@/hooks/canvas/useCanvasEventHandlers';
import { useCropState } from '@/hooks/useCropState';
import { BrushShape } from '@/types';
import type { Layer, Tool } from '@/types';
import type { FloatingPaste as FloatingPasteState } from '@/hooks/canvas/utils/types';
import BrushCursor, { type BrushCursorHandle } from './BrushCursor';
import CropOverlay from './CropOverlay';
import FloatingPasteOverlay from './FloatingPasteOverlay';
import SelectionMarqueeHandles from './SelectionMarqueeHandles';
import { SimplifiedColorCycleManager } from './SimplifiedColorCycleManager';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import { getPresetStops } from '@/utils/gradientPresets';
import { detectColorCycleWorkerSupport } from '@/utils/colorCycleWorkerSupport';
import { getMaskManager } from '@/layers/MaskManager';
import { getColorCycleBrushManager, type ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { renderFill } from '@/shapeFill/renderers/cpuRenderer';
import { computeShapeFillColors } from '@/shapeFill/colorUtils';
import { toPixelPerfectFill } from '@/shapeFill/pixelPerfect';
import { registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';
import { useToolSwitcher } from '@/utils/toolSwitch';
import { FillStage } from '@/shapeFill/types';
import { snapPointToPixel } from '@/utils/pixelSharp';
import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from '@/constants/canvas';
import { viewPerformanceTracker } from '@/utils/viewPerformanceTracker';
import { useStoreSelectorRef } from '@/hooks/useStoreSelectorRef';
import { getColorCycleCompositorClient } from '@/workers/colorCycleCompositorClient';

type GradientStop = { position: number; color: string };

const hexToRgb = (hex: string): { r: number; g: number; b: number } => {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!m) {
    return { r: 0, g: 0, b: 0 };
  }
  return {
    r: parseInt(m[1], 16),
    g: parseInt(m[2], 16),
    b: parseInt(m[3], 16),
  };
};

const rgbToHex = (r: number, g: number, b: number): string => {
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
};

interface VisibleWorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

const computeVisibleWorldRect = (
  offsetX: number,
  offsetY: number,
  scale: number,
  viewportWidth: number,
  viewportHeight: number,
  projectWidth: number,
  projectHeight: number
): VisibleWorldRect | null => {
  if (scale <= 0 || projectWidth <= 0 || projectHeight <= 0) {
    return null;
  }

  const invScale = 1 / scale;
  const startX = Math.max(0, -offsetX * invScale);
  const startY = Math.max(0, -offsetY * invScale);
  const endX = Math.min(projectWidth, startX + viewportWidth * invScale);
  const endY = Math.min(projectHeight, startY + viewportHeight * invScale);

  const width = Math.max(0, endX - startX);
  const height = Math.max(0, endY - startY);

  if (width <= 0 || height <= 0) {
    return null;
  }

  return {
    x: startX,
    y: startY,
    width,
    height
  };
};

const CANVAS_CHECKER_LIGHT = '#2a2a2e';
const CANVAS_CHECKER_DARK = '#1c1c1f';

const isColorCyclePlaybackActive = () =>
  selectEffectiveColorCyclePlaying(useAppStore.getState());

const interpolateStopColorAt = (position: number, stops: GradientStop[]): string => {
  if (stops.length === 0) {
    return '#ffffff';
  }
  if (stops.length === 1) {
    return stops[0].color;
  }

  let before = stops[0];
  let after = stops[stops.length - 1];

  for (let i = 0; i < stops.length - 1; i += 1) {
    const current = stops[i];
    const next = stops[i + 1];
    if (position >= current.position && position <= next.position) {
      before = current;
      after = next;
      break;
    }
  }

  const range = after.position - before.position;
  const t = range > 0 ? (position - before.position) / range : 0;
  const startRgb = hexToRgb(before.color);
  const endRgb = hexToRgb(after.color);

  const lerp = (start: number, end: number) => Math.round(start + (end - start) * t);

  return rgbToHex(lerp(startRgb.r, endRgb.r), lerp(startRgb.g, endRgb.g), lerp(startRgb.b, endRgb.b));
};

const resampleStopsToColors = (stops: GradientStop[], count: number): string[] => {
  const targetCount = Math.max(2, count | 0);
  const colors: string[] = [];
  for (let index = 0; index < targetCount; index += 1) {
    const position = targetCount === 1 ? 0 : index / (targetCount - 1);
    colors.push(interpolateStopColorAt(position, stops));
  }
  return colors;
};

interface DrawingCanvasProps {
  showFeedback?: (message: string) => void;
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ showFeedback }) => {
  const canvasRef = useRef<HTMLCanvasElement>(null); 
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isBusyRef = useRef(false); // Lock to prevent concurrent operations
  const isMouseDownRef = useRef(false); // Track mouse button state
  const drawAnimationFrameRef = useRef<number | null>(null); // RAF throttling for pan
  const pointerMoveThrottled = useRef<number>(0); // Throttle pointer move to 120fps
  const colorCycleBrushManagerRef = useRef<ColorCycleBrushManager | null>(null);
  const compositeSegmentsRef = useRef<CompositeSegment[]>([]);
  const layerMapRef = useRef<Map<string, Layer>>(new Map());
  const pendingColorCycleRefreshRef = useRef(false);

  // Get essential store state using focused selectors to avoid unnecessary re-renders
  const project = useAppStore((state) => state.project);
  const layers = useAppStore(selectLayers);
  const referenceLayerId = useAppStore(selectReferenceLayerId);
  const activeLayerId = useAppStore(selectActiveLayerId);
  const selectionStart = useAppStore((state) => state.selectionStart);
  const selectionEnd = useAppStore((state) => state.selectionEnd);
  const selectionClipboardRef = useStoreSelectorRef((state) => state.selectionClipboard);
  const floatingPasteRef = useStoreSelectorRef((state) => state.floatingPaste);
  const floatingPaste = useAppStore(selectFloatingPaste);
  const layersNeedRecomposition = useAppStore(selectLayersNeedRecomposition);
  const canvasZoom = useAppStore((state) => state.canvas.zoom);
  const canvasOffsetX = useAppStore((state) => state.canvas.offsetX);
  const canvasOffsetY = useAppStore((state) => state.canvas.offsetY);
  const compositeBitmap = useAppStore((state) => state.currentCompositeBitmap);
  const compositeLayersToCanvas = useAppStore((state) => state.compositeLayersToCanvas);
  const compositeSegmentsVersion = useAppStore((state) => state.compositeSegmentsVersion);
  const getCompositeSegmentsSnapshot = useAppStore((state) => state.getCompositeSegmentsSnapshot);
  const maskManager = useMemo(() => getMaskManager(), []);
  const currentTool = useAppStore(selectCurrentTool);
  const brushSettings = useAppStore(selectBrushSettings);
  const fillSettings = useAppStore(selectFillSettings);
  const eraserSettings = useAppStore(selectEraserSettings);
  const shapeMode = useAppStore(selectShapeMode);
  const customBrushCapture = useAppStore((state) => state.tools.customBrushCapture);
  const previousTool = useAppStore(selectPreviousTool);
  const colorAdjustActive = useAppStore((state) => state.colorAdjust.active);
  const globalBrushSize = useAppStore(selectGlobalBrushSize);
  const palette = useAppStore((state) => state.palette);
  const polygonGradientState = useAppStore(selectPolygonGradientState);
  const recolorSampling = useAppStore(selectRecolorSampling);
  const currentBrushPresetId = useAppStore((state) => state.currentBrushPreset?.id ?? null);
  const setActiveColor = useAppStore((state) => state.setActiveColor);
  const setBrushSettings = useAppStore((state) => state.setBrushSettings);
  const updateRecolorSampling = useAppStore((state) => state.updateRecolorSampling);
  const stopRecolorSampling = useAppStore((state) => state.stopRecolorSampling);
  const setRectangleBrushState = useAppStore((state) => state.setRectangleBrushState);
  const tools = useMemo(
    () => ({
      currentTool,
      brushSettings,
      fillSettings,
      eraserSettings,
      shapeMode,
      customBrushCapture
    }),
    [brushSettings, currentTool, customBrushCapture, eraserSettings, fillSettings, shapeMode]
  );
  const { crop, commitCrop, cancelCrop } = useCropState();
  
  // Get functions separately (they don't change)
  const setLayersNeedRecomposition = useAppStore(selectSetLayersNeedRecomposition);

  const setSelectionBounds = useAppStore((state) => state.setSelectionBounds);
  const clearSelection = useAppStore((state) => state.clearSelection);
  const setFloatingPaste = useAppStore((state) => state.setFloatingPaste);
  const updateFloatingPastePosition = useAppStore((state) => state.updateFloatingPastePosition);
  const commitFloatingPaste = useAppStore((state) => state.commitFloatingPaste);
  const cancelFloatingPaste = useAppStore((state) => state.cancelFloatingPaste);
  const setCurrentOffscreenCanvas = useAppStore((state) => state.setCurrentOffscreenCanvas);
  const renderStaticComposite = useAppStore((state) => state.renderStaticComposite);
  const setCanvasDimensions = useAppStore((state) => state.setCanvasDimensions);
  const setZoom = useAppStore((state) => state.setZoom);
  const setCanvasOffset = useAppStore((state) => state.setCanvasOffset);
  const setCanvasViewport = useAppStore((state) => state.setCanvasViewport);
  const undo = useAppStore((state) => state.undo);
  const redo = useAppStore((state) => state.redo);
  const updateLayer = useAppStore((state) => state.updateLayer);
  const applyColorAdjust = useAppStore((state) => state.applyColorAdjust);
  const cancelColorAdjust = useAppStore((state) => state.cancelColorAdjust);
  const setCustomBrushFreehandPath = useAppStore((state) => state.setCustomBrushFreehandPath);

  const switchTool = useToolSwitcher();

  const setCurrentToolById = useCallback(
    (toolId: string) => {
      void switchTool(toolId as Tool);
    },
    [switchTool]
  );

  const setFloatingPasteFromHandlers = useCallback(
    (paste: FloatingPasteState | null) => {
      if (!paste || !paste.imageData) {
        setFloatingPaste(null);
        return;
      }

      setFloatingPaste({
        imageData: paste.imageData,
        position: paste.position,
        width: paste.width,
        height: paste.height,
        displayWidth: paste.displayWidth ?? paste.width,
        displayHeight: paste.displayHeight ?? paste.height,
        originalPosition: paste.originalPosition ?? paste.position,
        sourceLayerId: paste.sourceLayerId ?? null,
        colorCycleIndices: paste.colorCycleIndices ?? null,
      });
    },
    [setFloatingPaste]
  );

  // Mouse position for brush cursor
  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showBrushCursor, setShowBrushCursor] = useState(false);
  const [marchingAntsOffset, setMarchingAntsOffset] = useState(0);
  const brushCursorHandleRef = useRef<BrushCursorHandle | null>(null);

  const checkerPatternCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const checkerPatternCacheRef = useRef<WeakMap<CanvasRenderingContext2D, CanvasPattern | null>>(new WeakMap());
  const isZoomingRef = useRef(false);
  const zoomEndTimeoutRef = useRef<number | null>(null);
  const colorCycleWorkerEnabled = useFeatureFlag('useColorCycleWorker');
  const colorCycleWorkerSupport = useMemo(() => detectColorCycleWorkerSupport(), []);
  const shouldUseColorCycleWorker = colorCycleWorkerEnabled && colorCycleWorkerSupport.supported;

  const setCursorScreenPosition = useCallback((screenX: number, screenY: number) => {
    mousePositionRef.current = { x: screenX, y: screenY };
    brushCursorHandleRef.current?.setPosition(screenX, screenY);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }
    colorCycleBrushManagerRef.current = getColorCycleBrushManager();
  }, []);

  useEffect(() => {
    if (!shouldUseColorCycleWorker) {
      return;
    }
    let cancelled = false;
    getColorCycleCompositorClient()
      .then((client) => {
        if (cancelled) {
          return;
        }
        return client.ping();
      })
      .catch((error) => {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[ColorCycleWorker] init failed', error);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shouldUseColorCycleWorker]);

  useEffect(() => {
    const map = new Map<string, Layer>();
    layers.forEach((layer) => {
      map.set(layer.id, layer);
    });
    layerMapRef.current = map;
    pendingColorCycleRefreshRef.current = true;
  }, [layers]);

  useEffect(() => {
    compositeSegmentsRef.current = getCompositeSegmentsSnapshot();
    pendingColorCycleRefreshRef.current = true;
  }, [compositeSegmentsVersion, getCompositeSegmentsSnapshot]);

  const refreshColorCycleSegments = useCallback(() => {
    const segments = compositeSegmentsRef.current;
    if (!segments.length) {
      return;
    }
    const manager = colorCycleBrushManagerRef.current ?? getColorCycleBrushManager();
    if (!colorCycleBrushManagerRef.current) {
      colorCycleBrushManagerRef.current = manager;
    }

    segments.forEach((segment) => {
      if (segment.kind !== 'color-cycle') {
        return;
      }
      const layer = layerMapRef.current.get(segment.layerId);
      if (!layer || !layer.colorCycleData) {
        return;
      }
      const brush = manager?.getBrush(segment.layerId);
      if (!brush) {
        return;
      }
      const layerCanvas = refreshLayerCCSurface(brush, segment.layerId);
      if (!layerCanvas) {
        return;
      }
      if (layerCanvas && 'setTargetCanvas' in brush && typeof brush.setTargetCanvas === 'function') {
        brush.setTargetCanvas(layerCanvas);
      }

      const wantPlaying = Boolean(layer.colorCycleData.isAnimating && layer.colorCycleData.mode !== 'recolor');
      const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;
      if (wantPlaying && !isPlaying) {
        brush.startAnimation?.();
      } else if (!wantPlaying && isPlaying) {
        brush.stopAnimation?.();
      }

      if (layer.colorCycleData.isAnimating) {
        brush.updateAnimation?.();
      }
      brush.renderDirectToCanvas?.(layerCanvas, segment.layerId);
      const layerCanvasCtx = layerCanvas.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings);
      if (layerCanvasCtx) {
        maskManager.applyMaskToCanvas(layer.id, layerCanvasCtx);
      }
    });
  }, [maskManager]);

  useEffect(() => {
    if (pendingColorCycleRefreshRef.current) {
      pendingColorCycleRefreshRef.current = false;
      refreshColorCycleSegments();
    }
  }, [refreshColorCycleSegments, layers, compositeSegmentsVersion]);

  const isPointerInsideCanvas = useCallback(() => {
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return false;
    const { x, y } = mousePositionRef.current;
    return x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  }, []);
  
  // Determine cursor style based on tool and brush shape
  const defaultCursorStyle = useMemo(() => {
    // Fill tool uses crosshair cursor
    if (tools.currentTool === 'fill') {
      return 'crosshair';
    }
    // Crop tool uses crosshair cursor for precision marquee placement
    if (tools.currentTool === 'crop') {
      return 'crosshair';
    }
    // Recolor tool uses crosshair cursor (sampling only, no painting)
    if (tools.currentTool === 'recolor') {
      return 'crosshair';
    }
    // Selection tool and custom selection use crosshair cursor
    if (tools.currentTool === 'selection' || tools.currentTool === 'custom') {
      return 'crosshair';
    }
    // Custom brush shape uses crosshair cursor
    if (tools.brushSettings.brushShape === BrushShape.CUSTOM) {
      return 'crosshair';
    }
    // Gradient, contour, shape brushes, and spam text use crosshair cursor
    const brushShape = tools.brushSettings.brushShape;
    if (brushShape === BrushShape.RECTANGLE_GRADIENT || 
        brushShape === BrushShape.POLYGON_GRADIENT || 
        brushShape === BrushShape.CONTOUR_POLYGON ||
        brushShape === BrushShape.CONTOUR_LINES2 ||
        brushShape === BrushShape.COLOR_CYCLE_SHAPE ||
        brushShape === BrushShape.SPAM_TEXT ||
        brushShape === BrushShape.SHAPE_FILL) {
      return 'crosshair';
    }
    // Color cycle uses standard brush cursor to show size
    return 'none';
  }, [tools.currentTool, tools.brushSettings.brushShape]);
  
  const [cursorStyle, setCursorStyle] = useState(defaultCursorStyle);
  
  // Update cursor style when defaultCursorStyle changes
  useEffect(() => {
    setCursorStyle(defaultCursorStyle);
  }, [defaultCursorStyle]);
  
  // Debug cursor style
  useEffect(() => {
    // quiet
  }, [cursorStyle, tools.currentTool, tools.brushSettings.brushShape]);
  
  
  // Track floating paste dragging
  const [isDraggingFloatingPaste, setIsDraggingFloatingPaste] = useState(false);
  const floatingPasteDragStart = useRef<{ x: number; y: number } | null>(null);
  const floatingPasteOriginalPos = useRef<{ x: number; y: number } | null>(null);
  
  // Cached composite canvas
  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasDirtyRef = useRef(true); // Track if composite needs update
  const lastCompositeHashRef = useRef<string>(''); // Track last composite state
  const lastActiveLayerIdRef = useRef<string | null>(null);
  const [needsRedraw, setNeedsRedraw] = useState(0);
  const hadSelectionRef = useRef(false);

  const underCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const underCompositeHasContentRef = useRef(false);
  const overCompositeHasContentRef = useRef(false);
  const layerTransferCacheRef = useRef<Map<string, HTMLCanvasElement | OffscreenCanvas>>(new Map());

  // Cached floating paste canvas (avoid creating per frame)
  const pasteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPasteInfoRef = useRef<{ imageData: ImageData | null; width: number; height: number }>(
    { imageData: null, width: 0, height: 0 }
  );
  
  // Ref for draw function to use in resize observer
  const drawRef = useRef<((ctx: CanvasRenderingContext2D, viewTransform: { scale: number; offsetX: number; offsetY: number }) => void) | null>(null);
  
  // Get brush engine (using adapter for migration)
  const brushEngine = useBrushEngineSimplified();
  
  // Memoized layers hash - only compute when layers actually change
  const layersHash = useMemo(() => {
    return layers.map(l => {
      // Use simpler hash: id, visibility, opacity, and data length
      // Avoid expensive checksum calculation
      return `${l.id}_${l.visible}_${l.opacity}_${l.imageData?.data?.length || 0}`;
    }).join('|');
  }, [layers]);
  
  // Small cache to avoid redundant getImageData calls when pointer stays in same pixel
  const lastSampleRef = useRef<{ x: number; y: number; color: string; layerId: string | null }>({
    x: -1,
    y: -1,
    color: '#000000',
    layerId: null
  });

  type CompositeSampleOptions = {
    radius?: number;
    preferSolid?: boolean;
  };

  const sampleCompositeOpaque = useCallback(
    (x: number, y: number, options: CompositeSampleOptions = {}): string => {
      const { radius = 1, preferSolid = true } = options;
      const comp = compositeCanvasRef.current;
      if (!comp) return '#ffffff';

      const ctx = comp.getContext('2d', { willReadFrequently: true });
      if (!ctx) return '#ffffff';

      const cw = comp.width;
      const ch = comp.height;
      const cx = Math.max(0, Math.min(cw - 1, Math.floor(x)));
      const cy = Math.max(0, Math.min(ch - 1, Math.floor(y)));

      let solidAlpha = -1;
      let solidR = 255;
      let solidG = 255;
      let solidB = 255;

      let accR = 0;
      let accG = 0;
      let accB = 0;
      let samples = 0;

      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const sx = cx + dx;
          const sy = cy + dy;
          if (sx < 0 || sy < 0 || sx >= cw || sy >= ch) {
            continue;
          }

          const data = ctx.getImageData(sx, sy, 1, 1).data;
          const alpha = data[3] / 255;
          const r = data[0];
          const g = data[1];
          const b = data[2];

          if (preferSolid && alpha > solidAlpha) {
            solidAlpha = alpha;
            solidR = r;
            solidG = g;
            solidB = b;
          }

          accR += r;
          accG += g;
          accB += b;
          samples += 1;
        }
      }

      const toHex = (value: number) => Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, '0');

      if (preferSolid && solidAlpha >= 0) {
        return `#${toHex(solidR)}${toHex(solidG)}${toHex(solidB)}`;
      }

      if (samples > 0) {
        const avgR = accR / samples;
        const avgG = accG / samples;
        const avgB = accB / samples;
        return `#${toHex(avgR)}${toHex(avgG)}${toHex(avgB)}`;
      }

      return '#ffffff';
    },
    []
  );

  const sampleColorFromReferenceLayer = useCallback(
    (x: number, y: number): string | null => {
      if (!referenceLayerId) {
        return null;
      }

      const layer = layers.find((candidate) => candidate.id === referenceLayerId);
      if (!layer || !layer.framebuffer) {
        return null;
      }

      const width = layer.framebuffer.width;
      const height = layer.framebuffer.height;
      if (width <= 0 || height <= 0) {
        return null;
      }

      const clampedX = Math.max(0, Math.min(width - 1, Math.floor(x)));
      const clampedY = Math.max(0, Math.min(height - 1, Math.floor(y)));

      if (layer.imageData && layer.imageData.width === width && layer.imageData.height === height) {
        const baseIndex = (clampedY * layer.imageData.width + clampedX) * 4;
        const data = layer.imageData.data;
        const alpha = data[baseIndex + 3];
        if (alpha === 0) {
          return null;
        }
        return rgbToHex(data[baseIndex], data[baseIndex + 1], data[baseIndex + 2]);
      }

      const ctx = layer.framebuffer.getContext('2d', { willReadFrequently: true } as CanvasRenderingContext2DSettings) as
        | CanvasRenderingContext2D
        | OffscreenCanvasRenderingContext2D
        | null;
      if (!ctx) {
        return null;
      }

      const sample = ctx.getImageData(clampedX, clampedY, 1, 1).data;
      if (sample[3] === 0) {
        return null;
      }
      return rgbToHex(sample[0], sample[1], sample[2]);
    },
    [layers, referenceLayerId]
  );

  // Helper function to sample color at position (cached per pixel)
  const sampleColorAtPosition = useCallback(
    (x: number, y: number): string => {
      const comp = compositeCanvasRef.current;
      if (!comp) return '#000000';

      const clampedX = Math.max(0, Math.min(comp.width - 1, Math.floor(x)));
      const clampedY = Math.max(0, Math.min(comp.height - 1, Math.floor(y)));

      // Return cached color if sampling the same pixel as last time
      const last = lastSampleRef.current;
      const cacheLayerId = referenceLayerId ?? null;
      if (last.x === clampedX && last.y === clampedY && last.layerId === cacheLayerId) {
        return last.color;
      }

      if (referenceLayerId) {
        const referenceColor = sampleColorFromReferenceLayer(clampedX, clampedY);
        if (referenceColor) {
          lastSampleRef.current = { x: clampedX, y: clampedY, color: referenceColor, layerId: cacheLayerId };
          return referenceColor;
        }
      }

      const color = sampleCompositeOpaque(clampedX, clampedY, { radius: 1, preferSolid: true });
      lastSampleRef.current = { x: clampedX, y: clampedY, color, layerId: cacheLayerId };
      return color;
    },
    [sampleCompositeOpaque, sampleColorFromReferenceLayer, referenceLayerId]
  );
  
  // Helper function to sample colors along line
  const sampleColorsAlongLine = useCallback((startX: number, startY: number, endX: number, endY: number, numSamples: number): string[] => {
    if (numSamples <= 0) return [];
    if (numSamples === 1) return [sampleColorAtPosition(startX, startY)];
    
    const colors: string[] = [];
    for (let i = 0; i < numSamples; i++) {
      const t = i / (numSamples - 1);
      const x = startX + (endX - startX) * t;
      const y = startY + (endY - startY) * t;
      colors.push(sampleColorAtPosition(x, y));
    }
    return colors;
  }, [sampleColorAtPosition]);
  
  const renderSplitComposites = useCallback(() => {
    if (!project || project.width <= 0 || project.height <= 0) {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    if (typeof document === 'undefined') {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    if (!underCompositeCanvasRef.current) {
      underCompositeCanvasRef.current = document.createElement('canvas');
    }
    if (!overCompositeCanvasRef.current) {
      overCompositeCanvasRef.current = document.createElement('canvas');
    }

    const underCanvas = underCompositeCanvasRef.current;
    const overCanvas = overCompositeCanvasRef.current;

    if (!underCanvas || !overCanvas) {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    if (underCanvas.width !== project.width || underCanvas.height !== project.height) {
      underCanvas.width = project.width;
      underCanvas.height = project.height;
    }
    if (overCanvas.width !== project.width || overCanvas.height !== project.height) {
      overCanvas.width = project.width;
      overCanvas.height = project.height;
    }

    const underCtx = underCanvas.getContext('2d', { willReadFrequently: true });
    const overCtx = overCanvas.getContext('2d', { willReadFrequently: true });

    if (!underCtx || !overCtx) {
      underCompositeHasContentRef.current = false;
      overCompositeHasContentRef.current = false;
      return;
    }

    underCtx.clearRect(0, 0, project.width, project.height);
    overCtx.clearRect(0, 0, project.width, project.height);

    const isPixelBrush =
      tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
      (tools.brushSettings.brushShape === BrushShape.SQUARE && !tools.brushSettings.antialiasing);
    underCtx.imageSmoothingEnabled = !isPixelBrush;
    overCtx.imageSmoothingEnabled = !isPixelBrush;

    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    const activeLayer = activeLayerId ? sortedLayers.find((layer) => layer.id === activeLayerId) ?? null : null;
    const activeOrder = activeLayer ? activeLayer.order : Number.POSITIVE_INFINITY;

    let drewUnder = false;
    let drewOver = false;

    for (const layer of sortedLayers) {
      if (!layer.visible) {
        continue;
      }

      const targetCtx: CanvasRenderingContext2D = layer.order > activeOrder ? overCtx : underCtx;

      targetCtx.save();
      targetCtx.globalCompositeOperation = layer.blendMode;
      targetCtx.globalAlpha = layer.opacity;

      let drewLayer = false;

      if (
        layer.layerType === 'color-cycle' &&
        layer.colorCycleData?.canvas &&
        layer.colorCycleData.mode !== 'recolor'
      ) {
        try {
          targetCtx.drawImage(layer.colorCycleData.canvas, 0, 0);
          drewLayer = true;
        } catch {
          // ignore draw errors for transient states
        }
      } else if (
        layer.layerType === 'color-cycle' &&
        layer.colorCycleData?.mode === 'recolor' &&
        layer.colorCycleData.canvas
      ) {
        try {
          targetCtx.drawImage(layer.colorCycleData.canvas, 0, 0);
          drewLayer = true;
        } catch {
          // ignore draw errors for transient states
        }
      } else if (layer.framebuffer) {
        try {
          targetCtx.drawImage(layer.framebuffer as CanvasImageSource, 0, 0);
          drewLayer = true;
        } catch {
          // ignore draw errors for transient states
        }
      } else if (layer.imageData) {
        let transferCanvas = layerTransferCacheRef.current.get(layer.id);
        if (!transferCanvas) {
          const canvas = document.createElement('canvas');
          canvas.width = layer.imageData.width;
          canvas.height = layer.imageData.height;
          transferCanvas = canvas;
          layerTransferCacheRef.current.set(layer.id, transferCanvas);
        }
        if (
          transferCanvas.width !== layer.imageData.width ||
          transferCanvas.height !== layer.imageData.height
        ) {
          transferCanvas.width = layer.imageData.width;
          transferCanvas.height = layer.imageData.height;
        }

        const transferCtx = transferCanvas.getContext(
          '2d',
          { willReadFrequently: true } as CanvasRenderingContext2DSettings
        ) as CanvasRenderingContext2D | null;

        if (transferCtx) {
          transferCtx.clearRect(0, 0, transferCanvas.width, transferCanvas.height);
          transferCtx.putImageData(layer.imageData, 0, 0);
          try {
            targetCtx.drawImage(transferCanvas, 0, 0);
            drewLayer = true;
          } catch {
            // ignore draw errors for transient states
          }
        }
      }

      targetCtx.restore();

      if (drewLayer) {
        if (targetCtx === underCtx) {
          drewUnder = true;
        } else {
          drewOver = true;
        }
      }
    }

    underCompositeHasContentRef.current = drewUnder;
    overCompositeHasContentRef.current = drewOver;
  }, [
    project,
    layers,
    activeLayerId,
    tools.brushSettings.brushShape,
    tools.brushSettings.antialiasing
  ]);

  const ensureStaticCompositeCanvas = useCallback(() => {
    if (!project) {
      return null;
    }
    if (!compositeCanvasRef.current && typeof document !== 'undefined') {
      compositeCanvasRef.current = document.createElement('canvas');
    }
    if (compositeCanvasRef.current) {
      if (
        compositeCanvasRef.current.width !== project.width ||
        compositeCanvasRef.current.height !== project.height
      ) {
        compositeCanvasRef.current.width = project.width;
        compositeCanvasRef.current.height = project.height;
      }
    }
    return compositeCanvasRef.current;
  }, [project]);


  const rebuildStaticComposite = useCallback(() => {
    const canvas = ensureStaticCompositeCanvas();
    if (!canvas) {
      return false;
    }
    const rendered = renderStaticComposite(canvas);
    if (rendered) {
      setCurrentOffscreenCanvas(canvas);
    }
    return rendered;
  }, [ensureStaticCompositeCanvas, renderStaticComposite, setCurrentOffscreenCanvas]);
  
  // Drawing function - base implementation without hooks
  const drawBase = useCallback((ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, skipDrawingCanvas = false, drawingCanvasRef?: HTMLCanvasElement | null, isDrawing?: boolean, drawingCanvasHasContent?: boolean, isSelecting?: boolean, selectionStartRef?: { x: number; y: number } | null, devicePixelRatio = 1) => {
    const { scale, offsetX, offsetY } = transform;
    const dpr = devicePixelRatio;
    const canvasPixelWidth = ctx.canvas.width;
    const canvasPixelHeight = ctx.canvas.height;
    const displayWidth = canvasPixelWidth / dpr;
    const displayHeight = canvasPixelHeight / dpr;
    const visibleRect = project
      ? computeVisibleWorldRect(
          offsetX,
          offsetY,
          scale,
          displayWidth,
          displayHeight,
          project.width,
          project.height
        )
      : null;

    // Clear canvas at device resolution
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#141514';
    ctx.fillRect(0, 0, canvasPixelWidth, canvasPixelHeight);
    ctx.restore();
    
    if (project && layers.length > 0) {
      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      const checkerSize = 10;
      const checkerTileSize = checkerSize * 2;

      if (!checkerPatternCanvasRef.current) {
        const patternCanvas = document.createElement('canvas');
        patternCanvas.width = checkerTileSize;
        patternCanvas.height = checkerTileSize;
        const patternCtx = patternCanvas.getContext('2d');
        if (patternCtx) {
          patternCtx.fillStyle = CANVAS_CHECKER_LIGHT;
          patternCtx.fillRect(0, 0, checkerTileSize, checkerTileSize);
          patternCtx.fillStyle = CANVAS_CHECKER_DARK;
          patternCtx.fillRect(0, 0, checkerSize, checkerSize);
          patternCtx.fillRect(checkerSize, checkerSize, checkerSize, checkerSize);
        }
        checkerPatternCanvasRef.current = patternCanvas;
      }

      let checkerPattern: CanvasPattern | null | undefined;
      if (checkerPatternCanvasRef.current) {
        checkerPattern = checkerPatternCacheRef.current.get(ctx);
        if (!checkerPattern) {
          checkerPattern = ctx.createPattern(checkerPatternCanvasRef.current, 'repeat');
          checkerPatternCacheRef.current.set(ctx, checkerPattern);
        }
      }

      if (checkerPattern && visibleRect) {
        ctx.fillStyle = checkerPattern;
        ctx.fillRect(visibleRect.x, visibleRect.y, visibleRect.width, visibleRect.height);
      } else {
        // Fallback to original drawing if pattern creation fails
        const startX =
          Math.floor(Math.max(0, -offsetX / scale) / (checkerSize * 2)) * (checkerSize * 2);
        const startY =
          Math.floor(Math.max(0, -offsetY / scale) / (checkerSize * 2)) * (checkerSize * 2);
        const endX = Math.min(project.width, Math.ceil((displayWidth - offsetX) / scale));
        const endY = Math.min(project.height, Math.ceil((displayHeight - offsetY) / scale));

        ctx.fillStyle = CANVAS_CHECKER_LIGHT;
        ctx.fillRect(0, 0, project.width, project.height);
        ctx.fillStyle = CANVAS_CHECKER_DARK;

        for (let x = startX; x < endX; x += checkerSize * 2) {
          for (let y = startY; y < endY; y += checkerSize * 2) {
            const w1 = Math.min(checkerSize, project.width - x);
            const h1 = Math.min(checkerSize, project.height - y);
            const w2 = Math.min(checkerSize, project.width - (x + checkerSize));
            const h2 = Math.min(checkerSize, project.height - (y + checkerSize));

            if (w1 > 0 && h1 > 0) ctx.fillRect(x, y, w1, h1);
            if (w2 > 0 && h2 > 0) ctx.fillRect(x + checkerSize, y + checkerSize, w2, h2);
          }
        }
      }

      const activeLayer =
        activeLayerId != null ? layers.find((layer) => layer.id === activeLayerId) ?? null : null;

      const isPixelBrush = tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
        (tools.brushSettings.brushShape === BrushShape.SQUARE && !tools.brushSettings.antialiasing);
      ctx.imageSmoothingEnabled = !isPixelBrush && scale < 3;
      
      
      // Check if we're actively erasing
      const overlayCanvasElement = drawingCanvasRef ?? null;
      const hasOverlayCanvas = overlayCanvasElement !== null;
      const isActivelyErasing =
        tools.currentTool === 'eraser' && isDrawing && hasOverlayCanvas && drawingCanvasHasContent;
      const overlayActive =
        !skipDrawingCanvas && hasOverlayCanvas && (isDrawing || drawingCanvasHasContent);
      const overlayEligibleForSplit = overlayActive && !isActivelyErasing;

      if (overlayEligibleForSplit) {
        const anyAnimatingColorCycle = layers.some(
          (layer) =>
            layer.visible &&
            layer.layerType === 'color-cycle' &&
            Boolean(layer.colorCycleData?.isAnimating)
        );
        const requiresLiveRefresh =
          !underCompositeCanvasRef.current ||
          !underCompositeHasContentRef.current ||
          compositeCanvasDirtyRef.current ||
          activeLayer?.layerType === 'color-cycle' ||
          anyAnimatingColorCycle;

        if (requiresLiveRefresh) {
          renderSplitComposites();
          compositeCanvasDirtyRef.current = false;
        }
      }

      const useSplitOverlay = overlayEligibleForSplit && Boolean(underCompositeCanvasRef.current);

      if (visibleRect) {
        const { x, y, width, height } = visibleRect;
        if (width > 0 && height > 0) {
          if (useSplitOverlay && underCompositeCanvasRef.current) {
            ctx.drawImage(
              underCompositeCanvasRef.current,
              x,
              y,
              width,
              height,
              x,
              y,
              width,
              height
            );
          } else if (!isActivelyErasing) {
            const segments = compositeSegmentsRef.current;
            let compositeDrawn = false;
            if (segments.length > 0) {
              compositeDrawn = true;
              segments.forEach((segment) => {
                if (segment.kind === 'static') {
                  const source = segment.bitmap ?? segment.canvas;
                  try {
                    ctx.drawImage(
                      source,
                      x,
                      y,
                      width,
                      height,
                      x,
                      y,
                      width,
                      height
                    );
                  } catch (error) {
                    console.warn('[CompositeSegments] Failed to draw static segment', error);
                  }
                  return;
                }

                const layer = layerMapRef.current.get(segment.layerId);
                if (!layer || !layer.visible || layer.layerType !== 'color-cycle') {
                  return;
                }

                const layerCanvas = layer.colorCycleData?.canvas as HTMLCanvasElement | undefined;
                if (!layerCanvas) {
                  return;
                }

                ctx.save();
                ctx.globalAlpha = segment.opacity;
                ctx.globalCompositeOperation = segment.blendMode ?? 'source-over';
                ctx.drawImage(
                  layerCanvas,
                  x,
                  y,
                  width,
                  height,
                  x,
                  y,
                  width,
                  height
                );
                ctx.restore();
              });
            }

            if (!compositeDrawn) {
              if (compositeBitmap) {
                try {
                  ctx.drawImage(
                    compositeBitmap,
                    x,
                    y,
                    width,
                    height,
                    x,
                    y,
                    width,
                    height
                  );
                  compositeDrawn = true;
                } catch (error) {
                  const isInvalidState =
                    error instanceof DOMException && error.name === 'InvalidStateError';
                  if (isInvalidState) {
                    const state = useAppStore.getState();
                    state.setCurrentCompositeBitmap(null);
                    state.setLayersNeedRecomposition(true);
                  } else {
                    throw error;
                  }
                }
              }

              if (!compositeDrawn && compositeCanvasRef.current) {
                ctx.drawImage(
                  compositeCanvasRef.current,
                  x,
                  y,
                  width,
                  height,
                  x,
                  y,
                  width,
                  height
                );
              }
            }
          }
        }
      }

      // Draw temporary drawing canvas
      if (overlayActive && overlayCanvasElement && visibleRect) {
        // Strictly avoid overlaying CC animation frames above the stack.
        // Skip drawing the overlay when ANY brush-based Color Cycle layer is animating
        // or when the animation manager is playing.
        const anyCCAnimating = layers.some(layer => (
          layer.visible &&
          layer.layerType === 'color-cycle' &&
          layer.colorCycleData?.mode !== 'recolor' &&
          Boolean(layer.colorCycleData?.isAnimating)
        ));
        const isManagerPlaying = colorCycleManagerRef.current?.isPlaying() || false;

        const activelyDrawing = Boolean(isDrawing);
        const overlayBlockedByAnimation = anyCCAnimating || isManagerPlaying;

        if (!overlayBlockedByAnimation || activelyDrawing) {
          // For eraser, the drawing canvas contains the entire modified layer
          // For brush, it's just the new strokes to overlay
          const { x, y, width, height } = visibleRect;
          if (width > 0 && height > 0) {
            ctx.save();
            if (activeLayer) {
              ctx.globalAlpha = activeLayer.opacity;
              ctx.globalCompositeOperation = activeLayer.blendMode ?? 'source-over';
            } else {
              ctx.globalAlpha = 1;
              ctx.globalCompositeOperation = 'source-over';
            }
            ctx.drawImage(
              overlayCanvasElement,
              x,
              y,
              width,
              height,
              x,
              y,
              width,
              height
            );
            ctx.restore();
          }
        }
      }
      
      if (
        useSplitOverlay &&
        overCompositeHasContentRef.current &&
        overCompositeCanvasRef.current &&
        visibleRect
      ) {
        const { x, y, width, height } = visibleRect;
        if (width > 0 && height > 0) {
          ctx.drawImage(
            overCompositeCanvasRef.current,
            x,
            y,
            width,
            height,
            x,
            y,
            width,
            height
          );
        }
      }
      
      // Note: Color cycle animation is now rendered to the drawing canvas
      // in useDrawingHandlers, so it gets composited in the correct layer order
      ctx.restore();

      // Draw subtle border matching background to mask checker anti-alias fringe
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);
      ctx.strokeStyle = '#141514';
      ctx.lineWidth = 2 / scale;
      ctx.strokeRect(0, 0, project.width, project.height);
      ctx.restore();
      
      // Draw floating paste if active
      if (floatingPaste && floatingPaste.imageData) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        const pasteX = floatingPaste.position.x;
        const pasteY = floatingPaste.position.y;
        const renderWidth = floatingPaste.displayWidth ?? floatingPaste.width;
        const renderHeight = floatingPaste.displayHeight ?? floatingPaste.height;

        // Skip draw when the entire rectangle sits outside the project bounds
        const fullyOutside =
          pasteX + renderWidth <= 0 ||
          pasteY + renderHeight <= 0 ||
          pasteX >= project.width ||
          pasteY >= project.height;

        if (!fullyOutside) {
          // Ensure we have a reusable paste canvas
          if (!pasteCanvasRef.current) {
            pasteCanvasRef.current = document.createElement('canvas');
          }
          const pasteCanvas = pasteCanvasRef.current;

          // Resize only when dimensions change
          let needsUpdate = false;
          if (pasteCanvas.width !== floatingPaste.width || pasteCanvas.height !== floatingPaste.height) {
            pasteCanvas.width = floatingPaste.width;
            pasteCanvas.height = floatingPaste.height;
            needsUpdate = true;
          }

          // Update image data only when it changes or canvas resized
          if (lastPasteInfoRef.current.imageData !== floatingPaste.imageData || needsUpdate) {
            const pasteCtx = pasteCanvas.getContext('2d', { willReadFrequently: true });
            if (pasteCtx) {
              pasteCtx.putImageData(floatingPaste.imageData, 0, 0);
              lastPasteInfoRef.current = {
                imageData: floatingPaste.imageData,
                width: pasteCanvas.width,
                height: pasteCanvas.height,
              };
            }
          }

          // Draw the floating paste clipped to the project bounds
          ctx.save();
          ctx.beginPath();
          ctx.rect(0, 0, project.width, project.height);
          ctx.clip();

          ctx.drawImage(
            pasteCanvas,
            floatingPaste.position.x,
            floatingPaste.position.y,
            renderWidth,
            renderHeight
          );

          // Draw marching ants selection border around the paste (clipped to canvas bounds)
          const x = floatingPaste.position.x;
          const y = floatingPaste.position.y;
          const width = renderWidth;
          const height = renderHeight;

          // White background line
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2 / scale;
          ctx.setLineDash([]);
          ctx.strokeRect(x, y, width, height);

          // Black dashed line for marching ants
          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1 / scale;
          const dashLength = 5 / scale;
          ctx.setLineDash([dashLength, dashLength]);
          ctx.lineDashOffset = -marchingAntsOffset / scale;
          ctx.strokeRect(x, y, width, height);

          ctx.restore();
        }

        ctx.restore();
      }

      // Draw selection
      if ((selectionStart && selectionEnd) || (isSelecting && selectionStartRef)) {
        ctx.save();
        ctx.translate(offsetX, offsetY);
        ctx.scale(scale, scale);

        const start = selectionStart || selectionStartRef;
        const end = selectionEnd || { x: 0, y: 0 };

        if (start) {
          const x = Math.min(start.x, end.x);
          const y = Math.min(start.y, end.y);
          const width = Math.abs(end.x - start.x);
          const height = Math.abs(end.y - start.y);

          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 1 / scale;
          ctx.setLineDash([]);
          ctx.strokeRect(x, y, width, height);

          ctx.strokeStyle = '#000000';
          ctx.lineWidth = 1 / scale;
          const selectionDash = 5 / scale;
          ctx.setLineDash([selectionDash, selectionDash]);
          ctx.lineDashOffset = -marchingAntsOffset / scale;
          ctx.strokeRect(x, y, width, height);
        }

        ctx.restore();
      }

      ctx.restore();
    }
  }, [
    project,
    layers,
    tools.brushSettings.brushShape,
    tools.brushSettings.antialiasing,
    tools.currentTool,
    selectionStart,
    selectionEnd,
    marchingAntsOffset,
    floatingPaste,
    compositeBitmap,
    activeLayerId,
    renderSplitComposites
  ]);
  
  // Use custom hooks
  const interaction = useCanvasInteraction();
  const interactionDispatch = interaction.dispatch;
  const stateMachine = useCanvasStateMachine();
  const setCanvasStateMachineTool = stateMachine.setTool;
  const forceCanvasIdle = stateMachine.forceIdle;
  const pan = useSimplePan({ scale: canvasZoom || 1 });
  const setPan = pan.setPan;
  const getPanState = pan.getState;
  const subscribeToPan = pan.subscribe;
  const lastCommittedPanRef = useRef<{ x: number; y: number }>({ x: canvasOffsetX, y: canvasOffsetY });
  const pendingPanCommitRef = useRef<number | null>(null);
  const pendingPanStateRef = useRef<PanSnapshot | null>(null);

  const commitPanToStore = useCallback(
    (state: PanSnapshot) => {
      setCanvasOffset(state.offsetX, state.offsetY);
      lastCommittedPanRef.current = { x: state.offsetX, y: state.offsetY };
    },
    [setCanvasOffset]
  );

  useEffect(() => {
    const current = getPanState();
    if (current.isPanning) {
      return;
    }
    if (current.offsetX === canvasOffsetX && current.offsetY === canvasOffsetY) {
      return;
    }
    setPan(canvasOffsetX, canvasOffsetY, { silent: true });
    viewTransformRef.current.offsetX = canvasOffsetX;
    viewTransformRef.current.offsetY = canvasOffsetY;
  }, [canvasOffsetX, canvasOffsetY, getPanState, setPan]);

  useEffect(() => {
    lastCommittedPanRef.current = { x: canvasOffsetX, y: canvasOffsetY };
  }, [canvasOffsetX, canvasOffsetY]);

  useEffect(() => {
    const handlePanEvent = (state: PanSnapshot, event: PanEvent) => {
      viewTransformRef.current.offsetX = state.offsetX;
      viewTransformRef.current.offsetY = state.offsetY;

      if (event === 'start') {
        viewPerformanceTracker.startSession('pan');
      }

      if (event === 'change' || event === 'set') {
        pendingPanStateRef.current = state;
        if (pendingPanCommitRef.current != null) {
          return;
        }
        pendingPanCommitRef.current = requestAnimationFrame(() => {
          pendingPanCommitRef.current = null;
          if (pendingPanStateRef.current) {
            commitPanToStore(pendingPanStateRef.current);
          }
        });
        return;
      }

      if (event === 'end' || event === 'reset') {
        if (pendingPanCommitRef.current != null) {
          cancelAnimationFrame(pendingPanCommitRef.current);
          pendingPanCommitRef.current = null;
        }
        pendingPanStateRef.current = null;

        if (
          lastCommittedPanRef.current.x !== state.offsetX ||
          lastCommittedPanRef.current.y !== state.offsetY
        ) {
          commitPanToStore(state);
        }

        viewPerformanceTracker.endSession('pan');
      }
    };

    const unsubscribe = subscribeToPan(handlePanEvent);

    return () => {
      if (pendingPanCommitRef.current != null) {
        cancelAnimationFrame(pendingPanCommitRef.current);
        pendingPanCommitRef.current = null;
      }
      pendingPanStateRef.current = null;
      viewPerformanceTracker.endSession('pan');
      unsubscribe();
    };
  }, [commitPanToStore, subscribeToPan]);
  
  // Simplified cursor state ref for space key
  const isSpacePressedRef = useRef(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  
  // Refs for instant panning without re-renders
  const panRef = useRef(pan);
  panRef.current = pan;
  const setCursorStyleRef = useRef(setCursorStyle);
  setCursorStyleRef.current = setCursorStyle;
  const setShowBrushCursorRef = useRef(setShowBrushCursor);
  setShowBrushCursorRef.current = setShowBrushCursor;
  const previousToolRef = useRef<Tool | null>(tools.currentTool);
  const lastStateMachineToolRef = useRef<Tool | null>(tools.currentTool);
  
  // View transform ref for zoom
  const viewTransformRef = useRef({
    scale: canvasZoom || 1,
    offsetX: canvasOffsetX,
    offsetY: canvasOffsetY
  });
  
  useEffect(() => {
    viewTransformRef.current.scale = canvasZoom || 1;
  }, [canvasZoom]);

  // Removed old state machine panning logic - now handled directly in mouse events
  
  
  const toolStateMachine = useToolStateMachine({
    sampleColorAtPosition
  });
  const resetRectangleGradient = toolStateMachine.resetRectangleGradient;
  const resetPolygonGradient = toolStateMachine.resetPolygonGradient;
  const drawingHandlers = useDrawingHandlers({
    project,
    screenToWorld: pan.screenToWorld,
    viewTransformRef,
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    isBusyRef, // Pass the lock ref
  });
  const clearDrawingCanvas = drawingHandlers.clearDrawingCanvas;
  const shapePointsRef = drawingHandlers.shapePointsRef;
  const isDrawingShapeRef = drawingHandlers.isDrawingShapeRef;
  const isSelectingDirectionRef = drawingHandlers.isSelectingDirectionRef;
  
  // Refs for event handlers (moved up from line 1228)
  const drawingAnimationFrameRef = useRef<number | null>(null);
  const previewAnimationFrameRef = useRef<number | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const devicePixelRatioRef = useRef(typeof window === 'undefined' ? 1 : window.devicePixelRatio || 1);
  // Run initial centering once after sizing
  const hasCenteredRef = useRef(false);

  type CancelOptions = {
    includeFloatingPaste?: boolean;
    dispatchInteractionEnd?: boolean;
  };

  const cancelActiveOperations = useCallback(
    ({ includeFloatingPaste = false, dispatchInteractionEnd = true }: CancelOptions = {}) => {
      const store = useAppStore.getState();
      let didCancel = false;

      if (store.polygonGradientState.drawingState !== 'idle') {
        resetPolygonGradient();
        didCancel = true;
      }

      if (store.rectangleBrushState.drawingState !== 'idle') {
        resetRectangleGradient();
        didCancel = true;
      }

      const hasShapeDrawing =
        store.shapeState.isDrawing ||
        store.shapeState.points.length > 0 ||
        isDrawingShapeRef.current ||
        shapePointsRef.current.length > 0 ||
        isSelectingDirectionRef.current;

      if (hasShapeDrawing) {
        store.setShapeDrawing(false);
        store.clearShapePoints();
        shapePointsRef.current = [];
        isDrawingShapeRef.current = false;
        isSelectingDirectionRef.current = false;
        didCancel = true;
      }

      if (store.shapeFill.session) {
        store.cancelShapeFillSession();
        didCancel = true;
      }

      if (includeFloatingPaste && store.floatingPaste) {
        store.cancelFloatingPaste();
        didCancel = true;
      }

      if (didCancel) {
        const overlayCanvas = overlayCanvasRef.current;
        if (overlayCanvas) {
          overlayCanvas.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
        }
        clearDrawingCanvas();
        if (dispatchInteractionEnd) {
          interactionDispatch({ type: 'DRAWING_END' });
        }
        setNeedsRedraw(prev => prev + 1);
      }

      return didCancel;
    },
    [
      clearDrawingCanvas,
      interactionDispatch,
      isDrawingShapeRef,
      isSelectingDirectionRef,
      overlayCanvasRef,
      resetPolygonGradient,
      resetRectangleGradient,
      setNeedsRedraw,
      shapePointsRef
    ]
  );

  const finalizeRectangleGradientFromState = useCallback(async (): Promise<boolean> => {
    const store = useAppStore.getState();
    const rectState = store.rectangleBrushState;

    if (rectState.drawingState === 'idle') {
      return false;
    }

    const startPos = rectState.startPos;
    const endPos = rectState.endPos;
    const dx = endPos.x - startPos.x;
    const dy = endPos.y - startPos.y;
    const length = Math.hypot(dx, dy);

    if (length <= 0 || !brushEngine) {
      toolStateMachine.resetRectangleGradient();
      interactionDispatch({ type: 'DRAWING_END' });
      return false;
    }

    const lineVecX = dx / length;
    const lineVecY = dy / length;

    const cursor = store.canvas?.cursor ?? rectState.currentPos ?? endPos;
    const toCursorX = cursor.x - startPos.x;
    const toCursorY = cursor.y - startPos.y;
    const cursorWidth = Math.abs(-lineVecY * toCursorX + lineVecX * toCursorY) * 2;

    const baseWidth = Number.isFinite(rectState.width) && rectState.width > 0 ? rectState.width : cursorWidth;
    const width = Math.max(baseWidth, 1);

    drawingHandlers.initDrawingCanvas();
    const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });

    if (!drawCtx) {
      toolStateMachine.resetRectangleGradient();
      interactionDispatch({ type: 'DRAWING_END' });
      return false;
    }

    const numColors = Math.max(2, Math.min(64, tools.brushSettings.colors || 2));
    const presetId = tools.brushSettings.rectGradientPresetId || 'none';

    let colorsForGradient: string[] = [];

    if (presetId !== 'none') {
      const stops = getPresetStops(presetId) ?? [];
      colorsForGradient = resampleStopsToColors(stops, numColors);
    } else {
      colorsForGradient = sampleColorsAlongLine(
        startPos.x,
        startPos.y,
        endPos.x,
        endPos.y,
        numColors
      );
    }

    const gradientColors = colorsForGradient.length > 0 ? colorsForGradient : [tools.brushSettings.color];

    brushEngine.drawRectangleGradient(
      drawCtx,
      startPos.x,
      startPos.y,
      endPos.x,
      endPos.y,
      width,
      gradientColors,
      false
    );

    drawingHandlers.drawingCanvasHasContent.current = true;
    compositeCanvasDirtyRef.current = true;

    await drawingHandlers.finalizeDrawing(false);
    stateMachine.finalizationComplete();

    if (rebuildStaticComposite()) {
      compositeCanvasDirtyRef.current = false;
    }

    setNeedsRedraw(prev => prev + 1);

    const overlayCanvas = overlayCanvasRef.current;
    overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

    toolStateMachine.resetRectangleGradient();
    interactionDispatch({ type: 'DRAWING_END' });

    return true;
  }, [
    brushEngine,
    compositeCanvasDirtyRef,
    rebuildStaticComposite,
    drawingHandlers,
    interactionDispatch,
    sampleColorsAlongLine,
    setNeedsRedraw,
    stateMachine,
    toolStateMachine,
    tools.brushSettings,
    overlayCanvasRef
  ]);

  const finalizeActiveShape = useCallback(async (): Promise<boolean> => {
    const store = useAppStore.getState();

    if (store.rectangleBrushState.drawingState !== 'idle') {
      return finalizeRectangleGradientFromState();
    }

    if (store.shapeFill.session) {
      if (store.shapeFill.session.stage === FillStage.AdjustingParam) {
        store.commitShapeFillParameter();
      }

      const payload = useAppStore.getState().finalizeShapeFillSession();
      if (payload) {
          if (!drawingHandlers.drawingCanvasRef.current) {
            drawingHandlers.initDrawingCanvas();
          }

          const canvas = drawingHandlers.drawingCanvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) {
            const storeSnapshot = useAppStore.getState();
            const colors = computeShapeFillColors({
              points: payload.shape.points,
              palette: storeSnapshot.palette,
              brushColor: storeSnapshot.tools.brushSettings.color,
              sampleUnderShape: storeSnapshot.shapeFill.sampleUnderShape,
              useBackgroundColor: storeSnapshot.shapeFill.useBackgroundColor,
              sampleColorAtPosition,
              fallbackBackground: storeSnapshot.project?.backgroundColor,
            });
            const pixelPerfect = storeSnapshot.shapeFill.pixelPerfectMode;

            const primaryColor =
              colors.primary === 'background' && colors.background
                ? colors.background
                : colors.foreground;
            const secondaryColor =
              colors.primary === 'background' ? colors.foreground : colors.background;

            payload.params = {
              ...payload.params,
              fillColor: primaryColor,
            };
            if (secondaryColor) {
              payload.params.backgroundColor = secondaryColor;
            } else if ('backgroundColor' in payload.params) {
              delete (payload.params as { backgroundColor?: string }).backgroundColor;
            }

            ctx.save();
            ctx.clearRect(0, 0, canvas.width, canvas.height);
            const renderPolygon = pixelPerfect
              ? payload.shape.points.map(point => snapPointToPixel(point, { strategy: 'nearest' }))
              : payload.shape.points;
            const renderResult = pixelPerfect ? toPixelPerfectFill(payload.result) : payload.result;
            ctx.lineWidth = pixelPerfect ? 1 : payload.params.thickness ?? 1;
            if (secondaryColor && renderPolygon.length >= 3) {
              ctx.fillStyle = secondaryColor;
              ctx.beginPath();
              ctx.moveTo(renderPolygon[0].x, renderPolygon[0].y);
              for (let i = 1; i < renderPolygon.length; i += 1) {
                const pt = renderPolygon[i];
                ctx.lineTo(pt.x, pt.y);
              }
              ctx.closePath();
              ctx.fill();
            }
            ctx.strokeStyle = primaryColor;
            ctx.fillStyle = primaryColor;
            renderFill(ctx, renderResult);
            ctx.restore();
            payload.result = renderResult;

            drawingHandlers.drawingCanvasHasContent.current = true;
            await drawingHandlers.finalizeDrawing(false);
            stateMachine.finalizationComplete();

            const overlayCanvas = overlayCanvasRef.current;
            overlayCanvas?.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);

            useAppStore.getState().cancelShapeFillSession();

            if (rebuildStaticComposite()) {
              compositeCanvasDirtyRef.current = false;
            }

            setNeedsRedraw(prev => prev + 1);
            interactionDispatch({ type: 'DRAWING_END' });
            return true;
          }
        }
      return true;
    }

    if (tools.shapeMode && drawingHandlers.isDrawingShapeRef.current) {
      await drawingHandlers.finalizeShapeDrawing();
      stateMachine.finalizationComplete();

      if (rebuildStaticComposite()) {
        compositeCanvasDirtyRef.current = false;
      }

      setNeedsRedraw(prev => prev + 1);
      interactionDispatch({ type: 'DRAWING_END' });
      return true;
    }

    return false;
  }, [
    compositeCanvasDirtyRef,
    rebuildStaticComposite,
    drawingHandlers,
    finalizeRectangleGradientFromState,
    interactionDispatch,
    sampleColorAtPosition,
    setNeedsRedraw,
    stateMachine,
    tools.shapeMode
  ]);

  useEffect(() => {
    const key = 'drawing-canvas:finalize-shapes';
    registerToolFlush(key, async () => {
      await finalizeActiveShape();
    });
    return () => unregisterToolFlush(key);
  }, [finalizeActiveShape]);
  
  // Extract the color cycle animation functions for use by BrushControls
  const { startContinuousColorCycleAnimation, stopContinuousColorCycleAnimation, setFeedbackCallback } = drawingHandlers;
  const setColorCycleRuntimeHandlers = useAppStore((state) => state.setColorCycleRuntimeHandlers);

  const startAnimationRef = useRef(startContinuousColorCycleAnimation);
  const stopAnimationRef = useRef(stopContinuousColorCycleAnimation);

  useEffect(() => {
    startAnimationRef.current = startContinuousColorCycleAnimation;
  }, [startContinuousColorCycleAnimation]);

  useEffect(() => {
    stopAnimationRef.current = stopContinuousColorCycleAnimation;
  }, [stopContinuousColorCycleAnimation]);
  
  // Connect feedback callback
  useEffect(() => {
    if (showFeedback && setFeedbackCallback) {
      setFeedbackCallback(showFeedback);
    }
  }, [showFeedback, setFeedbackCallback]);
  
  const updateColorCycleGradientRef = useRef(brushEngine.updateColorCycleGradient);
  const setColorCycleFlowModeRef = useRef(brushEngine.setColorCycleFlowMode);

  useEffect(() => {
    updateColorCycleGradientRef.current = brushEngine.updateColorCycleGradient;
  }, [brushEngine.updateColorCycleGradient]);

  useEffect(() => {
    setColorCycleFlowModeRef.current = brushEngine.setColorCycleFlowMode;
  }, [brushEngine.setColorCycleFlowMode]);

  // Simplified color cycle animation manager
  const colorCycleManagerRef = useRef<SimplifiedColorCycleManager | null>(null);
  // Guard to avoid repeatedly stopping animations when already stopped
  const hasStoppedAnimationRef = useRef(false);
  // Track when we paused CC animation specifically for panning so it can resume automatically
  const pausedAnimationForPanRef = useRef(false);
  const managerRunningRef = useRef(false);

  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateViewport = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      setCanvasViewport({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height
      });
    };

    updateViewport();

    const wrapper = wrapperRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (wrapper && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateViewport();
      });
      resizeObserver.observe(wrapper);
    }

    window.addEventListener('resize', updateViewport);
    window.addEventListener('scroll', updateViewport, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('scroll', updateViewport, true);
    };
  }, [setCanvasViewport]);

  // Initialize color cycle manager
  useEffect(() => {
    colorCycleManagerRef.current = new SimplifiedColorCycleManager({
      targetFPS: 24,
      onFrame: () => {
        // Trigger a redraw on each animation frame
        setNeedsRedraw(prev => prev + 1);
      }
    });
    
    return () => {
      colorCycleManagerRef.current?.destroy();
      colorCycleManagerRef.current = null;
    };
  }, []);
  
  // Simplified animation control functions
  const wrappedStartAnimation = useCallback((reason?: string) => {
    const effectiveReason = reason ?? 'drawing-canvas-wrapper';
    if (managerRunningRef.current && effectiveReason === 'drawing-canvas-wrapper') {
      return;
    }
    managerRunningRef.current = true;
    // Start the color cycle animation in drawing handlers
    startAnimationRef.current?.(effectiveReason);

    // Start the animation manager
    colorCycleManagerRef.current?.start();
  }, []);

  const wrappedStopAnimation = useCallback((reason?: string) => {
    const effectiveReason = reason ?? 'drawing-canvas-wrapper';
    if (!managerRunningRef.current && effectiveReason === 'drawing-canvas-wrapper') {
      return;
    }

    // Stop the animation manager
    colorCycleManagerRef.current?.stop();

    // Stop the color cycle animation
    stopAnimationRef.current?.(effectiveReason);
    managerRunningRef.current = false;

    // Do one final redraw to ensure clean state
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (ctx && drawRef.current) {
      drawRef.current(ctx, viewTransformRef.current);
    }
  }, []);

  const pauseAnimationForPan = useCallback(() => {
    if (pausedAnimationForPanRef.current) return;
    if (!stopAnimationRef.current) return;
    stopAnimationRef.current('pan-start');
    pausedAnimationForPanRef.current = true;
  }, []);

  const resumeAnimationAfterPan = useCallback(async () => {
    if (!pausedAnimationForPanRef.current) return;
    try {
      await drawingHandlers.resumeColorCycleAfterInteraction?.();
    } catch (error) {
      console.warn('Failed to resume color cycle animation after pan', error);
    } finally {
      pausedAnimationForPanRef.current = false;
    }
  }, [drawingHandlers]);

  // Set up the animation handlers for BrushControls
  useEffect(() => {
    setColorCycleRuntimeHandlers({
      start: wrappedStartAnimation,
      stop: wrappedStopAnimation,
      updateGradient: (stops: Array<{ position: number; color: string }>) =>
        updateColorCycleGradientRef.current?.(stops),
      setFlowMode: (mode: 'forward' | 'reverse' | 'pingpong') =>
        setColorCycleFlowModeRef.current?.(mode),
      setFlowDirection: (direction: 'forward' | 'backward') =>
        setColorCycleFlowModeRef.current?.(direction === 'backward' ? 'reverse' : 'forward'),
    });

    return () => {
      setColorCycleRuntimeHandlers(null);
    };
  }, [setColorCycleRuntimeHandlers, wrappedStartAnimation, wrappedStopAnimation]);

  // Stop all color-cycle playback when switching to a non-CC layer
  useEffect(() => {
    const activeLayer = layers.find(l => l.id === activeLayerId);
    const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
    if (isColorCycleLayer) {
      // Reset guard so a future switch away from CC can stop again
      hasStoppedAnimationRef.current = false;
      return;
    }

    // If we've already stopped while on non-CC, avoid redundant work
    if (hasStoppedAnimationRef.current) return;

    try {
      // Pause recolor animations (global controller)
      const rm = RecolorManager.getInstance();
      if (rm.isAnimating()) rm.pause();
    } catch {}

    try {
      // Stop brush-based continuous animation loop and redraw
      wrappedStopAnimation();
    } catch {}

    try {
      // Clear isAnimating flags on all brush-based CC layers so render loop doesn't advance them
      const st = useAppStore.getState();
      st.layers
        .filter(l => l.layerType === 'color-cycle' && l.colorCycleData?.mode !== 'recolor' && l.colorCycleData?.isAnimating)
        .forEach(l => {
          const colorCycleData: Layer['colorCycleData'] = {
            ...(l.colorCycleData ?? {}),
            isAnimating: false
          };
          st.updateLayer(l.id, { colorCycleData });
        });
    } catch {}
    // Mark as stopped so this effect doesn't run repeatedly from its own updates
    hasStoppedAnimationRef.current = true;
  }, [activeLayerId, layers, wrappedStopAnimation]);
  
  // Wrapper draw function that uses current hook values
  const draw = useCallback((ctx: CanvasRenderingContext2D, transform: { scale: number; offsetX: number; offsetY: number }, skipDrawingCanvas = false) => {
    const shouldMeasure = process.env.NODE_ENV !== 'production';
    const frameStart = shouldMeasure ? performance.now() : 0;
    const dpr = devicePixelRatioRef.current || 1;
    ctx.save();
    drawBase(
      ctx,
      transform,
      skipDrawingCanvas,
      drawingHandlers.drawingCanvasRef.current,
      interaction.state.isDrawing,
      drawingHandlers.drawingCanvasHasContent.current,
      interaction.state.isSelecting,
      interaction.refs.selectionStart.current,
      dpr
    );
    ctx.restore();
    if (shouldMeasure) {
      const duration = performance.now() - frameStart;
      const isPanActive = pan.getState().isPanning;
      if (isPanActive) {
        viewPerformanceTracker.record('pan', duration);
      } else if (isZoomingRef.current) {
        viewPerformanceTracker.record('zoom', duration);
      } else {
        viewPerformanceTracker.record('draw', duration);
      }
    }
  }, [drawBase, drawingHandlers, interaction, pan]);
  
  // Update drawRef when draw changes and trigger initial draw
  useEffect(() => {
    drawRef.current = draw;
    
    // Trigger initial draw when draw function is ready
    const canvas = canvasRef.current;
    if (canvas) {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (ctx && viewTransformRef.current) {
        draw(ctx, viewTransformRef.current);
      }
    }
  }, [draw]);

  // If any code path flags recomposition, immediately invalidate composites and redraw
  useEffect(() => {
    if (!layersNeedRecomposition) return;

    compositeCanvasDirtyRef.current = true;
    const rebuilt = rebuildStaticComposite();
    if (rebuilt) {
      renderSplitComposites();
      compositeCanvasDirtyRef.current = false;
      lastCompositeHashRef.current = layersHash;
      lastActiveLayerIdRef.current = activeLayerId ?? null;
      lastSampleRef.current = { x: -1, y: -1, color: 'rgb(0, 0, 0)', layerId: null };
      setLayersNeedRecomposition(false);
    }

    setNeedsRedraw((prev) => prev + 1);

    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    const drawFunc = drawRef.current;
    if (ctx && drawFunc && viewTransformRef.current) {
      drawFunc(ctx, viewTransformRef.current);
    }
  }, [
    layersNeedRecomposition,
    rebuildStaticComposite,
    renderSplitComposites,
    layersHash,
    activeLayerId,
    setLayersNeedRecomposition
  ]);

  // Redraw immediately when marquee selection changes to ensure deleted pixels disappear
  useEffect(() => {
    const hasSelection = Boolean(selectionStart && selectionEnd);

    // Marching ants + overlays rely on this to refresh promptly
    setNeedsRedraw((prev) => prev + 1);

    // When selection is cleared, force a draw using refs to avoid stale ants or pixels
    if (hadSelectionRef.current && !hasSelection) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx && drawRef.current && viewTransformRef.current) {
        drawRef.current(ctx, viewTransformRef.current);
      }
    }

    hadSelectionRef.current = hasSelection;
  }, [selectionStart, selectionEnd]);
  
  // Listen for color cycle animation frame updates and trigger redraws
  useEffect(() => {
    const handleColorCycleFrame = () => {
      refreshColorCycleSegments();
      setNeedsRedraw((prev) => prev + 1);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx && drawRef.current && viewTransformRef.current) {
        drawRef.current(ctx, viewTransformRef.current);
      }
    };

    window.addEventListener('colorCycleFrameReady', handleColorCycleFrame);
    window.addEventListener('colorCycleFrameUpdate', handleColorCycleFrame);

    return () => {
      window.removeEventListener('colorCycleFrameReady', handleColorCycleFrame);
      window.removeEventListener('colorCycleFrameUpdate', handleColorCycleFrame);
    };
  }, [refreshColorCycleSegments, setNeedsRedraw]);
  
  // Handle blur to reset space key state when losing focus
  const handleBlur = useCallback((e: React.FocusEvent) => {
    // Check if focus is actually leaving the component entirely
    // relatedTarget is the element that is receiving focus
    const newFocusTarget = e.relatedTarget as HTMLElement;
    
    // If focus is moving to another element within this component, don't reset
    if (newFocusTarget && wrapperRef.current?.contains(newFocusTarget)) {
      return;
    }
    
    // If spacebar was stuck down, force a release
    if (stateMachine.state.isSpacePressed) {
      // Dispatch SPACE_UP to correctly transition the state machine
      stateMachine.dispatch({ type: 'SPACE_UP' });
      setCursorStyle(defaultCursorStyle);
      setShowBrushCursor(isPointerInsideCanvas());
    }
  }, [defaultCursorStyle, isPointerInsideCanvas, setCursorStyle, setShowBrushCursor, stateMachine]);


  // Direct DOM keyboard handling for instant panning response
  React.useEffect(() => {
    const isTextEntryTarget = (target: EventTarget | null): boolean => {
      if (!(target instanceof HTMLElement)) {
        return false;
      }
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target.isContentEditable
      ) {
        return true;
      }
      return false;
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;

      // Read current scope (only allow Space handling on canvas or brush editor modal)
      const currentScope = useAppStore.getState().ui.keyboardScope.active;
      const brushEditorStatus = useAppStore.getState().brushEditor.status;
      const scopeAllowsSpace =
        currentScope === 'canvas' || (currentScope === 'modal' && brushEditorStatus === 'EDITING');

      // Space should take precedence over most actions (except modals)
      if (e.code === 'Space' && !isSpacePressedRef.current) {
        if (!scopeAllowsSpace || isTextEntryTarget(target)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();

        // quiet

        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
        setShowBrushCursorRef.current(false);
        setCursorStyleRef.current('grab');
        
        // Start panning immediately if mouse is down
        const { x: pointerX, y: pointerY } = mousePositionRef.current;
        if (isMouseDownRef.current) {
          panRef.current.startPan(pointerX, pointerY);
          setCursorStyleRef.current('grabbing');
          pauseAnimationForPan();
          // quiet
        }
        return;
      }

      // Non-space keys respect keyboard scope
      if (currentScope !== 'canvas') return;
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const currentScope = useAppStore.getState().ui.keyboardScope.active;
      const brushEditorStatus = useAppStore.getState().brushEditor.status;
      const scopeAllowsSpace =
        currentScope === 'canvas' || (currentScope === 'modal' && brushEditorStatus === 'EDITING');

      if (e.code === 'Space') {
        if (!scopeAllowsSpace || isTextEntryTarget(target)) {
          return;
        }

        e.preventDefault();
        e.stopPropagation();
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);

        const wasPanning = panRef.current.panState.isPanning;
        if (wasPanning) {
          panRef.current.endPan();
        }
        setCursorStyleRef.current(defaultCursorStyle);
        setShowBrushCursorRef.current(true);
        void resumeAnimationAfterPan();
      }
    };

    const listenerOptions: AddEventListenerOptions = { capture: true };

    window.addEventListener('keydown', handleKeyDown, listenerOptions);
    window.addEventListener('keyup', handleKeyUp, listenerOptions);

    return () => {
      window.removeEventListener('keydown', handleKeyDown, listenerOptions);
      window.removeEventListener('keyup', handleKeyUp, listenerOptions);
    };
  }, [defaultCursorStyle, pauseAnimationForPan, resumeAnimationAfterPan]);

  // Monitor undo stack changes (quiet)
  useEffect(() => {
    let prevLength = useAppStore.getState().history.undoStack.length;
    const unsubscribe = useAppStore.subscribe((state) => {
      const length = state.history.undoStack.length;
      if (length > prevLength) {
        // quiet
      }
      prevLength = length;
    });
    return unsubscribe;
  }, []);

  // Comprehensive keyboard handling (for other keys)
  useComprehensiveKeyboard({
    onSpacePressed: () => {
      // Fallback: ensure space press is honored even if our direct handler missed it
      if (!isSpacePressedRef.current) {
        isSpacePressedRef.current = true;
        setIsSpacePressed(true);
        setShowBrushCursorRef.current(false);
        setCursorStyleRef.current('grab');
        const { x: pointerX, y: pointerY } = mousePositionRef.current;
        if (isMouseDownRef.current) {
          panRef.current.startPan(pointerX, pointerY);
          setCursorStyleRef.current('grabbing');
          pauseAnimationForPan();
          // quiet
        }
      }
    },
    onSpaceReleased: () => {
      if (isSpacePressedRef.current) {
        isSpacePressedRef.current = false;
        setIsSpacePressed(false);
        if (panRef.current.panState.isPanning) {
          panRef.current.endPan();
        }
        setCursorStyleRef.current(defaultCursorStyle);
        setShowBrushCursorRef.current(true);
        void resumeAnimationAfterPan();
        // quiet
      }
    },
    onSave: () => {
      useAppStore.getState().saveProject().catch(() => {});
    },
    onOpen: () => {
      useAppStore.getState().toggleModal('loadProject');
    },
    onCustomTool: () => {
      void switchTool('custom');
    },
    onUndo: async () => {
      if (!useAppStore.getState().canUndo()) {
        return;
      }
      await undo();
    },
    onRedo: async () => {
      if (!useAppStore.getState().canRedo()) {
        return;
      }
      await redo();
    },
    onPolygonComplete: async () => {
      if (toolStateMachine.completePolygonGradient()) {
        // Draw polygon
        drawingHandlers.initDrawingCanvas();
        const drawCtx = drawingHandlers.drawingCanvasRef.current?.getContext('2d', { willReadFrequently: true });
        
        if (drawCtx && brushEngine) {
          // Check if we're on a color cycle layer in shape mode
          const activeLayer = layers.find(l => l.id === activeLayerId);
          const isColorCycleLayer = activeLayer?.layerType === 'color-cycle';
          
          if (isColorCycleLayer && tools.shapeMode) {
            // Don't save here - it will be saved in finalizeDrawing
            // This prevents duplicate undo entries for color cycle shapes
            
            
            // Start a fresh CC stroke buffer for each new shape to avoid accumulation
            brushEngine.resetColorCycle(true);
            
            
            // Fill shape with color cycle gradient from edges to center
            const points = toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y }));
            await brushEngine.fillColorCycleShape(points);
            
            // Clear the drawing canvas before rendering
            drawCtx.clearRect(0, 0, drawCtx.canvas.width, drawCtx.canvas.height);
            
            // Render the color cycle immediately at full opacity
            brushEngine.renderColorCycle(drawCtx, false);
            
          } else if (toolStateMachine.isContourPolygon) {
            // Check if it's a contour polygon
            const sampledStrokeColor = toolStateMachine.polygonGradientState.points.find((p) => p.color)?.color;
            brushEngine.drawContourPolygon(
              drawCtx,
              {
                vertices: toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y })),
                fillColor: toolStateMachine.polygonGradientState.points[0]?.color
              },
              false,
              sampledStrokeColor ? { strokeColorOverride: sampledStrokeColor } : undefined
            );
          } else if (toolStateMachine.polygonGradientState.points.length >= 3) {
            // Standard polygon gradient - only if we have valid points
            brushEngine.drawPolygonGradient(
              drawCtx,
              {
                vertices: toolStateMachine.polygonGradientState.points.map(p => ({ x: p.x, y: p.y })),
                colors: toolStateMachine.polygonGradientState.points.map(p => p.color)
              },
              false
            );
          }
          drawingHandlers.drawingCanvasHasContent.current = true;
          // Mark composite as dirty BEFORE finalization
          compositeCanvasDirtyRef.current = true;
          
          drawingHandlers.finalizeDrawing().then(() => {
            
            
            // Signal that finalization is complete
            stateMachine.finalizationComplete();
            
            // Force immediate composite regeneration after layer update
            if (rebuildStaticComposite()) {
              compositeCanvasDirtyRef.current = false;
            }
            
            // Trigger redraw after finalization
            setNeedsRedraw(prev => prev + 1);
            
            // Restart color cycle animation if it should be playing
            if (
              (tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ||
               tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) &&
              isColorCyclePlaybackActive()
            ) {
              wrappedStartAnimation();
            }
          });
        }
        toolStateMachine.resetPolygonGradient();
      }
    },
    onPolygonCancel: () => {
      const cancelled = cancelActiveOperations({ includeFloatingPaste: false, dispatchInteractionEnd: true });
      if (!cancelled) {
        toolStateMachine.resetPolygonGradient();
        interaction.dispatch({ type: 'DRAWING_END' });
      }
    },
    onEnterPressed: async () => {
      if (tools.currentTool === 'color-adjust' && colorAdjustActive) {
        await applyColorAdjust();
        return;
      }

      if (tools.currentTool === 'crop') {
        if (crop.marquee && !crop.commitInFlight) {
          await commitCrop();
        }
        return;
      }

      if (await finalizeActiveShape()) {
        return;
      }

      if (floatingPaste) {
        await commitFloatingPaste();
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    },
    onEscapePressed: () => {
      if (tools.currentTool === 'color-adjust' && colorAdjustActive) {
        cancelColorAdjust();
        const fallbackTool = (previousTool ?? 'brush') as Tool;
        const resolvedTool: Tool =
          fallbackTool === 'color-adjust' ? 'brush' : fallbackTool;
        void switchTool(resolvedTool);
        return;
      }

      if (tools.currentTool === 'crop') {
        cancelCrop();
        return;
      }

      const cancelled = cancelActiveOperations({ includeFloatingPaste: true, dispatchInteractionEnd: true });

      if (cancelled) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    },
    enabled: true // Always enable keyboard shortcuts
  });

  useEffect(() => {
    if (lastStateMachineToolRef.current !== tools.currentTool) {
      setCanvasStateMachineTool(tools.currentTool);
      lastStateMachineToolRef.current = tools.currentTool;
    }

    const previousTool = previousToolRef.current;
    if (previousTool && previousTool !== tools.currentTool) {
      if (previousTool === 'color-picker' && tools.currentTool !== 'color-picker') {
        setShowBrushCursor(isPointerInsideCanvas());
        setCursorStyle(defaultCursorStyle);
      }
      const cancelled = cancelActiveOperations({ includeFloatingPaste: false, dispatchInteractionEnd: false });
      interactionDispatch({ type: 'RESET' });
      forceCanvasIdle();

      if (cancelled) {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      }
    }

    previousToolRef.current = tools.currentTool;
  }, [
    cancelActiveOperations,
    draw,
    forceCanvasIdle,
    interactionDispatch,
    setCanvasStateMachineTool,
    defaultCursorStyle,
    isPointerInsideCanvas,
    setCursorStyle,
    setShowBrushCursor,
    tools.currentTool
  ]);
  
  // Helper to get mouse position
  const getMousePos = useCallback((event: React.MouseEvent<Element> | React.WheelEvent<Element>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: event.clientX - rect.left,
      y: event.clientY - rect.top,
    };
  }, []);
  
  // Use modular event handlers
  const eventHandlers = useCanvasEventHandlers({
    // Canvas refs
    canvasRef: canvasRef as React.RefObject<HTMLCanvasElement>,
    wrapperRef: wrapperRef as React.RefObject<HTMLDivElement>,
    overlayCanvasRef: overlayCanvasRef as React.RefObject<HTMLCanvasElement>,
    compositeCanvasRef,
    
    // State refs
    isBusyRef,
    isMouseDownRef,
    isSpacePressedRef,
    drawAnimationFrameRef,
    pointerMoveThrottled,
    
    // Store state
    project,
    canvas: {
      width: project?.width ?? 1920,
      height: project?.height ?? 1080,
      scale: canvasZoom || 1,
      zoom: canvasZoom || 1
    },
    tools: {
      currentTool: tools.currentTool,
      brushSettings: tools.brushSettings,
      fillSettings: tools.fillSettings,
      eraserSettings: tools.eraserSettings,
      shapeMode: tools.shapeMode,
      customBrushCapture: tools.customBrushCapture
    },
    layers,
    activeLayerId,
    selectionStart,
    selectionEnd,
    floatingPaste,

    // Store actions
    setSelectionBounds,
    clearSelection,
    setCurrentTool: setCurrentToolById,
    setCurrentOffscreenCanvas,
    compositeLayersToCanvas,
    updateLayer,
    palette,
    polygonGradientState,
    recolorSampling,
    currentBrushPresetId,
    setActiveColor,
    setBrushSettings,
    updateRecolorSampling,
    stopRecolorSampling,
    setRectangleBrushState,
    setCustomBrushFreehandPath: (payload) => setCustomBrushFreehandPath(payload ?? null),

    // Floating paste
    setFloatingPaste: setFloatingPasteFromHandlers,
    updateFloatingPastePosition: (x: number, y: number) => updateFloatingPastePosition({ x, y }),
    commitFloatingPaste,
    cancelFloatingPaste,
    
    // Drawing state
    isDraggingFloatingPaste,
    setIsDraggingFloatingPaste,
    floatingPasteDragStart,
    floatingPasteOriginalPos,
    
    // Cursor state
    setCursorStyle,
    setShowBrushCursor,
    setCursorPosition: setCursorScreenPosition,
    
    // Hooks
    interaction,
    stateMachine,
    pan,
    toolStateMachine,
    drawingHandlers,
    brushEngine,
    
    // Helper functions
    sampleColorAtPosition,
    sampleColorsAlongLine,
    getMousePos,
    
    // Drawing state management
    compositeCanvasDirtyRef,
    setNeedsRedraw,
    setLayersNeedRecomposition,
    
    // View transform and drawing
    viewTransformRef,
    draw,
    drawingAnimationFrameRef,
    previewAnimationFrameRef,

    // Optional
    defaultCursorStyle: cursorStyle,
    restartColorCycleAnimation: () => {
      if (
        (tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE ||
         tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) &&
        isColorCyclePlaybackActive()
      ) {
        wrappedStartAnimation();
      }
    },
    pauseAnimationForPan,
    resumeAnimationAfterPan,
    // Surface errors consistently in pointer handlers too
    feedback: showFeedback
  });
  
  // Extract handlers from modular system
  const {
    handlePointerDown,
    handlePointerMove, 
    handlePointerUp,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel
  } = eventHandlers;
  
  // Effects
  
  // Update cursor style when brush shape changes
  useEffect(() => {
    // Only update if we're not in a special mode (dragging, etc.)
    if (stateMachine.state.mode !== 'AWAITING_PAN' && stateMachine.state.mode !== 'PANNING' && !isDraggingFloatingPaste) {
      setCursorStyle(defaultCursorStyle);
    }
  }, [defaultCursorStyle, isDraggingFloatingPaste, setCursorStyle, stateMachine.state.mode]);
  
  // Regenerate composite canvas when layers change
  useEffect(() => {
    if (!project) return;

    const activeLayerChanged = activeLayerId !== lastActiveLayerIdRef.current;

    if (
      layersHash === lastCompositeHashRef.current &&
      !compositeCanvasDirtyRef.current &&
      !layersNeedRecomposition &&
      !activeLayerChanged
    ) {
      return;
    }

    const rebuilt = rebuildStaticComposite();

    if (rebuilt) {
      renderSplitComposites();
      lastCompositeHashRef.current = layersHash;
      lastActiveLayerIdRef.current = activeLayerId ?? null;
      compositeCanvasDirtyRef.current = false;
      lastSampleRef.current = { x: -1, y: -1, color: 'rgb(0, 0, 0)', layerId: null };
      if (layersNeedRecomposition) {
        setLayersNeedRecomposition(false);
      }
      setNeedsRedraw(prev => prev + 1);

      const canvas = canvasRef.current;
      if (canvas && drawRef.current && viewTransformRef.current) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          drawRef.current(ctx, viewTransformRef.current);
        }
      }
    }
  }, [
    layersHash,
    project,
    layersNeedRecomposition,
    setLayersNeedRecomposition,
    activeLayerId,
    renderSplitComposites,
    rebuildStaticComposite
  ]);
  
  // Animate marching ants
  useEffect(() => {
    let animationId: number | null = null;
    let frameCount = 0;
    let isActive = true;
    
    if ((selectionStart && selectionEnd) || floatingPaste) {
      const animate = () => {
        // Check if effect is still active before continuing animation
        if (!isActive) return;
        
        frameCount++;
        if (frameCount % 3 === 0) {
          setMarchingAntsOffset(prev => (prev + 1) % 10);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            // We need to call draw here, but we don't include it in dependencies
            // to avoid circular dependency that causes infinite loop
            draw(ctx, viewTransformRef.current);
          }
        }
        animationId = requestAnimationFrame(animate);
      };
      animationId = requestAnimationFrame(animate);
    }
    
    return () => {
      isActive = false;
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
        animationId = null;
      }
    };
  }, [draw, floatingPaste, selectionEnd, selectionStart, viewTransformRef]);
  
  // Handle wheel events for zooming and panning
  useEffect(() => {
    const shouldMeasure = process.env.NODE_ENV !== 'production';

    const handleWheel: EventListener = (event) => {
      const e = event as WheelEvent;
      e.preventDefault();

      // Always read from the ref to get the most up-to-date values
      // without needing to re-create this handler on every render.
      const { scale: currentScale, offsetX: currentOffsetX, offsetY: currentOffsetY } = viewTransformRef.current;

      // Always zoom with vertical scroll
      if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) {
        // --- Zoom Logic (vertical scroll) ---
        const rect = canvasRef.current?.getBoundingClientRect();
        if (!rect) return;
        
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        
        const scrollSensitivity = 0.001;
        const zoomFactor = 1 - e.deltaY * scrollSensitivity;
        
        // Clamp zoom to configured range to avoid precision drift at extremes
        const newScale = Math.max(
          MIN_CANVAS_ZOOM,
          Math.min(currentScale * zoomFactor, MAX_CANVAS_ZOOM)
        );
        
        // Only update if there's an actual change to prevent precision errors
        if (Math.abs(newScale - currentScale) < 0.0001) return;
        
        const worldX = (mouseX - currentOffsetX) / currentScale;
        const worldY = (mouseY - currentOffsetY) / currentScale;
        
        const newOffsetX = mouseX - worldX * newScale;
        const newOffsetY = mouseY - worldY * newScale;
        
        if (shouldMeasure) {
          viewPerformanceTracker.startSession('zoom');
          isZoomingRef.current = true;
          if (zoomEndTimeoutRef.current !== null) {
            window.clearTimeout(zoomEndTimeoutRef.current);
          }
          zoomEndTimeoutRef.current = window.setTimeout(() => {
            isZoomingRef.current = false;
            viewPerformanceTracker.endSession('zoom');
            zoomEndTimeoutRef.current = null;
          }, 160);
        }

        // Set state and let React handle the redraw
        setZoom(newScale);
        // Update pan to keep zoom centered on cursor
        setPan(newOffsetX, newOffsetY);

      } else if (e.deltaX !== 0) {
        // Horizontal scroll - no action
      }
    };
    
    const targets: EventTarget[] = [];
    const primaryTarget = wrapperRef.current ?? canvasRef.current;
    if (primaryTarget) {
      primaryTarget.addEventListener('wheel', handleWheel, { passive: false });
      targets.push(primaryTarget);
    }

    return () => {
      targets.forEach((target) => {
        target.removeEventListener('wheel', handleWheel);
      });
      if (zoomEndTimeoutRef.current !== null) {
        window.clearTimeout(zoomEndTimeoutRef.current);
        zoomEndTimeoutRef.current = null;
      }
      isZoomingRef.current = false;
    };
    // The ref handles stale data, so dependencies can be minimal and stable.
  }, [setZoom, setPan, viewTransformRef]);
  
  // Consolidated safety net for resetting interaction state
  useEffect(() => {
    const handleInteractionReset = () => {
      // Safety reset handler
      
      
      // Check if the space key state is stuck
      if (stateMachine.state.isSpacePressed) {
        
        // Space handling now in state machine
        
        // Always restore the default cursor and only show the brush when pointer is over canvas
        setCursorStyle(defaultCursorStyle);
        setShowBrushCursor(isPointerInsideCanvas());
      } else {
      }
    };

    const handleVisibilityChange = () => {
      // Reset state if the tab is hidden
      if (document.hidden) {
        handleInteractionReset();
      }
    };

    // Listen for the window losing focus (e.g., Alt-Tab)
    window.addEventListener('blur', handleInteractionReset);
    
    // Listen for the tab being switched away
    document.addEventListener('visibilitychange', handleVisibilityChange);

    // Cleanup: remove listeners when the component unmounts
    return () => {
      window.removeEventListener('blur', handleInteractionReset);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
    
    // Dependencies ensure the handler has the correct functions/values if they ever change.
  }, [
    defaultCursorStyle,
    isPointerInsideCanvas,
    setCursorStyle,
    setShowBrushCursor,
    stateMachine.state.isSpacePressed
  ]);
  
  // Center canvas on mount and focus
  useEffect(() => {
    // centerCanvas removed();
    // Auto-focus the canvas wrapper for keyboard events
    if (wrapperRef.current) {
      wrapperRef.current.focus();
    }
  }, []);
  
  // Redraw whenever the view transform state or composite canvas changes
  useEffect(() => {
    // Skip automatic redraws during active panning (handled by mousemove)
    if (stateMachine.state.mode === 'PANNING') return;
    
    const canvasElement = canvasRef.current;
    const ctx = canvasElement?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;
    
    // Use the viewTransformRef which is the single source of truth
    draw(ctx, viewTransformRef.current);

  // This now correctly depends on the sources of truth for a redraw
  }, [canvasZoom, canvasOffsetX, canvasOffsetY, draw, needsRedraw, stateMachine.state.mode]);
  
  const getViewportPastePosition = useCallback(
    (contentWidth: number, contentHeight: number) => {
      if (!project) {
        return null;
      }

      const canvasElement = canvasRef.current;
      if (!canvasElement) {
        return null;
      }

      const rect = canvasElement.getBoundingClientRect();
      if (!rect || rect.width === 0 || rect.height === 0) {
        return null;
      }

      const { scale, offsetX, offsetY } = viewTransformRef.current;
      const safeScale = scale || 1;

      const centerScreenX = rect.width / 2;
      const centerScreenY = rect.height / 2;

      const centerWorldX = (centerScreenX - offsetX) / safeScale;
      const centerWorldY = (centerScreenY - offsetY) / safeScale;

      const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(max, value));
      const maxX = Math.max(0, project.width - contentWidth);
      const maxY = Math.max(0, project.height - contentHeight);

      return {
        x: clamp(Math.round(centerWorldX - contentWidth / 2), 0, maxX),
        y: clamp(Math.round(centerWorldY - contentHeight / 2), 0, maxY),
      };
    },
    [project]
  );

  const commitExistingFloatingIfPresent = useCallback(async () => {
    const existingFloating = floatingPasteRef.current;
    if (existingFloating) {
      try {
        await commitFloatingPaste();
      } catch (error) {
        if (process.env.NODE_ENV !== 'production') {
          console.warn('[floatingPaste] Failed to commit existing floating before paste', error);
        }
      }
    }
  }, [commitFloatingPaste, floatingPasteRef]);

  // Handle paste event
  useEffect(() => {
    const cloneClipboardImageData = (imageData: ImageData): ImageData =>
      new ImageData(new Uint8ClampedArray(imageData.data), imageData.width, imageData.height);

    const handlePaste = async (event: ClipboardEvent) => {
      event.preventDefault();

      const items = event.clipboardData?.items;
      let handled = false;

      if (items) {
        for (const item of items) {
          if (item.type.indexOf('image') === -1) {
            continue;
          }

          const blob = item.getAsFile();
          if (!blob) {
            continue;
          }

          handled = true;

          const reader = new FileReader();
          reader.onload = async (e) => {
            const img = new Image();
            img.onload = async () => {
              const tempCanvas = document.createElement('canvas');
              const tempCtx = tempCanvas.getContext('2d', { willReadFrequently: true });
              if (!tempCtx || !project) {
                return;
              }

              tempCanvas.width = project.width;
              tempCanvas.height = project.height;

              const scale = Math.min(project.width / img.width, project.height / img.height, 1);
              const scaledWidth = img.width * scale;
              const scaledHeight = img.height * scale;
              const x = (project.width - scaledWidth) / 2;
              const y = (project.height - scaledHeight) / 2;
              const imageX = Math.floor(x);
              const imageY = Math.floor(y);
              const imageWidth = Math.ceil(scaledWidth);
              const imageHeight = Math.ceil(scaledHeight);

              const fallbackPosition = {
                x: Math.max(0, Math.min(project.width - imageWidth, imageX)),
                y: Math.max(0, Math.min(project.height - imageHeight, imageY)),
              };
              const viewportPosition =
                getViewportPastePosition(imageWidth, imageHeight) ?? fallbackPosition;

              tempCtx.drawImage(img, x, y, scaledWidth, scaledHeight);

              const pasteImageData = tempCtx.getImageData(imageX, imageY, imageWidth, imageHeight);

              await commitExistingFloatingIfPresent();
              clearSelection();
              setFloatingPaste({
                imageData: pasteImageData,
                position: viewportPosition,
                width: imageWidth,
                height: imageHeight,
                displayWidth: imageWidth,
                displayHeight: imageHeight,
                sourceLayerId: null,
                colorCycleIndices: null,
              });

              requestAnimationFrame(() => {
                const canvas = canvasRef.current;
                const ctx = canvas?.getContext('2d', { willReadFrequently: true });
                if (ctx) {
                  draw(ctx, viewTransformRef.current);
                }
              });
            };

            img.src = e.target?.result as string;
          };

          reader.readAsDataURL(blob);
          break;
        }
      }

      if (handled) {
        return;
      }

      const clipboardPayload = selectionClipboardRef.current;
      if (!clipboardPayload) {
        return;
      }

      const viewportPosition =
        clipboardPayload.mode === 'cut'
          ? clipboardPayload.position
          : getViewportPastePosition(clipboardPayload.width, clipboardPayload.height);

      const position = viewportPosition ?? { ...clipboardPayload.position };

      await commitExistingFloatingIfPresent();
      clearSelection();
      setFloatingPaste({
        imageData: cloneClipboardImageData(clipboardPayload.imageData),
        position,
        width: clipboardPayload.width,
        height: clipboardPayload.height,
        displayWidth: clipboardPayload.width,
        displayHeight: clipboardPayload.height,
        sourceLayerId: clipboardPayload.colorCycleSourceLayerId ?? null,
        colorCycleIndices: clipboardPayload.colorCycleIndices ?? null,
      });

      requestAnimationFrame(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          draw(ctx, viewTransformRef.current);
        }
      });
    };

    document.addEventListener('paste', handlePaste);

    return () => {
      document.removeEventListener('paste', handlePaste);
    };
  }, [
    project,
    layers,
    activeLayerId,
    draw,
    setFloatingPaste,
    selectionClipboardRef,
    viewTransformRef,
    getViewportPastePosition,
    clearSelection,
    commitExistingFloatingIfPresent,
  ]);

  // Handle canvas resizing - run only once on mount
  useEffect(() => {
    const canvas = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvas || !wrapper) return;
    
    let lastWidth = 0;
    let lastHeight = 0;
    let lastDpr = devicePixelRatioRef.current;
    
    const handleResize = () => {
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) return;
      
      const { width, height } = wrapper.getBoundingClientRect();
      const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
      
      // Only update if dimensions or DPR changed
      if (width !== lastWidth || height !== lastHeight || dpr !== lastDpr) {
        lastWidth = width;
        lastHeight = height;
        lastDpr = dpr;
        devicePixelRatioRef.current = dpr;

        const targetWidth = Math.max(1, Math.round(width * dpr));
        const targetHeight = Math.max(1, Math.round(height * dpr));
        if (canvas.width !== targetWidth) {
          canvas.width = targetWidth;
        }
        if (canvas.height !== targetHeight) {
          canvas.height = targetHeight;
        }
        
        // Also resize overlay canvas (kept in CSS pixel resolution)
        const overlayCanvas = overlayCanvasRef.current;
        if (overlayCanvas) {
          const overlayWidth = Math.max(1, Math.round(width));
          const overlayHeight = Math.max(1, Math.round(height));
          if (overlayCanvas.width !== overlayWidth) {
            overlayCanvas.width = overlayWidth;
          }
          if (overlayCanvas.height !== overlayHeight) {
            overlayCanvas.height = overlayHeight;
          }
        }
        
        setCanvasDimensions(width, height);
        
        // Get the latest draw function and viewTransform
        const drawFunc = drawRef.current;
        const viewTransform = viewTransformRef.current;
        if (drawFunc) {
          drawFunc(ctx, viewTransform);
        }

        // Center the project within the viewport once after initial sizing
        if (!hasCenteredRef.current && project) {
          const scale = (viewTransform.scale || 1);
          const contentWidth = project.width * scale;
          const contentHeight = project.height * scale;
          const offsetX = Math.floor((width - contentWidth) / 2);
          const offsetY = Math.floor((height - contentHeight) / 2);

          // Apply pan and update transform immediately to avoid visual lag
          setPan(offsetX, offsetY);
          viewTransformRef.current.offsetX = offsetX;
          viewTransformRef.current.offsetY = offsetY;

          if (drawFunc) {
            drawFunc(ctx, viewTransformRef.current);
          }

          hasCenteredRef.current = true;
        }
      }
    };
    
    const resizeObserver = new ResizeObserver(() => {
      window.requestAnimationFrame(handleResize);
    });
    
    resizeObserver.observe(wrapper);
    
    // Initial sizing
    handleResize();
    
    return () => resizeObserver.disconnect();
  }, [project, setCanvasDimensions, setPan]);
  
  // Color cycle animation frames are now handled by SimplifiedColorCycleManager
  // No need for separate event listeners
  
  // Center when project becomes available (e.g., created after mount)
  useEffect(() => {
    if (!project) return;
    const canvasEl = canvasRef.current;
    const wrapper = wrapperRef.current;
    if (!canvasEl || !wrapper) return;
    if (hasCenteredRef.current) return;

    const { width, height } = wrapper.getBoundingClientRect();
    const scale = (viewTransformRef.current?.scale || 1);
    const contentWidth = project.width * scale;
    const contentHeight = project.height * scale;
    const offsetX = Math.floor((width - contentWidth) / 2);
    const offsetY = Math.floor((height - contentHeight) / 2);

    setPan(offsetX, offsetY);
    viewTransformRef.current.offsetX = offsetX;
    viewTransformRef.current.offsetY = offsetY;

    const ctx = canvasEl.getContext('2d', { willReadFrequently: true });
    if (ctx && drawRef.current) {
      drawRef.current(ctx, viewTransformRef.current);
    }

    hasCenteredRef.current = true;
  }, [project, setPan]);

  
  const shouldForcePixelated = (canvasZoom || 1) > 3 || (
    tools.brushSettings.rotationEnabled &&
    (
      tools.brushSettings.brushShape === BrushShape.PIXEL_ROUND ||
      (!tools.brushSettings.antialiasing && tools.brushSettings.brushShape === BrushShape.SQUARE)
    )
  );

  const canvasStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    height: '100%',
    touchAction: 'none',
    userSelect: 'none',
    cursor: cursorStyle,
    imageRendering: shouldForcePixelated ? 'pixelated' : 'auto'
  };

  if (shouldForcePixelated) {
    Object.assign(canvasStyle, {
      WebkitImageRendering: 'pixelated',
      MozImageRendering: 'crisp-edges',
      msImageRendering: 'pixelated'
    } as React.CSSProperties);
  }

  return (
    <div
      ref={wrapperRef}
      className="w-full h-full relative"
      style={{
        overflow: 'hidden',
        cursor: cursorStyle,
        outline: 'none',
        boxShadow: 'none'
      }}
      tabIndex={0}
      role="region"
      aria-label="Drawing canvas workspace"
      onBlur={handleBlur}
    >
      <canvas
        ref={canvasRef}
        onPointerDown={handlePointerDown}
        onPointerUp={handlePointerUp}
        onPointerMove={handlePointerMove}
        onPointerEnter={handlePointerEnter}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        onContextMenu={(e) => e.preventDefault()}
        tabIndex={-1}
        aria-label="Drawing surface"
        style={canvasStyle}
      />
      
      {/* Overlay canvas for previews - no interaction events */}
      <canvas
        ref={overlayCanvasRef}
        style={{ 
          position: 'absolute',
          top: 0,
          left: 0,
          width: '100%', 
          height: '100%',
          mixBlendMode: 'normal',
          pointerEvents: 'none',
          imageRendering: (canvasZoom || 1) > 3 ? 'pixelated' : 'auto',
          touchAction: 'none', // Prevent scrolling/zooming on touch devices
          userSelect: 'none', // Prevent text selection
          cursor: cursorStyle,
        }}
      />

      {project && floatingPaste ? (
        <FloatingPasteOverlay
          projectWidth={project.width}
          projectHeight={project.height}
          zoom={canvasZoom || 1}
          offsetX={pan.panState.offsetX}
          offsetY={pan.panState.offsetY}
        />
      ) : null}

      {project ? (
        <SelectionMarqueeHandles
          zoom={canvasZoom || 1}
          offsetX={pan.panState.offsetX}
          offsetY={pan.panState.offsetY}
          projectWidth={project.width}
          projectHeight={project.height}
        />
      ) : null}

      {tools.currentTool === 'crop' && project ? (
        <CropOverlay
          active
          projectWidth={project.width}
          projectHeight={project.height}
          zoom={canvasZoom || 1}
          offsetX={pan.panState.offsetX}
          offsetY={pan.panState.offsetY}
          isSpacePressed={isSpacePressed}
        />
      ) : null}
      
      {/* Zoom indicator */}
      <div className="absolute bottom-4 right-4 bg-black/50 text-white px-2 py-1 rounded text-sm">
        {Math.round((canvasZoom || 1) * 100)}%
      </div>
      
      {/* Brush cursor preview */}
      {(() => {
        const brushShapeForCursor = tools.brushSettings.brushShape || BrushShape.ROUND;
        const cursorSize = Math.max(
          1,
          tools.brushSettings.size ??
            globalBrushSize ??
            tools.eraserSettings.size ??
            1
        );
        return (
          <BrushCursor
            ref={brushCursorHandleRef}
            size={cursorSize}
            brushShape={brushShapeForCursor}
            zoom={canvasZoom || 1}
            visible={
              showBrushCursor &&
              !pan.panState.isPanning &&
              !isSpacePressedRef.current &&
              cursorStyle === 'none'
            }
          />
        );
      })()}
    </div>
  );
};

export default React.memo(DrawingCanvas);
