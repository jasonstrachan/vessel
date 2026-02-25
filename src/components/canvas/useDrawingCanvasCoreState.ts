import { useRef, useState } from 'react';
import type { BrushCursorHandle } from './BrushCursor';
import type { ColorCycleBrushManager } from '@/stores/colorCycleBrushManager';

export const useDrawingCanvasCoreState = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const isBusyRef = useRef(false);
  const isMouseDownRef = useRef(false);
  const drawAnimationFrameRef = useRef<number | null>(null);
  const pointerMoveThrottled = useRef<number>(0);
  const colorCycleBrushManagerRef = useRef<ColorCycleBrushManager | null>(null);

  const mousePositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [showBrushCursor, setShowBrushCursor] = useState(false);
  const [marchingAntsOffset, setMarchingAntsOffset] = useState(0);
  const brushCursorHandleRef = useRef<BrushCursorHandle | null>(null);

  const checkerPatternCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const checkerPatternCacheRef = useRef<WeakMap<CanvasRenderingContext2D, CanvasPattern | null>>(new WeakMap());
  const isZoomingRef = useRef(false);
  const zoomEndTimeoutRef = useRef<number | null>(null);
  const hasWarnedColorCycleWorkerRef = useRef(false);

  return {
    canvasRef,
    wrapperRef,
    isBusyRef,
    isMouseDownRef,
    drawAnimationFrameRef,
    pointerMoveThrottled,
    colorCycleBrushManagerRef,
    mousePositionRef,
    showBrushCursor,
    setShowBrushCursor,
    marchingAntsOffset,
    setMarchingAntsOffset,
    brushCursorHandleRef,
    checkerPatternCanvasRef,
    checkerPatternCacheRef,
    isZoomingRef,
    zoomEndTimeoutRef,
    hasWarnedColorCycleWorkerRef,
  };
};
