'use client';

import React, { memo } from 'react';
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
  // Suppress unused variable warnings for custom brush mode
  // We keep these parameters for interface compatibility
  void color;
  void customBrush;
  // Calculate display size based on zoom and brush size
  const screenSize = size * zoom;


  if (!visible) return null;

  // Render crosshair for custom brushes
  if (brushShape === BrushShape.CUSTOM) {
    return (
      <div
        className="pointer-events-none fixed"
        style={{
          left: `${screenX}px`,
          top: `${screenY}px`,
          transform: 'translate(-50%, -50%)',
          zIndex: 100,
        }}
      >
        <svg
          width="21"
          height="21"
          style={{ 
            display: 'block',
            transform: 'translate3d(0, 0, 0)', // Force GPU acceleration
          }}
        >
          {/* Crosshair lines */}
          <line
            x1="10.5"
            y1="3"
            x2="10.5"
            y2="8"
            stroke="#dedede"
            strokeWidth="1"
            filter="drop-shadow(1px 1px 0px black)"
          />
          <line
            x1="10.5"
            y1="13"
            x2="10.5"
            y2="18"
            stroke="#dedede"
            strokeWidth="1"
            filter="drop-shadow(1px 1px 0px black)"
          />
          <line
            x1="3"
            y1="10.5"
            x2="8"
            y2="10.5"
            stroke="#dedede"
            strokeWidth="1"
            filter="drop-shadow(1px 1px 0px black)"
          />
          <line
            x1="13"
            y1="10.5"
            x2="18"
            y2="10.5"
            stroke="#dedede"
            strokeWidth="1"
            filter="drop-shadow(1px 1px 0px black)"
          />
          {/* Center dot */}
          <circle
            cx="10.5"
            cy="10.5"
            r="1"
            fill="#dedede"
            filter="drop-shadow(1px 1px 0px black)"
          />
        </svg>
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
          width={screenSize + 4}
          height={screenSize + 4}
          style={{ 
            display: 'block',
            transform: 'translate3d(0, 0, 0)', // Force GPU acceleration
          }}
        >
          <circle
            cx={(screenSize + 4) / 2}
            cy={(screenSize + 4) / 2}
            r={Math.max(0.5, screenSize / 2 - 1)}
            fill="none"
            stroke="#dedede"
            strokeWidth="1"
            opacity={1}
            filter="drop-shadow(1px 1px 0px black)"
          />
        </svg>
      )}

      {brushShape === BrushShape.PIXEL_ROUND && (
        <div
          style={{
            width: `${screenSize + 4}px`,
            height: `${screenSize + 4}px`,
            padding: '2px',
            boxSizing: 'border-box',
            border: '1px solid #dedede',
            borderRadius: '50%',
            opacity: 1,
            imageRendering: 'pixelated',
            filter: 'drop-shadow(1px 1px 0px black)',
          }}
        />
      )}

      {brushShape === BrushShape.SQUARE && (
        <div
          style={{
            width: `${screenSize + 4}px`,
            height: `${screenSize + 4}px`,
            padding: '2px',
            boxSizing: 'border-box',
            border: '1px solid #dedede',
            opacity: 1,
            filter: 'drop-shadow(1px 1px 0px black)',
          }}
        />
      )}

      {brushShape === BrushShape.TRIANGLE && (
        <svg
          width={screenSize + 4}
          height={screenSize + 4}
          style={{ 
            display: 'block',
            transform: 'translate3d(0, 0, 0)', // Force GPU acceleration
          }}
        >
          <polygon
            points={`${(screenSize + 4) / 2},${3} ${screenSize + 1},${screenSize + 1} ${3},${screenSize + 1}`}
            fill="none"
            stroke="#dedede"
            strokeWidth="1"
            opacity={1}
            filter="drop-shadow(1px 1px 0px black)"
          />
        </svg>
      )}
    </div>
  );
});

export default BrushCursor;