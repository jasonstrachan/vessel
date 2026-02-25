import { useLayoutEffect } from 'react';

interface UseDrawingCanvasViewportTrackingOptions {
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  setCanvasViewport: (viewport: { left: number; top: number; width: number; height: number }) => void;
}

export const useDrawingCanvasViewportTracking = ({
  wrapperRef,
  setCanvasViewport,
}: UseDrawingCanvasViewportTrackingOptions) => {
  useLayoutEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    const updateViewport = () => {
      const wrapper = wrapperRef.current;
      if (!wrapper) {
        return;
      }
      const rect = wrapper.getBoundingClientRect();
      setCanvasViewport({
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
      });
    };

    updateViewport();

    const wrapper = wrapperRef.current;
    let resizeObserver: ResizeObserver | null = null;
    if (wrapper && typeof ResizeObserver !== 'undefined') {
      resizeObserver = new ResizeObserver(() => {
        updateViewport();
      });
      resizeObserver.observe(wrapper);
    }

    window.addEventListener('resize', updateViewport);
    window.addEventListener('scroll', updateViewport, true);

    return () => {
      resizeObserver?.disconnect();
      window.removeEventListener('resize', updateViewport);
      window.removeEventListener('scroll', updateViewport, true);
    };
  }, [setCanvasViewport, wrapperRef]);
};
