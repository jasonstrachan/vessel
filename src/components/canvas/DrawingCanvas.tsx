import React from 'react';
import { DrawingCanvasViewport } from './DrawingCanvasViewport';
import { useDrawingCanvasRuntime } from './useDrawingCanvasRuntime';
export { resolveBrushCursorShape } from './brushCursorShape';

interface DrawingCanvasProps {
  showFeedback?: (message: string) => void;
}

const DrawingCanvas: React.FC<DrawingCanvasProps> = ({ showFeedback }) => {
  const {
    wrapperRef,
    canvasRef,
    overlayCanvasRef,
    eventHandleBlur,
    handlePointerDown,
    handlePointerUp,
    handlePointerMove,
    handlePointerEnter,
    handlePointerLeave,
    handlePointerCancel,
    viewportProps,
  } = useDrawingCanvasRuntime({ showFeedback });

  return (
    <DrawingCanvasViewport
      wrapperRef={wrapperRef}
      canvasRef={canvasRef}
      overlayCanvasRef={overlayCanvasRef}
      onBlur={eventHandleBlur}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerMove={handlePointerMove}
      onPointerEnter={handlePointerEnter}
      onPointerLeave={handlePointerLeave}
      onPointerCancel={handlePointerCancel}
      {...viewportProps}
    />
  );
};

export default React.memo(DrawingCanvas);
