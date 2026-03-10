import { renderHook } from '@testing-library/react';
import { useDrawingCanvasUiEffects } from '@/components/canvas/useDrawingCanvasUiEffects';

const setSequentialPointerDown = jest.fn();

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: () => ({
      setSequentialPointerDown,
    }),
  },
}));

describe('useDrawingCanvasUiEffects', () => {
  const originalHiddenDescriptor = Object.getOwnPropertyDescriptor(document, 'hidden');
  const getContextMock = jest.fn();

  beforeEach(() => {
    setSequentialPointerDown.mockClear();
    getContextMock.mockReset();
  });

  afterEach(() => {
    if (originalHiddenDescriptor) {
      Object.defineProperty(document, 'hidden', originalHiddenDescriptor);
    }
  });

  it('clears sequential pointer state on blur and hidden visibility', () => {
    const canvas = document.createElement('canvas');
    const wrapper = document.createElement('div');
    renderHook(() =>
      useDrawingCanvasUiEffects({
        selectionStart: null,
        selectionEnd: null,
        floatingPaste: null,
        setMarchingAntsOffset: jest.fn(),
        canvasRef: { current: canvas },
        draw: jest.fn(),
        viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
        defaultCursorStyle: 'default',
        isPointerInsideCanvas: () => false,
        setCursorStyle: jest.fn(),
        setShowBrushCursor: jest.fn(),
        wrapperRef: { current: wrapper },
        mode: 'IDLE',
        canvasZoom: 1,
        canvasOffsetX: 0,
        canvasOffsetY: 0,
        needsRedraw: 0,
      })
    );

    window.dispatchEvent(new Event('blur'));
    expect(setSequentialPointerDown).toHaveBeenCalledWith(false);

    Object.defineProperty(document, 'hidden', {
      configurable: true,
      value: true,
    });
    document.dispatchEvent(new Event('visibilitychange'));
    expect(setSequentialPointerDown).toHaveBeenCalledWith(false);
  });

  it('restores cursor UI on blur even when state machine is not in space mode', () => {
    const canvas = document.createElement('canvas');
    const wrapper = document.createElement('div');
    const setCursorStyle = jest.fn();
    const setShowBrushCursor = jest.fn();

    renderHook(() =>
      useDrawingCanvasUiEffects({
        selectionStart: null,
        selectionEnd: null,
        floatingPaste: null,
        setMarchingAntsOffset: jest.fn(),
        canvasRef: { current: canvas },
        draw: jest.fn(),
        viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
        defaultCursorStyle: 'none',
        isPointerInsideCanvas: () => true,
        setCursorStyle,
        setShowBrushCursor,
        wrapperRef: { current: wrapper },
        mode: 'IDLE',
        canvasZoom: 1,
        canvasOffsetX: 0,
        canvasOffsetY: 0,
        needsRedraw: 0,
      })
    );

    window.dispatchEvent(new Event('blur'));

    expect(setCursorStyle).toHaveBeenCalledWith('none');
    expect(setShowBrushCursor).toHaveBeenCalledWith(true);
  });

  it('redraws when floating paste changes position', () => {
    const canvas = document.createElement('canvas');
    const wrapper = document.createElement('div');
    const ctx = {} as CanvasRenderingContext2D;
    const draw = jest.fn();

    getContextMock.mockReturnValue(ctx);
    canvas.getContext = getContextMock as typeof canvas.getContext;

    const { rerender } = renderHook(
      ({ floatingPaste }) =>
        useDrawingCanvasUiEffects({
          selectionStart: null,
          selectionEnd: null,
          floatingPaste,
          setMarchingAntsOffset: jest.fn(),
          canvasRef: { current: canvas },
          draw,
          viewTransformRef: { current: { scale: 1, offsetX: 0, offsetY: 0 } },
          defaultCursorStyle: 'default',
          isPointerInsideCanvas: () => true,
          setCursorStyle: jest.fn(),
          setShowBrushCursor: jest.fn(),
          wrapperRef: { current: wrapper },
          mode: 'IDLE',
          canvasZoom: 1,
          canvasOffsetX: 0,
          canvasOffsetY: 0,
          needsRedraw: 0,
        }),
      {
        initialProps: {
          floatingPaste: { position: { x: 1, y: 1 } },
        },
      }
    );

    expect(draw).toHaveBeenCalledTimes(1);

    rerender({
      floatingPaste: { position: { x: 2, y: 1 } },
    });

    expect(draw).toHaveBeenCalledTimes(2);
    expect(draw).toHaveBeenLastCalledWith(ctx, { scale: 1, offsetX: 0, offsetY: 0 });
  });
});
