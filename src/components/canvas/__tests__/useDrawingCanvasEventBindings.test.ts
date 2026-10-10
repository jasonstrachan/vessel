import { renderHook } from '@testing-library/react';

import { useDrawingCanvasEventBindings } from '@/components/canvas/useDrawingCanvasEventBindings';

type Options = Parameters<typeof useDrawingCanvasEventBindings>[0];

const createOptions = (): Options => ({
  eventHandleMouseDown: jest.fn(),
  eventHandleKeyDown: jest.fn(),
  eventHandleKeyUp: jest.fn(),
  eventHandleWheel: jest.fn(),
  eventHandlePaste: jest.fn(),
  wrapperRef: { current: document.createElement('div') },
  canvasRef: { current: document.createElement('canvas') },
});

describe('useDrawingCanvasEventBindings native mouse intake', () => {
  it('forwards actual bubbling mouse events once with native click count and cleans up', () => {
    const options = createOptions();
    const wrapper = options.wrapperRef.current!;
    const canvas = options.canvasRef.current!;
    wrapper.appendChild(canvas);
    const { unmount } = renderHook(() => useDrawingCanvasEventBindings(options));
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true, detail: 2 });
    canvas.dispatchEvent(event);
    expect(options.eventHandleMouseDown).toHaveBeenCalledTimes(1);
    expect(options.eventHandleMouseDown).toHaveBeenCalledWith(event);
    expect(event.detail).toBe(2);
    unmount();
    canvas.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(options.eventHandleMouseDown).toHaveBeenCalledTimes(1);
  });

  it('replaces the callback without retaining the previous listener', () => {
    const options = createOptions();
    const nextHandler = jest.fn();
    const { rerender } = renderHook(({ input }) => useDrawingCanvasEventBindings(input), {
      initialProps: { input: options },
    });
    rerender({ input: { ...options, eventHandleMouseDown: nextHandler } });
    const event = new MouseEvent('mousedown', { bubbles: true, detail: 1 });
    options.wrapperRef.current!.dispatchEvent(event);
    expect(options.eventHandleMouseDown).not.toHaveBeenCalled();
    expect(nextHandler).toHaveBeenCalledTimes(1);
    expect(nextHandler).toHaveBeenCalledWith(event);
  });

  it('uses the canvas fallback and does not listen to unrelated targets', () => {
    const options = createOptions();
    options.wrapperRef.current = null;
    renderHook(() => useDrawingCanvasEventBindings(options));
    const event = new MouseEvent('mousedown', { bubbles: true, detail: 1 });
    options.canvasRef.current!.dispatchEvent(event);
    document.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(options.eventHandleMouseDown).toHaveBeenCalledTimes(1);
    expect(options.eventHandleMouseDown).toHaveBeenCalledWith(event);
  });
});
