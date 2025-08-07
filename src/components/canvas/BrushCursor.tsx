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
    const size = Math.ceil(screenSize) + 8; // Add padding for shadow and border
    canvas.width = size;
    canvas.height = size;
    
    const ctx = canvas.getContext('2d', { colorSpace: 'srgb' });
    if (!ctx) return '';

    // This is the fast, canvas-based equivalent of drop-shadow
    ctx.shadowColor = 'rgba(0, 0, 0, 0.75)';
    ctx.shadowOffsetX = 1;
    ctx.shadowOffsetY = 1;
    ctx.shadowBlur = 1;

    ctx.strokeStyle = '#ffffff'; // White outline for visibility
    ctx.lineWidth = 2;
    
    const center = size / 2;
    const radius = Math.max(0.5, screenSize / 2);

    ctx.beginPath();

    switch (brushShape) {
      case BrushShape.ROUND:
      case BrushShape.PIXEL_ROUND:
        ctx.arc(center, center, radius, 0, Math.PI * 2);
        break;
      case BrushShape.SQUARE:
        ctx.rect(center - radius, center - radius, screenSize, screenSize);
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
}: BrushCursorProps) {
  const cursorRef = useRef<HTMLDivElement>(null);
  const screenSize = size * zoom;
  const cursorDataURL = useCursorDataURL(brushShape, screenSize);

  // Use direct DOM manipulation for position updates to avoid React re-renders
  useEffect(() => {
    if (!cursorRef.current || !visible) return;
    
    const element = cursorRef.current;
    // Use transform for better performance than changing left/top
    if (brushShape === BrushShape.CUSTOM) {
      // Center the 21x21 crosshair
      element.style.transform = `translate(${screenX - 10.5}px, ${screenY - 10.5}px)`;
    } else {
      // Center the brush cursor with padding
      element.style.transform = `translate(${screenX - (Math.ceil(screenSize) + 8) / 2}px, ${screenY - (Math.ceil(screenSize) + 8) / 2}px)`;
    }
  }, [screenX, screenY, screenSize, visible, brushShape]);

  if (!visible) return null;

  // Render a simple, static crosshair for custom brushes (already fast)
  if (brushShape === BrushShape.CUSTOM) {
    return (
      <div
        ref={cursorRef}
        className="pointer-events-none fixed"
        style={{
          left: 0,
          top: 0,
          zIndex: 1000,
        }}
      >
        <svg width="21" height="21">
          <line x1="10.5" y1="3" x2="10.5" y2="8" stroke="#ffffff" strokeWidth="2" filter="drop-shadow(1px 1px 0px black)" />
          <line x1="10.5" y1="13" x2="10.5" y2="18" stroke="#ffffff" strokeWidth="2" filter="drop-shadow(1px 1px 0px black)" />
          <line x1="3" y1="10.5" x2="8" y2="10.5" stroke="#ffffff" strokeWidth="2" filter="drop-shadow(1px 1px 0px black)" />
          <line x1="13" y1="10.5" x2="18" y2="10.5" stroke="#ffffff" strokeWidth="2" filter="drop-shadow(1px 1px 0px black)" />
          <circle cx="10.5" cy="10.5" r="1" fill="#ffffff" filter="drop-shadow(1px 1px 0px black)" />
        </svg>
      </div>
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
        width: `${Math.ceil(screenSize) + 8}px`,
        height: `${Math.ceil(screenSize) + 8}px`,
        zIndex: 1000,
        imageRendering: 'pixelated',
      }}
    >
      <Image src={cursorDataURL || ''} alt="Brush Cursor" width={32} height={32} unoptimized />
    </div>
  );
});

export default BrushCursor;