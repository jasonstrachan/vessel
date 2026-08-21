import { act, renderHook } from '@testing-library/react';
import { useDrawingCanvasUiEffects } from '@/components/canvas/useDrawingCanvasUiEffects';
import { CANVAS_FRAME_UPDATE_EVENT } from '@/hooks/canvas/handlers/animation/animationRuntime';

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

  it('lets the marching-ants state update own the redraw', () => {
    const canvas = document.createElement('canvas');
    const wrapper = document.createElement('div');
    const ctx = {} as CanvasRenderingContext2D;
    const draw = jest.fn();
    const setMarchingAntsOffset = jest.fn();
    const animationFrames: FrameRequestCallback[] = [];
    const requestAnimationFrameSpy = jest
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback) => {
        animationFrames.push(callback);
        return animationFrames.length;
      });
    const cancelAnimationFrameSpy = jest
      .spyOn(window, 'cancelAnimationFrame')
      .mockImplementation(() => undefined);

    getContextMock.mockReturnValue(ctx);
    canvas.getContext = getContextMock as typeof canvas.getContext;

    const { unmount } = renderHook(() =>
      useDrawingCanvasUiEffects({
        selectionStart: { x: 1, y: 1 },
        selectionEnd: { x: 10, y: 10 },
        floatingPaste: null,
        setMarchingAntsOffset,
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
      })
    );
    draw.mockClear();

    for (let frame = 0; frame < 3; frame += 1) {
      const callback = animationFrames.shift();
      expect(callback).toBeDefined();
      act(() => callback?.(frame * 16));
    }

    expect(setMarchingAntsOffset).toHaveBeenCalledTimes(1);
    expect(draw).not.toHaveBeenCalled();

    unmount();
    requestAnimationFrameSpy.mockRestore();
    cancelAnimationFrameSpy.mockRestore();
  });

  it('leaves legacy color-cycle frame updates to the redraw coalescer', () => {
    const canvas = document.createElement('canvas');
    const wrapper = document.createElement('div');
    const ctx = {} as CanvasRenderingContext2D;
    const draw = jest.fn();

    getContextMock.mockReturnValue(ctx);
    canvas.getContext = getContextMock as typeof canvas.getContext;

    renderHook(() =>
      useDrawingCanvasUiEffects({
        selectionStart: null,
        selectionEnd: null,
        floatingPaste: null,
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
      })
    );
    draw.mockClear();

    window.dispatchEvent(new CustomEvent('colorCycleFrameUpdate'));

    expect(draw).not.toHaveBeenCalled();
  });

  it('draws Interlace frames directly without a React redraw state update', () => {
    const canvas = document.createElement('canvas');
    const wrapper = document.createElement('div');
    const ctx = {} as CanvasRenderingContext2D;
    const draw = jest.fn();

    getContextMock.mockReturnValue(ctx);
    canvas.getContext = getContextMock as typeof canvas.getContext;

    renderHook(() =>
      useDrawingCanvasUiEffects({
        selectionStart: null,
        selectionEnd: null,
        floatingPaste: null,
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
      })
    );
    draw.mockClear();

    window.dispatchEvent(new CustomEvent(CANVAS_FRAME_UPDATE_EVENT));

    expect(draw).toHaveBeenCalledTimes(1);
    expect(draw).toHaveBeenCalledWith(ctx, { scale: 1, offsetX: 0, offsetY: 0 });
  });
});
