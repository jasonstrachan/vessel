import { act, renderHook } from '@testing-library/react';
import type React from 'react';

import { usePreviewViewportPanZoom } from '@/components/modals/hooks/usePreviewViewportPanZoom';
import type { ProjectPreview } from '@/components/modals/types';

const preview: ProjectPreview = {
  projectName: 'Large artwork',
  width: 512,
  height: 512,
  thumbnail: 'data:image/png;base64,preview',
  hasEmbeddedThumbnail: true,
  fileName: 'large.vs',
  fileSize: 1024,
};

describe('usePreviewViewportPanZoom', () => {
  const animationFrames: FrameRequestCallback[] = [];

  beforeEach(() => {
    animationFrames.length = 0;
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrames.push(callback);
      return animationFrames.length;
    });
    jest.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const flushAnimationFrames = () => {
    act(() => {
      while (animationFrames.length > 0) {
        animationFrames.shift()?.(performance.now());
      }
    });
  };

  it('fits and centers a preview as soon as its viewport is measurable', () => {
    const { result, rerender } = renderHook(
      ({ modalWidth }) => usePreviewViewportPanZoom({
        preview,
        modalWidth,
        modalHeight: 800,
      }),
      { initialProps: { modalWidth: 900 } },
    );
    const wrapper = {
      getBoundingClientRect: () => ({ width: 630, height: 260 }),
    } as HTMLDivElement;

    act(() => {
      result.current.previewWrapperRef.current = wrapper;
      rerender({ modalWidth: 901 });
    });
    flushAnimationFrames();

    expect(result.current.previewScale).toBeCloseTo(260 / 512);
    expect(result.current.previewOffset).toEqual({ x: 185, y: 0 });
  });

  it('does not schedule a recenter merely because panning state changes', () => {
    const pointerCapture = new Set<number>();
    const wrapper = {
      getBoundingClientRect: () => ({ width: 200, height: 200 }),
      setPointerCapture: (pointerId: number) => pointerCapture.add(pointerId),
      hasPointerCapture: (pointerId: number) => pointerCapture.has(pointerId),
      releasePointerCapture: (pointerId: number) => pointerCapture.delete(pointerId),
    } as unknown as HTMLDivElement;
    const { result, rerender } = renderHook(
      ({ modalWidth }) => usePreviewViewportPanZoom({
        preview,
        modalWidth,
        modalHeight: 800,
      }),
      { initialProps: { modalWidth: 900 } },
    );

    act(() => {
      result.current.previewWrapperRef.current = wrapper;
      rerender({ modalWidth: 901 });
    });
    flushAnimationFrames();

    act(() => {
      result.current.handlePreviewPointerDown({
        button: 0,
        clientX: 100,
        clientY: 100,
        pointerId: 7,
        preventDefault: jest.fn(),
      } as unknown as React.PointerEvent<HTMLDivElement>);
      result.current.handlePreviewPointerUp({
        pointerId: 7,
      } as unknown as React.PointerEvent<HTMLDivElement>);
    });

    expect(animationFrames).toHaveLength(0);
  });
});
