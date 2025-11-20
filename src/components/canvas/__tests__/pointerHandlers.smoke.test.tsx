"use client";

import React from 'react';
import { render, fireEvent } from '@testing-library/react';
import { createPointerHandlers } from '@/hooks/canvas/handlers/pointerHandlers';

const noop = () => {};

// Minimal stub canvas component to host handlers
const CanvasHost: React.FC<{
  handlers: ReturnType<typeof createPointerHandlers>;
}> = ({ handlers }) => (
  <canvas
    data-testid="canvas"
    onPointerDown={handlers.onPointerDown}
    onPointerMove={handlers.onPointerMove}
    onPointerUp={handlers.onPointerUp}
    onPointerCancel={handlers.onPointerCancel}
  />
);

describe('pointerHandlers smoke', () => {
  const baseDeps = {
    canvasRef: { current: document.createElement('canvas') } as React.RefObject<HTMLCanvasElement>,
    overlayCanvasRef: { current: document.createElement('canvas') } as React.RefObject<HTMLCanvasElement>,
    viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
    compositeCanvasDirtyRef: { current: false },
    isDrawingRef: { current: false },
    setIsDrawing: jest.fn(),
    setLayersNeedRecomposition: jest.fn(),
    setNeedsRedraw: jest.fn(),
    draw: noop,
    selectTool: jest.fn(),
    setActiveLayerId: jest.fn(),
    setColorCyclePlaybackDesired: jest.fn(),
    setStrokeInProgress: jest.fn(),
    setStrokeBounds: jest.fn(),
    finalizeSelection: jest.fn(),
    clearSelection: jest.fn(),
    setSelectionMarquee: jest.fn(),
    setSelectionAnchor: jest.fn(),
    setSelectionMarqueeHandles: jest.fn(),
    setShowSelectionHandles: jest.fn(),
    setCanvasCursor: jest.fn(),
    setCanvasMessage: jest.fn(),
    setCanvasScaleMessage: jest.fn(),
    setCanvasScrollMessage: jest.fn(),
    setCanvasZoomMessage: jest.fn(),
    clearCanvasMessage: jest.fn(),
    onBeginFrame: jest.fn(),
    onEndFrame: jest.fn(),
    contourLinesStateRef: { current: null },
    contourLinesDefaultsCacheRef: { current: null },
    contourLinesFinalizingRef: { current: { get: () => false, set: () => {} } },
    dynamicDepsRef: { current: { getContourLinesBasis: () => null } },
    drawingHandlers: {
      setSimpleShapePreviewRenderer: jest.fn(),
      setContourLinesPreviewRenderer: jest.fn(),
      setContourLinesSnapRenderer: jest.fn(),
      clearOverlay: jest.fn(),
    },
  } as any;

  it('handles pointer down/move/up without throwing', () => {
    // create handlers with minimal store-aware deps
    const handlers = createPointerHandlers({
      ...baseDeps,
      storeApi: {
        getState: () => ({
          tool: 'brush',
          currentTool: 'brush',
          isPointerDown: false,
          isDrawing: false,
          project: { width: 10, height: 10 },
          canvas: { width: 10, height: 10, scale: 1, offsetX: 0, offsetY: 0 },
          layers: [],
          activeLayerId: null,
          ui: { modal: null },
          selection: { marquee: null },
          setIsPointerDown: jest.fn(),
          setIsDrawing: jest.fn(),
          setCanvasInteraction: jest.fn(),
          setActiveLayerId: jest.fn(),
          setStrokeInProgress: jest.fn(),
          setStrokeBounds: jest.fn(),
        }),
      },
    });

    const { getByTestId } = render(<CanvasHost handlers={handlers} />);
    const canvas = getByTestId('canvas');

    fireEvent.pointerDown(canvas, { clientX: 5, clientY: 5, button: 0, pointerId: 1 });
    fireEvent.pointerMove(canvas, { clientX: 8, clientY: 8, buttons: 1, pointerId: 1 });
    fireEvent.pointerUp(canvas, { clientX: 8, clientY: 8, button: 0, pointerId: 1 });

    // Smoke only: absence of throw is success.
    expect(true).toBe(true);
  });
});
