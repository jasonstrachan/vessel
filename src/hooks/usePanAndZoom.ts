import { useState, useRef, useCallback, useEffect } from 'react';
import { useAppStore } from '../stores/useAppStore';

interface ViewTransform {
  scale: number;
  offsetX: number;
  offsetY: number;
}

interface UsePanAndZoomProps {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  wrapperRef: React.RefObject<HTMLDivElement>;
  draw: (ctx: CanvasRenderingContext2D, transform: ViewTransform) => void;
}

export function usePanAndZoom({ canvasRef, wrapperRef, draw }: UsePanAndZoomProps) {
  const { canvas, project, setZoom, setPan } = useAppStore();
  
  // View transformation state
  const [viewTransform, setViewTransform] = useState<ViewTransform>({
    scale: canvas?.zoom || 1,
    offsetX: canvas?.panX || 0,
    offsetY: canvas?.panY || 0,
  });
  
  // Ref for immediate updates during interaction
  const viewTransformRef = useRef<ViewTransform>({
    scale: canvas?.zoom || 1,
    offsetX: canvas?.panX || 0,
    offsetY: canvas?.panY || 0,
  });
  
  // Update view transform when canvas state changes
  useEffect(() => {
    if (canvas) {
      const newTransform = {
        scale: canvas.zoom,
        offsetX: canvas.panX,
        offsetY: canvas.panY,
      };
      setViewTransform(newTransform);
      viewTransformRef.current = newTransform;
    }
  }, [canvas?.zoom, canvas?.panX, canvas?.panY]);
  
  // Handle wheel zoom
  const handleWheel = useCallback((event: WheelEvent) => {
    event.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    const canvasEl = canvasRef.current;
    if (!rect || !canvasEl) return;
    
    const mouseX = event.clientX - rect.left;
    const mouseY = event.clientY - rect.top;
    
    const scrollSensitivity = 0.001;
    const zoomFactor = 1 - event.deltaY * scrollSensitivity;
    const newScale = Math.max(0.1, Math.min(viewTransformRef.current.scale * zoomFactor, 10));
    
    // Calculate world position under mouse before zoom
    const worldX = (mouseX - viewTransformRef.current.offsetX) / viewTransformRef.current.scale;
    const worldY = (mouseY - viewTransformRef.current.offsetY) / viewTransformRef.current.scale;
    
    // Calculate new offset to keep world position under mouse
    const newOffsetX = mouseX - worldX * newScale;
    const newOffsetY = mouseY - worldY * newScale;
    
    // Update ref immediately for smooth rendering
    viewTransformRef.current = {
      scale: newScale,
      offsetX: newOffsetX,
      offsetY: newOffsetY,
    };
    
    // Draw immediately with new transform
    const ctx = canvasEl.getContext('2d');
    if (ctx) {
      draw(ctx, viewTransformRef.current);
    }
    
    // Update state and store
    setViewTransform(viewTransformRef.current);
    setZoom(newScale);
    setPan(newOffsetX, newOffsetY);
  }, [canvasRef, draw, setZoom, setPan]);
  
  // Pan to center canvas on mount
  const centerCanvas = useCallback(() => {
    if (canvas && project && wrapperRef.current) {
      // Only center if we haven't panned yet
      if (canvas.panX === 0 && canvas.panY === 0) {
        const viewport = wrapperRef.current.getBoundingClientRect();
        const centerX = (viewport.width - project.width * canvas.zoom) / 2;
        const centerY = (viewport.height - project.height * canvas.zoom) / 2;
        
        const transform = {
          scale: canvas.zoom,
          offsetX: centerX,
          offsetY: centerY,
        };
        
        setViewTransform(transform);
        viewTransformRef.current = transform;
        setPan(centerX, centerY);
      }
    }
  }, [canvas, project, wrapperRef, setPan]);
  
  // Convert screen to world coordinates
  const screenToWorld = useCallback((x: number, y: number) => {
    const { offsetX, offsetY, scale } = viewTransformRef.current;
    return {
      x: (x - offsetX) / scale,
      y: (y - offsetY) / scale,
    };
  }, []);
  
  // Update pan during mouse move
  const updatePan = useCallback((deltaX: number, deltaY: number, startOffset: { x: number; y: number }) => {
    const newTransform = {
      scale: viewTransformRef.current.scale,
      offsetX: startOffset.x + deltaX,
      offsetY: startOffset.y + deltaY,
    };
    
    viewTransformRef.current = newTransform;
    
    // Draw with new transform
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (ctx) {
      draw(ctx, newTransform);
    }
    
    return newTransform;
  }, [canvasRef, draw]);
  
  // Finalize pan
  const finalizePan = useCallback(() => {
    setViewTransform(viewTransformRef.current);
    setPan(viewTransformRef.current.offsetX, viewTransformRef.current.offsetY);
  }, [setPan]);
  
  return {
    viewTransform,
    viewTransformRef,
    screenToWorld,
    handleWheel,
    centerCanvas,
    updatePan,
    finalizePan,
  };
}