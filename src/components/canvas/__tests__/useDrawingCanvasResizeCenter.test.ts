import { renderHook } from '@testing-library/react';
import type React from 'react';

import { useDrawingCanvasResizeCenter } from '@/components/canvas/useDrawingCanvasResizeCenter';

class ResizeObserverMock {
  observe = jest.fn();
  disconnect = jest.fn();
}

describe('useDrawingCanvasResizeCenter', () => {
  beforeAll(() => {
    global.ResizeObserver = ResizeObserverMock as unknown as typeof ResizeObserver;
  });

  it('centres each new project once in the canvas viewport', () => {
    const context = {} as CanvasRenderingContext2D;
    const canvas = {
      width: 1000,
      height: 800,
      getContext: jest.fn(() => context),
    } as unknown as HTMLCanvasElement;
    const wrapper = {
      getBoundingClientRect: jest.fn(() => ({
        width: 1000,
        height: 800,
      })),
    } as unknown as HTMLDivElement;
    const overlayCanvas = {
      width: 1000,
      height: 800,
    } as HTMLCanvasElement;
    const canvasRef = { current: canvas } as React.RefObject<HTMLCanvasElement>;
    const wrapperRef = { current: wrapper } as React.RefObject<HTMLDivElement>;
    const overlayCanvasRef = { current: overlayCanvas } as React.RefObject<HTMLCanvasElement>;
    const devicePixelRatioRef = { current: 1 };
    const draw = jest.fn();
    const drawRef = { current: draw };
    const viewTransformRef = {
      current: { scale: 1, offsetX: 0, offsetY: 0 },
    };
    const hasCenteredRef = { current: false };
    const setCanvasDimensions = jest.fn();
    const setPan = jest.fn();

    const { rerender } = renderHook(
      ({ project }) =>
        useDrawingCanvasResizeCenter({
          canvasRef,
          wrapperRef,
          overlayCanvasRef,
          devicePixelRatioRef,
          drawRef,
          viewTransformRef,
          hasCenteredRef,
          project,
          setCanvasDimensions,
          setPan,
        }),
      {
        initialProps: {
          project: { id: 'project-1', width: 200, height: 100 },
        },
      },
    );

    expect(setPan).toHaveBeenLastCalledWith(400, 350);
    expect(hasCenteredRef.current).toBe(true);

    setPan.mockClear();
    rerender({ project: { id: 'project-1', width: 200, height: 100 } });
    expect(setPan).not.toHaveBeenCalled();

    rerender({ project: { id: 'project-2', width: 100, height: 200 } });
    expect(setPan).toHaveBeenLastCalledWith(450, 300);
    expect(hasCenteredRef.current).toBe(true);
  });
});
