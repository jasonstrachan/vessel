'use client';

import React, { memo, useMemo } from 'react';
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

  // Create custom brush preview as data URL
  const customBrushPreview = useMemo(() => {
    if (!customBrush || brushShape !== BrushShape.CUSTOM) return null;

    try {
      const canvas = document.createElement('canvas');
      canvas.width = customBrush.width;
      canvas.height = customBrush.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return null;

      ctx.putImageData(customBrush.imageData, 0, 0);
      return canvas.toDataURL();
    } catch (error) {
      console.error('Failed to create custom brush preview:', error);
      return null;
    }
  }, [customBrush, brushShape]);

  if (!visible) return null;

  // Render custom brush preview
  if (brushShape === BrushShape.CUSTOM && customBrushPreview && customBrush) {
    const scaleFactor = size / Math.max(customBrush.width, customBrush.height);
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
            r={screenSize / 2 - 1}
            fill="none"
            stroke={color}
            strokeWidth={Math.max(1, 1 / zoom)}
            opacity={0.8}
          />
        </svg>
      )}

      {brushShape === BrushShape.PIXEL_ROUND && (
        <div
          style={{
            width: `${screenSize}px`,
            height: `${screenSize}px`,
            border: `${Math.max(1, 1 / zoom)}px solid ${color}`,
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
            border: `${Math.max(1, 1 / zoom)}px solid ${color}`,
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
            stroke={color}
            strokeWidth={Math.max(1, 1 / zoom)}
            opacity={0.8}
          />
        </svg>
      )}
    </div>
  );
});

export default BrushCursor;