'use client';

import React, { memo, useMemo, useRef, useEffect } from 'react';
import Image from 'next/image';
import { BrushShape } from '../../types';

interface BrushCursorProps {
  screenX: number;
  screenY: number;
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

// Helper to generate a cached data URL for the cursor canvas
const useCursorDataURL = (
  brushShape: BrushShape,
  screenSize: number
) => {
  return useMemo(() => {
    if (brushShape === BrushShape.CUSTOM) return null;
    
    // Only run in browser environment
    if (typeof document === 'undefined') return null;

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
      case BrushShape.PIXEL_ROUND:
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        break;
      case BrushShape.SQUARE:
      case BrushShape.PIXEL:
        ctx.rect(center - radius, center - radius, screenSize - ctx.lineWidth, screenSize - ctx.lineWidth);
        break;
      case BrushShape.TRIANGLE:
        ctx.moveTo(center, center - radius);
        ctx.lineTo(center + radius, center + radius);
        ctx.lineTo(center - radius, center + radius);
        ctx.closePath();
        break;
    }
    
    ctx.stroke();
    
    return canvas.toDataURL();
  }, [brushShape, screenSize]);
};

const BrushCursor = memo(function BrushCursor({
  screenX,
  screenY,
  size,
  brushShape,
  zoom,
  visible,
  customBrush,
}: BrushCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  
  // Calculate screen size differently for custom brushes (percentage) vs regular brushes (pixels)
  const screenSize = brushShape === BrushShape.CUSTOM && customBrush
    ? Math.max(4, (size / 100) * Math.max(customBrush.width, customBrush.height) * zoom)
    : Math.max(4, size * zoom);
    
  const cursorDataURL = useCursorDataURL(brushShape, screenSize);

  // Use direct DOM manipulation for position updates to avoid React re-renders
  useEffect(() => {
    if (!cursorRef.current || !visible) return;
    
    const element = cursorRef.current;
    // Center all cursors properly
    element.style.transform = `translate(${screenX - Math.ceil(screenSize) / 2}px, ${screenY - Math.ceil(screenSize) / 2}px)`;
  }, [screenX, screenY, screenSize, visible]);

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
      }}
    >
      <Image 
        src={cursorDataURL || ''} 
        alt="Brush Cursor" 
        width={Math.ceil(screenSize)} 
        height={Math.ceil(screenSize)} 
        unoptimized 
      />
    </div>
  );
});

export default BrushCursor;