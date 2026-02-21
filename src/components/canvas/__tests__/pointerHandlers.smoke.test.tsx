"use client";

/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { createPointerHandlers, createDefaultContourLinesState } from '@/hooks/canvas/handlers/pointerHandlers';
import { BrushShape } from '@/types';

const noop = () => {};

// JSDOM does not implement pointer capture helpers; provide no-op shims
(HTMLCanvasElement.prototype as any).setPointerCapture = jest.fn();
(HTMLCanvasElement.prototype as any).releasePointerCapture = jest.fn();

// Minimal stub canvas component to host handlers
const CanvasHost: React.FC<{
  handlers: ReturnType<typeof createPointerHandlers>;
}> = ({ handlers }) => (
  <canvas
    data-testid="canvas"
    onPointerDown={handlers.handlePointerDown}
    onPointerMove={handlers.handlePointerMove}
    onPointerUp={handlers.handlePointerUp}
  onPointerCancel={handlers.handlePointerCancel}
  />
);

describe('pointerHandlers smoke', () => {
  const createDeps = () => {
    const panState = { isPanning: false };
    const canvasRef = { current: document.createElement('canvas') } as React.RefObject<HTMLCanvasElement>;
    // JSDOM does not implement pointer capture helpers; stub them for handlers
    (canvasRef.current as any).setPointerCapture = jest.fn();
    (canvasRef.current as any).releasePointerCapture = jest.fn();
    const overlayCanvasRef = { current: document.createElement('canvas') } as React.RefObject<HTMLCanvasElement>;
    const wrapperRef = { current: document.createElement('div') } as React.RefObject<HTMLDivElement>;
    const dynamicDepsRef = {
      current: {
        project: { width: 10, height: 10 } as any,
        canvas: { width: 10, height: 10, scale: 1, zoom: 1 },
        tools: {
          currentTool: 'brush',
          selectionMode: 'marquee',
          brushSettings: {
            brushShape: BrushShape.ROUND,
            antialiasing: true,
            pressureEnabled: false,
            customBrushCapture: { active: false, mode: 'rectangle', sampleAllLayers: false },
          },
          fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
          eraserSettings: {},
          shapeMode: false,
        },
        layers: [],
        activeLayerId: null,
        selectionStart: null,
        selectionEnd: null,
        selectionMask: null,
        selectionMaskBounds: null,
        floatingPaste: null,
        isDraggingFloatingPaste: false,
        palette: { foregroundColor: '#000000', backgroundColor: '#ffffff', activeSlot: 'foreground' },
        polygonGradientState: { drawingState: 'idle' },
        recolorSampling: {},
        currentBrushPresetId: null,
      },
    };

    const deps: any = {
      canvasRef,
      wrapperRef,
      overlayCanvasRef,
      compositeCanvasRef: { current: null },
      dynamicDepsRef,
      isBusyRef: { current: false },
      isMouseDownRef: { current: false },
      isSpacePressedRef: { current: false },
      drawAnimationFrameRef: { current: null },
      pointerMoveThrottled: { current: 0 },
      project: dynamicDepsRef.current.project,
      canvas: dynamicDepsRef.current.canvas,
      tools: dynamicDepsRef.current.tools,
      layers: dynamicDepsRef.current.layers,
      activeLayerId: dynamicDepsRef.current.activeLayerId,
      selectionStart: dynamicDepsRef.current.selectionStart,
      selectionEnd: dynamicDepsRef.current.selectionEnd,
      floatingPaste: dynamicDepsRef.current.floatingPaste,
      isDraggingFloatingPaste: dynamicDepsRef.current.isDraggingFloatingPaste,
      palette: dynamicDepsRef.current.palette,
      polygonGradientState: dynamicDepsRef.current.polygonGradientState,
      recolorSampling: dynamicDepsRef.current.recolorSampling,
      currentBrushPresetId: dynamicDepsRef.current.currentBrushPresetId,
      setSelectionBounds: jest.fn(),
      clearSelection: jest.fn(),
      setCurrentTool: jest.fn(),
      setActiveColor: jest.fn(),
      setCurrentOffscreenCanvas: jest.fn(),
      compositeLayersToCanvas: jest.fn(),
      updateLayer: jest.fn(),
      setBrushSettings: jest.fn(),
      updateRecolorSampling: jest.fn(),
      stopRecolorSampling: jest.fn(),
      setRectangleBrushState: jest.fn(),
      setCustomBrushFreehandPath: jest.fn(),
      extractSelectionToFloatingPaste: jest.fn().mockReturnValue(false),
      setFloatingPaste: jest.fn(),
      updateFloatingPastePosition: jest.fn(),
      commitFloatingPaste: jest.fn(),
      cancelFloatingPaste: jest.fn(),
      setIsDraggingFloatingPaste: jest.fn(),
      floatingPasteDragStart: { current: null },
      floatingPasteOriginalPos: { current: null },
      setCursorStyle: jest.fn(),
      setShowBrushCursor: jest.fn(),
      setCursorPosition: jest.fn(),
      interaction: {
        state: { isDrawing: false, isSelecting: false, mode: 'idle' },
        dispatch: jest.fn(),
        refs: {
          selectionStart: { current: null },
          drawAnimationFrame: { current: null },
          lastDrawPos: { current: null },
          drawingCanvas: { current: null },
          drawingCanvasHasContent: { current: false },
          isCapturing: { current: false },
        },
      },
      stateMachine: { dispatch: jest.fn(), state: { mode: 'IDLE' }, isAwaitingPan: false, isPanning: false, finalizationComplete: jest.fn() },
      pan: {
        panState,
        startPan: jest.fn(() => { panState.isPanning = true; }),
        updatePan: jest.fn(),
        endPan: jest.fn(() => { panState.isPanning = false; }),
        screenToWorld: (x: number, y: number, s: number) => ({ x: x / (s || 1), y: y / (s || 1) }),
        worldToScreen: (x: number, y: number, s: number) => ({ x: x * (s || 1), y: y * (s || 1) }),
      },
      toolStateMachine: { isRectangleGradient: false, isPolygonGradient: false, isColorCycleShape: false, isContourPolygon: false },
      drawingHandlers: {
        isDrawingShapeRef: { current: false },
        continueShapeDrawing: jest.fn(),
        startShapeDrawing: jest.fn(),
        drawingCanvasHasContent: { current: false },
        finalizeShapeDrawing: jest.fn().mockResolvedValue(undefined),
        beginStrokeSession: jest.fn(),
        startDrawing: jest.fn(),
        continueDrawing: jest.fn(),
        endStrokeSession: jest.fn(),
        clearStrokeSession: jest.fn(),
        setSimpleShapePreviewRenderer: jest.fn(),
        setContourLinesPreviewRenderer: jest.fn(),
        setContourLinesSnapRenderer: jest.fn(),
        clearOverlay: jest.fn(),
        updateDitherGradSamples: jest.fn(),
      },
      brushEngine: null,
      sampleColorAtPosition: jest.fn(() => '#000000'),
      sampleColorsAlongLine: jest.fn(() => ['#000000', '#ffffff']),
      getMousePos: jest.fn((e: any) => ({ x: e.clientX, y: e.clientY })),
      compositeCanvasDirtyRef: { current: false },
      setNeedsRedraw: jest.fn(),
      viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
      draw: noop,
      drawingAnimationFrameRef: { current: null },
      previewAnimationFrameRef: { current: null },
      defaultCursorStyle: 'none',
      restartColorCycleAnimation: jest.fn(),
      feedback: jest.fn(),
      snapStrokeStartRef: { current: null },
      snapShiftAnchorRef: { current: null },
      snapLastBrushSampleRef: { current: null },
      contourLinesStateRef: { current: createDefaultContourLinesState() },
      contourLinesDefaultsCacheRef: { current: null },
      contourLinesFinalizingRef: { current: false },
      selectionRuntimeRef: {
        current: {
          pendingSelectionHistory: null,
          freehandSession: { active: false, points: [] },
          clickLineSession: { active: false, points: [] },
        },
      },
    };

    deps.previewSessionIdRef = { current: 0 };
    deps.newPreviewSession = () => {
      deps.previewSessionIdRef.current += 1;
      deps.contourLinesFinalizingRef.current = false;
      return deps.previewSessionIdRef.current;
    };
    deps.isCurrentPreviewSession = (sessionId: number) => sessionId === deps.previewSessionIdRef.current;

    return deps;
  };

  it('handles pointer down/move/up without throwing', () => {
    const deps = createDeps();
    const handlers = createPointerHandlers(deps);

    const { getByTestId } = render(<CanvasHost handlers={handlers} />);
    const canvas = getByTestId('canvas');

    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 8, clientY: 8, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 8, clientY: 8, button: 0, pointerId: 1 });

    // Smoke only: absence of throw is success.
    expect(true).toBe(true);
  });
});
