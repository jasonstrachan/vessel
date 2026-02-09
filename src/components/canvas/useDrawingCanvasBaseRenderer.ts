import { useCallback, useRef } from 'react';
import type React from 'react';
import { BrushShape } from '@/types';
import type { CanvasShape, Layer, Project, Tool } from '@/types';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import { useAppStore } from '@/stores/useAppStore';
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

const CANVAS_CHECKER_LIGHT = '#2a2a2e';
const CANVAS_CHECKER_DARK = '#1c1c1f';

type Point = { x: number; y: number };

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
    height,
  };
};

interface FloatingPasteLike {
  imageData: ImageData | null;
  position: { x: number; y: number };
  width: number;
  height: number;
  displayWidth?: number;
  displayHeight?: number;
  rotation?: number;
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
  selectionMaskBounds: { x: number; y: number } | null;
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
}: UseDrawingCanvasBaseRendererOptions) => {
  const lastSplitCompositeSequentialFrameRef = useRef<number | null>(null);

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
        checkerLight: CANVAS_CHECKER_LIGHT,
        checkerDark: CANVAS_CHECKER_DARK,
      });

      const activeLayer =
        activeLayerId != null ? layers.find((layer) => layer.id === activeLayerId) ?? null : null;
      const runtimeState = useAppStore.getState() as {
        activeLayerId?: string | null;
        sequentialRecord?: { currentFrame?: number; isPointerDown?: boolean };
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
      const isActivelyErasing =
        currentTool === 'eraser' && isDrawing && hasOverlayCanvas && drawingCanvasHasContent;
      const overlayActive =
        !skipDrawingCanvas &&
        hasOverlayCanvas &&
        !isSequentialCaptureDrawing &&
        (isDrawing || drawingCanvasHasContent);
      const overlayEligibleForSplit = overlayActive && !isActivelyErasing;

      if (overlayEligibleForSplit) {
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

      const useSplitOverlay = Boolean(overlayEligibleForSplit && underCompositeCanvasRef.current);
      const { invalidCompositeBitmap } = drawVisibleCompositeStack({
        ctx,
        visibleRect,
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

      drawCanvasOverlayLayer({
        ctx,
        layers,
        activeLayer,
        visibleRect,
        overlayCanvasElement,
        overlayActive: Boolean(overlayActive),
        isDrawing,
        colorCycleManager: colorCycleManagerRef.current,
      });

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

      if (floatingPaste && floatingPaste.imageData) {
        drawFloatingPasteLayer({
          ctx,
          floatingPaste,
          project,
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

      drawSelectionLayer({
        ctx,
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
    ]
  );
};
