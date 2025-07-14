'use client';

import React, { memo, useMemo, useRef, useCallback } from 'react';
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

const BrushCursor = memo(function BrushCursor({
  screenX,
  screenY,
  size,
  brushShape,
  zoom,
  color,
  customBrush,
  visible
}: BrushCursorProps) {
  // Calculate display size based on zoom and brush size
  const screenSize = size * zoom;

  // Cache for custom brush preview to avoid expensive operations
  const previewCache = useRef<Map<string, string>>(new Map());
  
  // Create stable cache key from ImageData content
  const getImageDataKey = useCallback((imageData: ImageData): string => {
    // Use dimensions and first/last few pixels as a content hash
    const firstPixels = Array.from(imageData.data.slice(0, 12)).join(',');
    const lastPixels = Array.from(imageData.data.slice(-12)).join(',');
    return `${imageData.width}x${imageData.height}-${firstPixels}-${lastPixels}`;
  }, []);
  
  const customBrushPreview = useMemo(() => {
    if (!customBrush || brushShape !== BrushShape.CUSTOM) return null;

    // Check cache first using stable key
    const cacheKey = getImageDataKey(customBrush.imageData);
    const cached = previewCache.current.get(cacheKey);
    if (cached) return cached;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = customBrush.width;
      canvas.height = customBrush.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.putImageData(customBrush.imageData, 0, 0);
      const dataURL = canvas.toDataURL();
      
      // Cache the result using stable key
      previewCache.current.set(cacheKey, dataURL);
      
      // Limit cache size to prevent memory leaks
      if (previewCache.current.size > 10) {
        const firstKey = previewCache.current.keys().next().value;
        if (firstKey) {
          previewCache.current.delete(firstKey);
        }
      }
      
      return dataURL;
    } catch (error) {
      console.error('Failed to create custom brush preview:', error);
      return null;
    }
  }, [customBrush, brushShape, getImageDataKey]);

  if (!visible) return null;

  // Render custom brush preview
  if (brushShape === BrushShape.CUSTOM && customBrushPreview && customBrush) {
    // Custom brushes are scaled as percentage: size 100 = 100% original size
    // Calculate scale factor same as brush engine: size / 100
    const scaleFactor = size / 100;
    const displayWidth = customBrush.width * scaleFactor * zoom;
    const displayHeight = customBrush.height * scaleFactor * zoom;

    return (
      <div
        className="pointer-events-none fixed"
        style={{
          left: `${screenX - displayWidth / 2}px`,
          top: `${screenY - displayHeight / 2}px`,
          width: `${displayWidth}px`,
          height: `${displayHeight}px`,
          opacity: 0.5,
          mixBlendMode: 'multiply',
          zIndex: 100,
          transform: 'translate3d(0, 0, 0)', // Force GPU acceleration
        }}
      >
        <img
          src={customBrushPreview}
          alt="Brush preview"
          style={{
            width: '100%',
            height: '100%',
            imageRendering: zoom >= 4 ? 'pixelated' : 'auto',
          }}
        />
      </div>
    );
  }

  // Render shape previews
  return (
    <div
      className="pointer-events-none fixed"
      style={{
        left: `${screenX}px`,
        top: `${screenY}px`,
        transform: `translate(-50%, -50%)`,
        zIndex: 100,
      }}
    >
      {brushShape === BrushShape.ROUND && (
        <svg
          width={screenSize}
          height={screenSize}
          style={{ 
            display: 'block',
            transform: 'translate3d(0, 0, 0)', // Force GPU acceleration
          }}
        >
          <circle
            cx={screenSize / 2}
            cy={screenSize / 2}
            r={Math.max(0.5, screenSize / 2 - 1)}
            fill="none"
            stroke="#666666"
            strokeWidth={Math.max(1, zoom)}
            opacity={0.8}
          />
        </svg>
      )}

      {brushShape === BrushShape.PIXEL_ROUND && (
        <div
          style={{
            width: `${screenSize}px`,
            height: `${screenSize}px`,
            border: `${Math.max(1, zoom)}px solid #666666`,
            borderRadius: '50%',
            opacity: 0.8,
            imageRendering: 'pixelated',
          }}
        />
      )}

      {brushShape === BrushShape.SQUARE && (
        <div
          style={{
            width: `${screenSize}px`,
            height: `${screenSize}px`,
            border: `${Math.max(1, zoom)}px solid #666666`,
            opacity: 0.8,
          }}
        />
      )}

      {brushShape === BrushShape.TRIANGLE && (
        <svg
          width={screenSize}
          height={screenSize}
          style={{ 
            display: 'block',
            transform: 'translate3d(0, 0, 0)', // Force GPU acceleration
          }}
        >
          <polygon
            points={`${screenSize / 2},${1} ${screenSize - 1},${screenSize - 1} ${1},${screenSize - 1}`}
            fill="none"
            stroke="#666666"
            strokeWidth={Math.max(1, zoom)}
            opacity={0.8}
          />
        </svg>
      )}
    </div>
  );
});

export default BrushCursor;