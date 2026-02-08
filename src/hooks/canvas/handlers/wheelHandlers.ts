import { MAX_CANVAS_ZOOM, MIN_CANVAS_ZOOM } from '@/constants/canvas';
import { viewPerformanceTracker } from '@/utils/viewPerformanceTracker';
import type { EventHandlerDependencies, WheelHandlers } from '../utils/types';

interface WheelHandlerResult extends Pick<WheelHandlers, 'handleWheel'> {
  cleanup: () => void;
}

export const createWheelHandlers = (deps: EventHandlerDependencies): WheelHandlerResult => {
  const shouldMeasure = process.env.NODE_ENV !== 'production';

  const handleWheel = (event: WheelEvent) => {
    if (!deps.setZoom || !deps.setPan) {
      return;
    }
    event.preventDefault();

    const { scale: currentScale, offsetX: currentOffsetX, offsetY: currentOffsetY } =
      deps.viewTransformRef.current;

    if (Math.abs(event.deltaY) > Math.abs(event.deltaX)) {
      const rect = deps.canvasRef.current?.getBoundingClientRect();
      if (!rect) {
        return;
      }

      const mouseX = event.clientX - rect.left;
      const mouseY = event.clientY - rect.top;
      const scrollSensitivity = 0.001;
      const zoomFactor = 1 - event.deltaY * scrollSensitivity;

      const newScale = Math.max(MIN_CANVAS_ZOOM, Math.min(currentScale * zoomFactor, MAX_CANVAS_ZOOM));
      if (Math.abs(newScale - currentScale) < 0.0001) {
        return;
      }

      const worldX = (mouseX - currentOffsetX) / currentScale;
      const worldY = (mouseY - currentOffsetY) / currentScale;
      const newOffsetX = mouseX - worldX * newScale;
      const newOffsetY = mouseY - worldY * newScale;

      if (shouldMeasure) {
        viewPerformanceTracker.startSession('zoom');
        const timeoutRef = deps.zoomEndTimeoutRef;
        if (deps.isZoomingRef) {
          deps.isZoomingRef.current = true;
        }
        if (timeoutRef?.current !== null && timeoutRef) {
          window.clearTimeout(timeoutRef.current);
        }
        if (timeoutRef) {
          timeoutRef.current = window.setTimeout(() => {
            if (deps.isZoomingRef) {
              deps.isZoomingRef.current = false;
            }
            viewPerformanceTracker.endSession('zoom');
            timeoutRef.current = null;
          }, 160);
        } else {
          window.setTimeout(() => {
            if (deps.isZoomingRef) {
              deps.isZoomingRef.current = false;
            }
            viewPerformanceTracker.endSession('zoom');
          }, 160);
        }
      }

      deps.setZoom(newScale);
      deps.setPan(newOffsetX, newOffsetY);
    }
  };

  const cleanup = () => {
    if (deps.zoomEndTimeoutRef?.current !== null && deps.zoomEndTimeoutRef) {
      window.clearTimeout(deps.zoomEndTimeoutRef.current);
      deps.zoomEndTimeoutRef.current = null;
    }
    if (deps.isZoomingRef) {
      deps.isZoomingRef.current = false;
    }
  };

  return {
    handleWheel,
    cleanup,
  };
};
