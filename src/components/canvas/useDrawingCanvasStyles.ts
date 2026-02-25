import type React from 'react';
import { useMemo } from 'react';
import { BrushShape } from '@/types';

interface UseDrawingCanvasStylesOptions {
  canvasZoom: number;
  displayMode: 'auto' | 'pixelated' | 'smooth';
  cursorStyle: string;
  rotationEnabled: boolean;
  antialiasing: boolean;
  brushShape: BrushShape | undefined;
}

export const useDrawingCanvasStyles = ({
  canvasZoom,
  displayMode,
  cursorStyle,
  rotationEnabled,
  antialiasing,
  brushShape,
}: UseDrawingCanvasStylesOptions) => {
  return useMemo(() => {
    const shouldForcePixelated = (canvasZoom || 1) > 3 || (
      rotationEnabled &&
      (
        brushShape === BrushShape.PIXEL_ROUND ||
        (!antialiasing && brushShape === BrushShape.SQUARE)
      )
    );

    const shouldPixelateDisplay = displayMode === 'pixelated' || shouldForcePixelated;

    const canvasStyle: React.CSSProperties = {
      display: 'block',
      width: '100%',
      height: '100%',
      touchAction: 'none',
      userSelect: 'none',
      cursor: cursorStyle,
      imageRendering: shouldPixelateDisplay ? 'pixelated' : 'auto'
    };

    if (shouldPixelateDisplay) {
      Object.assign(canvasStyle, {
        WebkitImageRendering: 'pixelated',
        MozImageRendering: 'crisp-edges',
        msImageRendering: 'pixelated'
      } as React.CSSProperties);
    }

    const overlayCanvasStyle: React.CSSProperties = {
      position: 'absolute',
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      mixBlendMode: 'normal',
      pointerEvents: 'none',
      imageRendering: shouldPixelateDisplay ? 'pixelated' : 'auto',
      touchAction: 'none',
      userSelect: 'none',
      cursor: cursorStyle,
    };

    return {
      shouldPixelateDisplay,
      canvasStyle,
      overlayCanvasStyle,
    };
  }, [antialiasing, brushShape, canvasZoom, cursorStyle, displayMode, rotationEnabled]);
};
