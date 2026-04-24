import { getAppStoreState } from '@/stores/appStoreAccess';
import { useCallback, useRef } from 'react';
import type React from 'react';
import { BrushShape } from '@/types';
import type { CanvasShape, DisplayFilterConfig, Layer, Project, Tool } from '@/types';
import type { CompositeSegment } from '@/stores/slices/layersSlice';
import {
  applyDisplayFilterStack as applySharedDisplayFilterStack,
  clearDisplayFilterCanvas,
  createDisplayFilterPipelineState,
  ensureDisplayFilterCanvas,
  hasEnabledDisplayFiltersInList,
} from '@/lib/displayFilterPipeline';
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
import { recordBreadcrumb } from '@/utils/debug';

const CANVAS_CHECKER_LIGHT = '#2a2a2e';
const CANVAS_CHECKER_DARK = '#1c1c1f';
const CANVAS_TRANSPARENCY_GRAY = '#5a5a5f';

type Point = { x: number; y: number };

export const shouldRequestCompositeBitmapRecomposition = (
  invalidBitmap: ImageBitmap | null,
  lastInvalidBitmap: ImageBitmap | null,
  currentStoreBitmap: ImageBitmap | null,
): boolean =>
  invalidBitmap !== null &&
  lastInvalidBitmap !== invalidBitmap &&
  currentStoreBitmap === invalidBitmap;

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
  const displayFilterStateRef = useRef(createDisplayFilterPipelineState());
  const lastInvalidCompositeBitmapRef = useRef<ImageBitmap | null>(null);

  const applyDisplayFilterStack = useCallback((
    sourceCanvas: HTMLCanvasElement,
    visibleRect?: VisibleWorldRect | null,
    lengthScale = 1,
  ): HTMLCanvasElement => applySharedDisplayFilterStack({
    sourceCanvas,
    displayFilters,
    filterState: displayFilterStateRef.current,
    visibleRect,
    lengthScale,
  }), [displayFilters]);

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

      if (compositeBitmap == null && lastInvalidCompositeBitmapRef.current !== null) {
        lastInvalidCompositeBitmapRef.current = null;
      }

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
      const runtimeState = getAppStoreState() as {
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
        hasEnabledDisplayFiltersInList(displayFilters);
      const filterCanvas = shouldFilterArtwork
        ? ensureDisplayFilterCanvas(
            displayFilterStateRef.current.filterSurfaceCanvas,
            Math.ceil(visibleRect?.width ?? 1),
            Math.ceil(visibleRect?.height ?? 1),
          )
        : null;
      displayFilterStateRef.current.filterSurfaceCanvas = filterCanvas;
      const filterCtx = shouldFilterArtwork ? clearDisplayFilterCanvas(filterCanvas) : null;
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
        const lastInvalidBitmap = lastInvalidCompositeBitmapRef.current;
        if (compositeBitmap && lastInvalidBitmap !== compositeBitmap) {
          lastInvalidCompositeBitmapRef.current = compositeBitmap;
          const state = getAppStoreState();
          const stateStillOwnsBitmap = state.currentCompositeBitmap === compositeBitmap;
          const shouldRequestRecomposition = shouldRequestCompositeBitmapRecomposition(
            compositeBitmap,
            lastInvalidBitmap,
            state.currentCompositeBitmap
          );
          recordBreadcrumb('canvas-composite', {
            event: 'invalid-composite-bitmap',
            stateStillOwnsBitmap,
            layersNeedRecomposition: state.layersNeedRecomposition,
            segmentCount: compositeSegmentsRef.current.length,
            hasCompositeCanvas: Boolean(compositeCanvasRef.current),
            activeLayerType: activeLayer?.layerType ?? null,
            activeLayerAnimating: activeLayer?.layerType === 'color-cycle'
              ? Boolean(activeLayer.colorCycleData?.isAnimating)
              : null,
          });
          if (shouldRequestRecomposition) {
            state.setCurrentCompositeBitmap(null);
            state.setLayersNeedRecomposition(true);
          }
        }
      }
      if (filterCtx && filterCanvas && visibleRect) {
        const finalFilteredCanvas = applyDisplayFilterStack(
          filterCanvas,
          visibleRect,
          scale * dpr,
        );
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
