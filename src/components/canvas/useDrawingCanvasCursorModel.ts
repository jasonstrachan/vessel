import type React from 'react';
import { useMemo } from 'react';
import { BrushShape, type BrushSettings, type Tool } from '@/types';
import { resolveBrushCursorShape } from './brushCursorShape';

interface UseDrawingCanvasCursorModelOptions {
  tools: {
    currentTool: Tool;
    brushSettings: {
      size?: number;
      brushShape?: BrushShape;
      mosaicTilePx?: number;
      mosaicBlocksCount?: number;
      antialiasing: boolean;
      rotationEnabled: boolean;
      ditherStrokeTipShape?: BrushSettings['ditherStrokeTipShape'];
    };
    eraserSettings: {
      brushShape?: BrushShape;
      size?: number;
      linkSizeToBrush?: boolean;
    };
  };
  globalBrushSize: number;
  showBrushCursor: boolean;
  panIsPanning: boolean;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  cursorStyle: string;
}

export const useDrawingCanvasCursorModel = ({
  tools,
  globalBrushSize,
  showBrushCursor,
  panIsPanning,
  isSpacePressedRef,
  cursorStyle,
}: UseDrawingCanvasCursorModelOptions) => {
  return useMemo(() => {
    const brushShapeForCursor = resolveBrushCursorShape(tools);
    const baseBrushSize = tools.brushSettings.size ?? globalBrushSize ?? 1;
    const eraserSize =
      tools.eraserSettings.linkSizeToBrush === false
        ? tools.eraserSettings.size ?? baseBrushSize
        : baseBrushSize;
    const mosaicCursorSize = (() => {
      if (brushShapeForCursor !== BrushShape.MOSAIC) {
        return null;
      }
      const tilePx = Math.max(1, Math.min(128, Math.round(tools.brushSettings.mosaicTilePx ?? 8)));
      const blocksCount = Math.max(1, Math.min(32, Math.round(tools.brushSettings.mosaicBlocksCount ?? 6)));
      const rows = 1;
      const stampW = tilePx * blocksCount;
      const stampH = tilePx * rows;
      const scale = baseBrushSize / 60;
      return Math.max(stampW, stampH) * scale;
    })();
    const cursorSize =
      tools.currentTool === 'eraser'
        ? Math.max(1, eraserSize)
        : Math.max(1, mosaicCursorSize ?? baseBrushSize);

    const brushCursorVisible =
      showBrushCursor &&
      !panIsPanning &&
      !isSpacePressedRef.current &&
      cursorStyle === 'none';

    return {
      brushShapeForCursor,
      cursorSize,
      brushCursorVisible,
    };
  }, [cursorStyle, globalBrushSize, isSpacePressedRef, panIsPanning, showBrushCursor, tools]);
};
