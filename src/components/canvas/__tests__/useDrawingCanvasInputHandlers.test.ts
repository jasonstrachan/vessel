import React from 'react';
import { renderHook } from '@testing-library/react';
import { useDrawingCanvasInputHandlers } from '@/components/canvas/useDrawingCanvasInputHandlers';
import { BrushShape } from '@/types';

const mockUseCanvasEventHandlers = jest.fn();
const mockUseDrawingCanvasPointerHandlers = jest.fn();
const mockUseDrawingCanvasEventBindings = jest.fn();

jest.mock('@/hooks/canvas/useCanvasEventHandlers', () => ({
  useCanvasEventHandlers: (...args: unknown[]) => mockUseCanvasEventHandlers(...args),
}));

jest.mock('@/components/canvas/useDrawingCanvasPointerHandlers', () => ({
  useDrawingCanvasPointerHandlers: (...args: unknown[]) => mockUseDrawingCanvasPointerHandlers(...args),
}));

jest.mock('@/components/canvas/useDrawingCanvasEventBindings', () => ({
  useDrawingCanvasEventBindings: (...args: unknown[]) => mockUseDrawingCanvasEventBindings(...args),
}));

type InputHandlerOptions = Parameters<typeof useDrawingCanvasInputHandlers>[0];

const buildTools = (
  overrides: Partial<InputHandlerOptions['tools']> = {}
): InputHandlerOptions['tools'] =>
  ({
    currentTool: 'brush',
    selectionMode: 'marquee',
    brushSettings: {} as InputHandlerOptions['tools']['brushSettings'],
    fillSettings: { threshold: 0, contiguous: true, eraseInstead: false },
    wandSettings: { threshold: 0, contiguous: true },
    eraserSettings: {},
    shapeMode: false,
    customBrushCapture: { mode: 'rectangle', sampleAllLayers: false },
    ...overrides,
  }) as InputHandlerOptions['tools'];

const buildOptions = (overrides: Partial<InputHandlerOptions> = {}): InputHandlerOptions =>
  ({
    wrapperRef: { current: document.createElement('div') } as React.RefObject<HTMLDivElement>,
    canvasRef: { current: document.createElement('canvas') } as React.RefObject<HTMLCanvasElement>,
    project: { width: 640, height: 480 },
    tools: buildTools(),
    currentBrushPresetId: null,
    pointerOptions: {
      canvasShapeEditorActive: false,
      isSpacePressedRef: { current: false },
      getWorldPointFromPointerEvent: () => ({ x: 10, y: 10 }),
      isWorldPointInsideCanvasShape: () => false,
      handleCanvasShapePointerDown: jest.fn(),
      handleCanvasShapePointerMove: jest.fn(),
      handleCanvasShapePointerUp: jest.fn(),
      cancelCanvasShapePointer: jest.fn(),
    },
    setCustomBrushFreehandPath: jest.fn(),
    updateFloatingPastePosition: jest.fn(),
    canvasZoom: 1,
    defaultCursorStyle: 'crosshair',
    brushShape: BrushShape.ROUND,
    wrappedStartAnimation: jest.fn(),
    isColorCyclePlaybackActive: () => false,
    ...overrides,
  }) as InputHandlerOptions;

describe('useDrawingCanvasInputHandlers', () => {
  beforeEach(() => {
    mockUseCanvasEventHandlers.mockReset();
    mockUseDrawingCanvasPointerHandlers.mockReset();
    mockUseDrawingCanvasEventBindings.mockReset();

    mockUseCanvasEventHandlers.mockReturnValue({
      handlePointerDown: jest.fn(),
      handlePointerMove: jest.fn(),
      handlePointerUp: jest.fn(),
      handlePointerEnter: jest.fn(),
      handlePointerLeave: jest.fn(),
      handlePointerCancel: jest.fn(),
      handleKeyDown: jest.fn(),
      handleKeyUp: jest.fn(),
      handleWheel: jest.fn(),
      handlePaste: jest.fn(),
      handleBlur: jest.fn(),
    });

    mockUseDrawingCanvasPointerHandlers.mockReturnValue({
      handlePointerDown: jest.fn(),
      handlePointerMove: jest.fn(),
      handlePointerUp: jest.fn(),
      handlePointerEnter: jest.fn(),
      handlePointerLeave: jest.fn(),
      handlePointerCancel: jest.fn(),
    });
  });

  it('allows pointer down outside canvas shape for marquee selection', () => {
    renderHook(() =>
      useDrawingCanvasInputHandlers(
        buildOptions({
          tools: buildTools({ currentTool: 'selection' }),
        })
      )
    );

    expect(mockUseDrawingCanvasPointerHandlers).toHaveBeenCalled();
    expect(
      mockUseDrawingCanvasPointerHandlers.mock.calls.at(-1)?.[0]?.allowPointerDownOutsideCanvasShape
    ).toBe(true);
  });

  it('allows pointer down outside canvas shape for dither shape mode', () => {
    renderHook(() =>
      useDrawingCanvasInputHandlers(
        buildOptions({
          tools: buildTools({ shapeMode: true }),
          currentBrushPresetId: 'dither-shape',
        })
      )
    );

    expect(
      mockUseDrawingCanvasPointerHandlers.mock.calls.at(-1)?.[0]?.allowPointerDownOutsideCanvasShape
    ).toBe(true);
  });

  it('allows pointer down outside canvas shape for color-cycle-gradient shape mode', () => {
    renderHook(() =>
      useDrawingCanvasInputHandlers(
        buildOptions({
          tools: buildTools({ shapeMode: true }),
          currentBrushPresetId: 'color-cycle-gradient',
        })
      )
    );

    expect(
      mockUseDrawingCanvasPointerHandlers.mock.calls.at(-1)?.[0]?.allowPointerDownOutsideCanvasShape
    ).toBe(true);
  });

  it('keeps outside pointer-down blocked for non-shape brush presets', () => {
    renderHook(() =>
      useDrawingCanvasInputHandlers(
        buildOptions({
          tools: buildTools({ shapeMode: false }),
          currentBrushPresetId: 'dither-shape',
        })
      )
    );

    expect(
      mockUseDrawingCanvasPointerHandlers.mock.calls.at(-1)?.[0]?.allowPointerDownOutsideCanvasShape
    ).toBe(false);
  });
});
