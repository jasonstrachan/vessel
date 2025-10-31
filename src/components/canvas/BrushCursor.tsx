'use client';

import React, {
  forwardRef,
  memo,
  useCallback,
  useImperativeHandle,
  useLayoutEffect,
  useMemo,
  useRef,
} from 'react';
import { BrushShape } from '../../types';

interface BrushCursorProps {
  size: number;
  brushShape: BrushShape;
  zoom: number;
  color: string;
  customBrush?: {
    imageData: ImageData;
    width: number;
    height: number;
  } | null;
  visible: boolean;
}

export interface BrushCursorHandle {
  setPosition: (screenX: number, screenY: number) => void;
}

// Cache for cursor data URLs to prevent recreation
const cursorCache = new Map<string, string>();

// Helper to generate a cached data URL for the cursor canvas
const useCursorDataURL = (
  brushShape: BrushShape,
  screenSize: number
) => {
  return useMemo(() => {
    if (brushShape === BrushShape.CUSTOM) return null;
    
    // Only run in browser environment
    if (typeof document === 'undefined') return null;

    // Check cache first
    const cacheKey = `${brushShape}-${Math.ceil(screenSize)}`;
    const cached = cursorCache.get(cacheKey);
    if (cached) return cached;

    const canvas = document.createElement('canvas');
    const size = Math.ceil(screenSize); // No extra padding needed
    canvas.width = size;
    canvas.height = size;
    
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) return '';

    // Simple white stroke, will use mix-blend-mode in CSS
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    
    const center = size / 2;
    const radius = Math.max(0.5, (screenSize - ctx.lineWidth) / 2);

    ctx.beginPath();

    switch (brushShape) {
      case BrushShape.ROUND:
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        break;
      case BrushShape.SQUARE:
      case BrushShape.PIXEL_ROUND:
      case BrushShape.RECTANGLE_GRADIENT:
      case BrushShape.RESAMPLER:
      case BrushShape.COLOR_CYCLE: // Color cycle now uses square stamps
        ctx.rect(center - radius, center - radius, screenSize - ctx.lineWidth, screenSize - ctx.lineWidth);
        break;
      case BrushShape.COLOR_CYCLE_TRIANGLE:
        ctx.moveTo(center, center - radius);
        ctx.lineTo(center - radius, center + radius);
        ctx.lineTo(center + radius, center + radius);
        ctx.closePath();
        break;
      case BrushShape.TRIANGLE:
      case BrushShape.POLYGON_GRADIENT:
      case BrushShape.COLOR_CYCLE_SHAPE:
        // Draw a hexagon for polygon gradient and color cycle shape
        const sides = 6;
        ctx.moveTo(center + radius, center);
        for (let i = 1; i <= sides; i++) {
          const angle = (i * 2 * Math.PI) / sides;
          ctx.lineTo(center + radius * Math.cos(angle), center + radius * Math.sin(angle));
        }
        ctx.closePath();
        break;
    }
    
    ctx.stroke();
    
    const dataUrl = canvas.toDataURL();
    
    // Cache the result (limit cache size)
    if (cursorCache.size > 50) {
      const firstKey = cursorCache.keys().next().value;
      if (firstKey !== undefined) {
        cursorCache.delete(firstKey);
      }
    }
    cursorCache.set(cacheKey, dataUrl);
    
    return dataUrl;
  }, [brushShape, screenSize]);
};

const BrushCursorComponent = ({
  size,
  brushShape,
  zoom,
  visible,
  customBrush,
}: BrushCursorProps, ref: React.Ref<BrushCursorHandle>) => {
  const cursorRef = useRef<HTMLDivElement>(null);
  const lastPositionRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

  // Calculate screen size differently for custom brushes (percentage) vs regular brushes (pixels)
  const screenSize = brushShape === BrushShape.CUSTOM && customBrush
    ? Math.max(4, (size / 100) * Math.max(customBrush.width, customBrush.height) * zoom)
    : Math.max(4, size * zoom);

  const cursorDataURL = useCursorDataURL(brushShape, screenSize);

  const applyTransform = useCallback((screenX: number, screenY: number) => {
    lastPositionRef.current = { x: screenX, y: screenY };
    const element = cursorRef.current;
    if (!element) return;

    const half = Math.ceil(screenSize) / 2;
    element.style.transform = `translate(${screenX - half}px, ${screenY - half}px)`;
  }, [screenSize]);

  useImperativeHandle(ref, () => ({
    setPosition: (screenX: number, screenY: number) => {
      applyTransform(screenX, screenY);
    }
  }), [applyTransform]);

  useLayoutEffect(() => {
    if (!visible) return;
    const { x, y } = lastPositionRef.current;
    applyTransform(x, y);
  }, [applyTransform, visible]);

  if (!visible) return null;

  // Show a box outline for custom brushes to indicate size
  if (brushShape === BrushShape.CUSTOM) {
    return (
      <div
        ref={cursorRef}
        className="pointer-events-none fixed"
        style={{
          left: 0,
          top: 0,
          width: `${Math.ceil(screenSize)}px`,
          height: `${Math.ceil(screenSize)}px`,
          zIndex: 1000,
          border: '1px solid white',
          mixBlendMode: 'difference',
        }}
      />
    );
  }

  // Render the fast, pre-baked cursor image for default brushes
  return (
    <div
      ref={cursorRef}
      className="pointer-events-none fixed"
      style={{
        left: 0,
        top: 0,
        width: `${Math.ceil(screenSize)}px`,
        height: `${Math.ceil(screenSize)}px`,
        zIndex: 1000,
        mixBlendMode: 'difference',
        imageRendering: 'pixelated',
        backgroundImage: cursorDataURL ? `url(${cursorDataURL})` : 'none',
        backgroundSize: 'contain',
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'center',
      }}
    />
  );
};

const BrushCursor = memo(forwardRef<BrushCursorHandle, BrushCursorProps>(BrushCursorComponent));

export default BrushCursor;
