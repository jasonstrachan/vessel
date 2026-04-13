import { useCallback, useRef } from 'react';
import type React from 'react';
import { BrushShape } from '@/types';
import type { CanvasShape, DisplayFilterConfig, Layer, Project, Tool } from '@/types';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { useAppStore } from '@/stores/useAppStore';
import { getDisplayFilterById, hasEnabledDisplayFilters } from '@/lib/displayFilters';
import type { SimplifiedColorCycleManager } from './SimplifiedColorCycleManager';
import type { CanvasShapeDraft } from './useCanvasShapeEditorHandlers';
import { renderCanvasBackground } from './drawingCanvasBackground';
import {
  drawOverCompositeLayer,
  drawVisibleCompositeStack,
} from './drawingCanvasCompositeStack';
import { drawCanvasOutlineLayer } from './drawingCanvasOutline';
import { drawFloatingPasteLayer } from './drawingCanvasFloatingPaste';
import { drawCanvasOverlayLayer } from './drawingCanvasOverlay';
import { drawSelectionLayer } from './drawingCanvasSelection';
import { applyCanvasShapeClip, strokeCanvasShapeOutline } from '@/utils/canvasShape';
import { isOverlaySeededFromLayer } from '@/hooks/canvas/utils/overlaySeedState';

const CANVAS_CHECKER_LIGHT = '#2a2a2e';
const CANVAS_CHECKER_DARK = '#1c1c1f';
const CANVAS_TRANSPARENCY_GRAY = '#5a5a5f';

type Point = { x: number; y: number };

interface VisibleWorldRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface FilterPatternCache {
  key: string;
  canvas: HTMLCanvasElement | null;
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
    height,
  };
};

const ensureCanvas = (
  canvasRef: React.MutableRefObject<HTMLCanvasElement | null>,
  width: number,
  height: number,
): HTMLCanvasElement | null => {
  if (typeof document === 'undefined') {
    return null;
  }

  const nextWidth = Math.max(1, Math.ceil(width));
  const nextHeight = Math.max(1, Math.ceil(height));
  const canvas = canvasRef.current ?? document.createElement('canvas');
  if (canvas.width !== nextWidth) {
    canvas.width = nextWidth;
  }
  if (canvas.height !== nextHeight) {
    canvas.height = nextHeight;
  }
  canvasRef.current = canvas;
  return canvas;
};

const clearCanvas = (canvas: HTMLCanvasElement | null): CanvasRenderingContext2D | null => {
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

const buildColorGradeFilter = (filter: Extract<DisplayFilterConfig, { id: 'color-grade' }>): string => {
  const brightness = 100 + filter.settings.brightness * 100;
  const contrast = 100 + filter.settings.contrast * 100;
  const saturation = filter.settings.saturation * 100;
  return `brightness(${brightness}%) contrast(${contrast}%) saturate(${saturation}%)`;
};

interface FloatingPasteLike {
  imageData: ImageData | null;
  position: { x: number; y: number };
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number;
  vectorPath?: {
    mode: 'freehand' | 'click-line';
    points: Array<{ x: number; y: number }>;
  } | null;
}

interface UseDrawingCanvasBaseRendererOptions {
  project: Project | null;
  layers: Layer[];
  activeLayerId: string | null;
  activeCanvasShape: CanvasShape | null;
  canvasShapeEditor: {
    active: boolean;
    draft: CanvasShapeDraft | null;
  };
  checkerPatternCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  checkerPatternCacheRef: React.MutableRefObject<WeakMap<CanvasRenderingContext2D, CanvasPattern | null>>;
  brushShape: BrushShape | undefined;
  antialiasing: boolean | undefined;
  displayMode: 'pixelated' | 'smooth';
  displayFilters: DisplayFilterConfig[];
  transparencyBackgroundMode: 'checker' | 'gray';
  currentTool: Tool;
  underCompositeCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  underCompositeHasContentRef: React.MutableRefObject<boolean>;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  renderSplitComposites: () => void;
  drawNonActiveVisibleLayers: (ctx: CanvasRenderingContext2D) => void;
  compositeSegmentsRef: React.MutableRefObject<CompositeSegment[]>;
  layerMapRef: React.MutableRefObject<Map<string, Layer>>;
  compositeBitmap: ImageBitmap | null;
  compositeCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  overCompositeHasContentRef: React.MutableRefObject<boolean>;
  overCompositeCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  colorCycleManagerRef: React.MutableRefObject<SimplifiedColorCycleManager | null>;
  floatingPaste: FloatingPasteLike | null;
  marchingAntsOffset: number;
  pasteCanvasRef: React.MutableRefObject<HTMLCanvasElement | null>;
  lastPasteInfoRef: React.MutableRefObject<{
    imageData: ImageData | null;
    width: number;
    height: number;
  }>;
  selectionStart: Point | null;
  selectionEnd: Point | null;
  selectionMask: ImageData | null;
  selectionMaskBounds: { x: number; y: number; width: number; height: number } | null;
  selectionVectorPath: {
    mode: 'freehand' | 'click-line';
    points: Point[];
  } | null;
}

export const useDrawingCanvasBaseRenderer = ({
  project,
  layers,
  activeLayerId,
  activeCanvasShape,
  canvasShapeEditor,
  checkerPatternCanvasRef,
  checkerPatternCacheRef,
  brushShape,
  antialiasing,
  displayMode,
  displayFilters,
  transparencyBackgroundMode,
  currentTool,
  underCompositeCanvasRef,
  underCompositeHasContentRef,
  compositeCanvasDirtyRef,
  renderSplitComposites,
  drawNonActiveVisibleLayers,
  compositeSegmentsRef,
  layerMapRef,
  compositeBitmap,
  compositeCanvasRef,
  overCompositeHasContentRef,
  overCompositeCanvasRef,
  colorCycleManagerRef,
  floatingPaste,
  marchingAntsOffset,
  pasteCanvasRef,
  lastPasteInfoRef,
  selectionStart,
  selectionEnd,
  selectionMask,
  selectionMaskBounds,
  selectionVectorPath,
}: UseDrawingCanvasBaseRendererOptions) => {
  const lastSplitCompositeSequentialFrameRef = useRef<number | null>(null);
  const filterSurfaceCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const filterWorkCanvasARef = useRef<HTMLCanvasElement | null>(null);
  const filterWorkCanvasBRef = useRef<HTMLCanvasElement | null>(null);
  const filterAuxCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const pixelateCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lcdPatternCacheRef = useRef<FilterPatternCache>({ key: '', canvas: null });
  const noisePatternCacheRef = useRef<FilterPatternCache>({ key: '', canvas: null });

  const applyDisplayFilterStack = useCallback((
    sourceCanvas: HTMLCanvasElement,
    visibleRect: VisibleWorldRect,
  ): HTMLCanvasElement => {
    const workCanvasA = ensureCanvas(filterWorkCanvasARef, sourceCanvas.width, sourceCanvas.height);
    const workCanvasB = ensureCanvas(filterWorkCanvasBRef, sourceCanvas.width, sourceCanvas.height);
    if (!workCanvasA || !workCanvasB) {
      return sourceCanvas;
    }

    let currentCanvas = sourceCanvas;
    let nextCanvas = workCanvasA;
    const auxCanvas = ensureCanvas(filterAuxCanvasRef, sourceCanvas.width, sourceCanvas.height);
    const pixelateFilter = getDisplayFilterById(displayFilters, 'pixelate');
    const bloomFilter = getDisplayFilterById(displayFilters, 'bloom');
    const colorGradeFilter = getDisplayFilterById(displayFilters, 'color-grade');
    const lcdMaskFilter = getDisplayFilterById(displayFilters, 'lcd-mask');
    const noiseFilter = getDisplayFilterById(displayFilters, 'noise');

    const swap = (canvas: HTMLCanvasElement): HTMLCanvasElement => {
      const previous = currentCanvas;
      currentCanvas = canvas;
      nextCanvas = previous === workCanvasA ? workCanvasB : workCanvasA;
      return currentCanvas;
    };

    if (pixelateFilter?.enabled && pixelateFilter.settings.cellSize > 1) {
      const downsampleCanvas = ensureCanvas(
        pixelateCanvasRef,
        Math.max(1, Math.round(currentCanvas.width / pixelateFilter.settings.cellSize)),
        Math.max(1, Math.round(currentCanvas.height / pixelateFilter.settings.cellSize)),
      );
      const downsampleCtx = clearCanvas(downsampleCanvas);
      const nextCtx = clearCanvas(nextCanvas);
      if (downsampleCanvas && downsampleCtx && nextCtx) {
        downsampleCtx.imageSmoothingEnabled = true;
        downsampleCtx.drawImage(currentCanvas, 0, 0, downsampleCanvas.width, downsampleCanvas.height);
        nextCtx.imageSmoothingEnabled = false;
        nextCtx.drawImage(downsampleCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
        swap(nextCanvas);
      }
    }

    if (bloomFilter?.enabled && bloomFilter.settings.blurRadius > 0 && bloomFilter.settings.intensity > 0) {
      const bloomCanvas = ensureCanvas(
        auxCanvas ? { current: auxCanvas } : filterAuxCanvasRef,
        Math.max(1, Math.round(currentCanvas.width / 4)),
        Math.max(1, Math.round(currentCanvas.height / 4)),
      );
      const bloomCtx = clearCanvas(bloomCanvas);
      const nextCtx = clearCanvas(nextCanvas);
      if (bloomCanvas && bloomCtx && nextCtx) {
        bloomCtx.imageSmoothingEnabled = true;
        bloomCtx.filter = `blur(${bloomFilter.settings.blurRadius}px)`;
        bloomCtx.drawImage(currentCanvas, 0, 0, bloomCanvas.width, bloomCanvas.height);
        bloomCtx.filter = 'none';
        nextCtx.drawImage(currentCanvas, 0, 0);
        nextCtx.globalAlpha = bloomFilter.settings.intensity;
        nextCtx.imageSmoothingEnabled = true;
        nextCtx.drawImage(bloomCanvas, 0, 0, nextCanvas.width, nextCanvas.height);
        nextCtx.globalAlpha = 1;
        swap(nextCanvas);
      }
    }

    if (colorGradeFilter?.enabled) {
      const nextCtx = clearCanvas(nextCanvas);
      if (nextCtx) {
        nextCtx.filter = buildColorGradeFilter(colorGradeFilter);
        nextCtx.drawImage(currentCanvas, 0, 0);
        nextCtx.filter = 'none';
        swap(nextCanvas);
      }
    }

    if (lcdMaskFilter?.enabled && (lcdMaskFilter.settings.stripeOpacity > 0 || lcdMaskFilter.settings.scanlineOpacity > 0)) {
      const baseCell = Math.max(1, pixelateFilter?.settings.cellSize ?? 1);
      const patternKey = JSON.stringify({
        baseCell,
        stripeOpacity: lcdMaskFilter.settings.stripeOpacity,
        scanlineOpacity: lcdMaskFilter.settings.scanlineOpacity,
      });
      if (lcdPatternCacheRef.current.key !== patternKey) {
        const patternCanvas = ensureCanvas(
          { current: lcdPatternCacheRef.current.canvas },
          baseCell * 3,
          Math.max(2, baseCell * 2),
        );
        const patternCtx = clearCanvas(patternCanvas);
        if (patternCanvas && patternCtx) {
          const stripeWidth = Math.max(1, Math.ceil(patternCanvas.width / 3));
          patternCtx.fillStyle = `rgba(255, 96, 96, ${lcdMaskFilter.settings.stripeOpacity})`;
          patternCtx.fillRect(0, 0, stripeWidth, patternCanvas.height);
          patternCtx.fillStyle = `rgba(96, 255, 96, ${lcdMaskFilter.settings.stripeOpacity})`;
          patternCtx.fillRect(stripeWidth, 0, stripeWidth, patternCanvas.height);
          patternCtx.fillStyle = `rgba(96, 160, 255, ${lcdMaskFilter.settings.stripeOpacity})`;
          patternCtx.fillRect(stripeWidth * 2, 0, patternCanvas.width - stripeWidth * 2, patternCanvas.height);
          if (lcdMaskFilter.settings.scanlineOpacity > 0) {
            patternCtx.fillStyle = `rgba(0, 0, 0, ${lcdMaskFilter.settings.scanlineOpacity})`;
            patternCtx.fillRect(0, patternCanvas.height - 1, patternCanvas.width, 1);
          }
        }
        lcdPatternCacheRef.current = { key: patternKey, canvas: patternCanvas };
      }

      const nextCtx = clearCanvas(nextCanvas);
      if (nextCtx) {
        nextCtx.drawImage(currentCanvas, 0, 0);
        const pattern = lcdPatternCacheRef.current.canvas
          ? nextCtx.createPattern(lcdPatternCacheRef.current.canvas, 'repeat')
          : null;
        if (pattern && lcdPatternCacheRef.current.canvas) {
          nextCtx.save();
          nextCtx.globalCompositeOperation = 'multiply';
          nextCtx.translate(
            -((visibleRect.x % lcdPatternCacheRef.current.canvas.width) + lcdPatternCacheRef.current.canvas.width) % lcdPatternCacheRef.current.canvas.width,
            -((visibleRect.y % lcdPatternCacheRef.current.canvas.height) + lcdPatternCacheRef.current.canvas.height) % lcdPatternCacheRef.current.canvas.height,
          );
          nextCtx.fillStyle = pattern;
          nextCtx.fillRect(0, 0, nextCanvas.width + lcdPatternCacheRef.current.canvas.width, nextCanvas.height + lcdPatternCacheRef.current.canvas.height);
          nextCtx.restore();
        }
        swap(nextCanvas);
      }
    }

    if (noiseFilter?.enabled && noiseFilter.settings.opacity > 0) {
      const tileStep = Math.max(1, Math.round(noiseFilter.settings.scale));
      const patternKey = JSON.stringify({ tileStep });
      if (noisePatternCacheRef.current.key !== patternKey) {
        const patternCanvas = ensureCanvas({ current: noisePatternCacheRef.current.canvas }, 128, 128);
        const patternCtx = clearCanvas(patternCanvas);
        if (patternCanvas && patternCtx) {
          for (let y = 0; y < patternCanvas.height; y += tileStep) {
            for (let x = 0; x < patternCanvas.width; x += tileStep) {
              const tone = Math.floor(Math.random() * 255);
              patternCtx.fillStyle = `rgb(${tone}, ${tone}, ${tone})`;
              patternCtx.fillRect(x, y, tileStep, tileStep);
            }
          }
        }
        noisePatternCacheRef.current = { key: patternKey, canvas: patternCanvas };
      }

      const nextCtx = clearCanvas(nextCanvas);
      if (nextCtx) {
        nextCtx.drawImage(currentCanvas, 0, 0);
        const pattern = noisePatternCacheRef.current.canvas
          ? nextCtx.createPattern(noisePatternCacheRef.current.canvas, 'repeat')
          : null;
        if (pattern && noisePatternCacheRef.current.canvas) {
          nextCtx.save();
          nextCtx.globalAlpha = noiseFilter.settings.opacity;
          nextCtx.globalCompositeOperation = 'soft-light';
          nextCtx.translate(
            -((visibleRect.x % noisePatternCacheRef.current.canvas.width) + noisePatternCacheRef.current.canvas.width) % noisePatternCacheRef.current.canvas.width,
            -((visibleRect.y % noisePatternCacheRef.current.canvas.height) + noisePatternCacheRef.current.canvas.height) % noisePatternCacheRef.current.canvas.height,
          );
          nextCtx.fillStyle = pattern;
          nextCtx.fillRect(0, 0, nextCanvas.width + noisePatternCacheRef.current.canvas.width, nextCanvas.height + noisePatternCacheRef.current.canvas.height);
          nextCtx.restore();
        }
        swap(nextCanvas);
      }
    }

    return currentCanvas;
  }, [displayFilters]);

  return useCallback(
    (
      ctx: CanvasRenderingContext2D,
      transform: { scale: number; offsetX: number; offsetY: number },
      skipDrawingCanvas = false,
      drawingCanvasRef?: HTMLCanvasElement | null,
      isDrawing?: boolean,
      drawingCanvasHasContent?: boolean,
      isSelecting?: boolean,
      selectionStartRef?: Point | null,
      devicePixelRatio = 1
    ) => {
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

      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.fillStyle = '#141514';
      ctx.fillRect(0, 0, canvasPixelWidth, canvasPixelHeight);
      ctx.restore();

      if (!project || layers.length === 0) {
        return;
      }

      ctx.save();
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.save();
      ctx.translate(offsetX, offsetY);
      ctx.scale(scale, scale);

      const hasCanvasShape = Boolean(activeCanvasShape);
      if (hasCanvasShape && activeCanvasShape) {
        ctx.save();
        applyCanvasShapeClip(ctx, activeCanvasShape);
      }

      renderCanvasBackground({
        ctx,
        visibleRect,
        project,
        offsetX,
        offsetY,
        scale,
        displayWidth,
        displayHeight,
        checkerPatternCanvasRef,
        checkerPatternCacheRef,
        transparencyBackgroundMode,
        solidBackgroundColor: CANVAS_TRANSPARENCY_GRAY,
        checkerLight: CANVAS_CHECKER_LIGHT,
        checkerDark: CANVAS_CHECKER_DARK,
      });

      const activeLayer =
        activeLayerId != null ? layers.find((layer) => layer.id === activeLayerId) ?? null : null;
      const runtimeState = useAppStore.getState() as {
        activeLayerId?: string | null;
        sequentialRecord?: { currentFrame?: number; isPointerDown?: boolean };
        layersNeedRecomposition?: boolean;
      };
      const isSequentialCaptureDrawing =
        activeLayer?.layerType === 'sequential' &&
        runtimeState.activeLayerId === activeLayer.id &&
        Boolean(runtimeState.sequentialRecord?.isPointerDown);

      const isPixelBrush =
        brushShape === BrushShape.PIXEL_ROUND ||
        (brushShape === BrushShape.SQUARE && !antialiasing);
      const isPixelatedDisplay = displayMode === 'pixelated';
      ctx.imageSmoothingEnabled = !isPixelatedDisplay && !isPixelBrush && scale < 3;

      const overlayCanvasElement = drawingCanvasRef ?? null;
      const hasOverlayCanvas = overlayCanvasElement !== null;
      const overlaySeededFromLayer = isOverlaySeededFromLayer(overlayCanvasElement);
      const isActiveLayerOverlaySeeded =
        hasOverlayCanvas &&
        Boolean(drawingCanvasHasContent) &&
        overlaySeededFromLayer;
      const isActivelyErasing =
        (currentTool === 'eraser' && isDrawing && hasOverlayCanvas && drawingCanvasHasContent) ||
        Boolean(isActiveLayerOverlaySeeded);
      const overlayActive =
        !skipDrawingCanvas &&
        hasOverlayCanvas &&
        !isSequentialCaptureDrawing &&
        (isDrawing || drawingCanvasHasContent);
      const overlayEligibleForSplit = overlayActive && !isActivelyErasing;
      const floatingPasteActive = Boolean(floatingPaste && floatingPaste.imageData);
      const splitCompositeRequested = overlayEligibleForSplit || floatingPasteActive;

      if (splitCompositeRequested) {
        const sequentialFrame = runtimeState.sequentialRecord?.currentFrame ?? 0;
        const sequentialFrameChanged =
          activeLayer?.layerType === 'sequential' &&
          sequentialFrame !== lastSplitCompositeSequentialFrameRef.current;
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
          Boolean(runtimeState.layersNeedRecomposition) ||
          activeLayer?.layerType === 'color-cycle' ||
          sequentialFrameChanged ||
          anyAnimatingColorCycle;

        if (requiresLiveRefresh) {
          renderSplitComposites();
          compositeCanvasDirtyRef.current = false;
          lastSplitCompositeSequentialFrameRef.current = sequentialFrame;
        }
      } else {
        lastSplitCompositeSequentialFrameRef.current = null;
      }

      const useSplitOverlay = Boolean(splitCompositeRequested && underCompositeCanvasRef.current);
      const shouldFilterArtwork =
        Boolean(visibleRect) &&
        !isDrawing &&
        hasEnabledDisplayFilters(displayFilters);
      const filterCanvas = shouldFilterArtwork
        ? ensureCanvas(
            filterSurfaceCanvasRef,
            Math.ceil(visibleRect?.width ?? 1),
            Math.ceil(visibleRect?.height ?? 1),
          )
        : null;
      const filterCtx = shouldFilterArtwork ? clearCanvas(filterCanvas) : null;
      const compositeTargetCtx = filterCtx ?? ctx;
      const { invalidCompositeBitmap } = drawVisibleCompositeStack({
        ctx: compositeTargetCtx ?? ctx,
        visibleRect,
        targetRect: filterCtx
          ? { x: 0, y: 0, width: filterCanvas?.width ?? 1, height: filterCanvas?.height ?? 1 }
          : undefined,
        useSplitOverlay,
        underCompositeCanvas: underCompositeCanvasRef.current,
        isActivelyErasing,
        drawNonActiveVisibleLayers,
        segments: compositeSegmentsRef.current,
        layerMap: layerMapRef.current,
        compositeBitmap,
        compositeCanvas: compositeCanvasRef.current,
      });
      if (invalidCompositeBitmap) {
        const state = useAppStore.getState();
        state.setCurrentCompositeBitmap(null);
        state.setLayersNeedRecomposition(true);
      }
      if (filterCtx && filterCanvas && visibleRect) {
        const finalFilteredCanvas = applyDisplayFilterStack(filterCanvas, visibleRect);
        ctx.drawImage(
          finalFilteredCanvas,
          0,
          0,
          finalFilteredCanvas.width,
          finalFilteredCanvas.height,
          visibleRect.x,
          visibleRect.y,
          visibleRect.width,
          visibleRect.height,
        );
      }

      drawCanvasOverlayLayer({
        ctx,
        layers,
        activeLayer,
        visibleRect,
        overlayCanvasElement,
        overlayActive: Boolean(overlayActive),
        isDrawing,
        colorCycleManager: colorCycleManagerRef.current,
        selectionStart,
        selectionEnd,
        selectionMask,
        selectionMaskBounds,
        selectionVectorPath,
      });

      if (floatingPaste && floatingPaste.imageData) {
        drawFloatingPasteLayer({
          ctx,
          floatingPaste,
          project,
          layerOpacity: activeLayer?.opacity ?? 1,
          layerBlendMode: (activeLayer?.blendMode ?? 'source-over') as GlobalCompositeOperation,
          contextIsWorldTransformed: true,
          scale,
          offsetX,
          offsetY,
          marchingAntsOffset,
          pasteCanvasRef,
          lastPasteInfoRef,
          activeCanvasShape,
          applyCanvasShapeClip,
        });
      }

      drawOverCompositeLayer({
        ctx,
        useSplitOverlay,
        overCompositeHasContent: overCompositeHasContentRef.current,
        overCompositeCanvas: overCompositeCanvasRef.current,
        visibleRect,
      });

      if (hasCanvasShape) {
        ctx.restore();
      }
      ctx.restore();

      drawCanvasOutlineLayer({
        ctx,
        scale,
        offsetX,
        offsetY,
        projectWidth: project.width,
        projectHeight: project.height,
        activeCanvasShape,
        editorDraftShape: canvasShapeEditor.draft,
        editorActive: canvasShapeEditor.active,
        strokeCanvasShapeOutline,
      });

      drawSelectionLayer({
        ctx,
        projectWidth: project.width,
        projectHeight: project.height,
        scale,
        offsetX,
        offsetY,
        marchingAntsOffset,
        selectionStart,
        selectionEnd,
        isSelecting,
        selectionStartRef,
        selectionMask,
        selectionMaskBounds,
        selectionVectorPath,
        activeCanvasShape,
        applyCanvasShapeClip,
      });

      ctx.restore();
    },
    [
      project,
      layers,
      activeCanvasShape,
      checkerPatternCanvasRef,
      checkerPatternCacheRef,
      activeLayerId,
      brushShape,
      antialiasing,
      displayMode,
      displayFilters,
      transparencyBackgroundMode,
      currentTool,
      underCompositeCanvasRef,
      underCompositeHasContentRef,
      compositeCanvasDirtyRef,
      renderSplitComposites,
      drawNonActiveVisibleLayers,
      compositeSegmentsRef,
      layerMapRef,
      compositeBitmap,
      compositeCanvasRef,
      colorCycleManagerRef,
      overCompositeHasContentRef,
      overCompositeCanvasRef,
      canvasShapeEditor.active,
      canvasShapeEditor.draft,
      floatingPaste,
      marchingAntsOffset,
      pasteCanvasRef,
      lastPasteInfoRef,
      selectionStart,
      selectionEnd,
      selectionMask,
      selectionMaskBounds,
      selectionVectorPath,
      applyDisplayFilterStack,
    ]
  );
};
