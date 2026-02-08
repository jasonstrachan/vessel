import { useRef, useState } from 'react';
import type { Layer } from '@/types';
import type { CompositeSegment } from '@/stores/slices/layersSlice';

export const useDrawingCanvasCompositeRuntimeState = () => {
  const [isDraggingFloatingPaste, setIsDraggingFloatingPaste] = useState(false);
  const floatingPasteDragStart = useRef<{ x: number; y: number } | null>(null);
  const floatingPasteOriginalPos = useRef<{ x: number; y: number } | null>(null);

  const compositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const compositeCanvasDirtyRef = useRef(true);
  const lastCompositeHashRef = useRef<string>('');
  const lastActiveLayerIdRef = useRef<string | null>(null);
  const [needsRedraw, setNeedsRedraw] = useState(0);
  const hadSelectionRef = useRef(false);

  const underCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const overCompositeCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const underCompositeHasContentRef = useRef(false);
  const overCompositeHasContentRef = useRef(false);
  const layerTransferCacheRef = useRef<Map<string, HTMLCanvasElement | OffscreenCanvas>>(new Map());
  const compositeSegmentsRef = useRef<CompositeSegment[]>([]);
  const layerMapRef = useRef<Map<string, Layer>>(new Map());
  const pendingColorCycleRefreshRef = useRef(false);

  const pasteCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lastPasteInfoRef = useRef<{ imageData: ImageData | null; width: number; height: number }>({
    imageData: null,
    width: 0,
    height: 0,
  });

  return {
    isDraggingFloatingPaste,
    setIsDraggingFloatingPaste,
    floatingPasteDragStart,
    floatingPasteOriginalPos,
    compositeCanvasRef,
    compositeCanvasDirtyRef,
    lastCompositeHashRef,
    lastActiveLayerIdRef,
    needsRedraw,
    setNeedsRedraw,
    hadSelectionRef,
    underCompositeCanvasRef,
    overCompositeCanvasRef,
    underCompositeHasContentRef,
    overCompositeHasContentRef,
    layerTransferCacheRef,
    compositeSegmentsRef,
    layerMapRef,
    pendingColorCycleRefreshRef,
    pasteCanvasRef,
    lastPasteInfoRef,
  };
};
