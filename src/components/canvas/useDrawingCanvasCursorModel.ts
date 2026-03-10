import type React from 'react';
import { useMemo } from 'react';
import { BrushShape, type BrushSettings, type Tool } from '@/types';
import { resolveBrushCursorShape } from './brushCursorShape';

export type BrushCursorDescriptor =
  | {
      kind: 'shape';
      shape: BrushShape;
      pixelSize: number;
    }
  | {
      kind: 'custom-brush';
      pixelSize: number;
      pixelWidth: number;
      pixelHeight: number;
      imageData?: ImageData;
    };

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
      currentBrushTip?: BrushSettings['currentBrushTip'];
    };
    eraserSettings: {
      brushShape?: BrushShape;
      size?: number;
      linkSizeToBrush?: boolean;
      currentBrushTip?: BrushSettings['currentBrushTip'];
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
    const activeSettings =
      tools.currentTool === 'eraser' ? tools.eraserSettings : tools.brushSettings;
    const cursorDescriptor: BrushCursorDescriptor = (() => {
      const currentBrushTip = activeSettings.currentBrushTip;
      if (brushShapeForCursor === BrushShape.CUSTOM && currentBrushTip) {
        const naturalWidth =
          currentBrushTip.naturalWidth ??
          currentBrushTip.width ??
          currentBrushTip.imageData.width;
        const naturalHeight =
          currentBrushTip.naturalHeight ??
          currentBrushTip.height ??
          currentBrushTip.imageData.height;
        const maxDimension =
          currentBrushTip.maxDimension ?? Math.max(naturalWidth, naturalHeight);
        const scale = maxDimension > 0 ? cursorSize / maxDimension : 1;

        return {
          kind: 'custom-brush',
          pixelSize: cursorSize,
          pixelWidth: Math.max(1, naturalWidth * scale),
          pixelHeight: Math.max(1, naturalHeight * scale),
          imageData: currentBrushTip.imageData,
        };
      }

      return {
        kind: 'shape',
        shape: brushShapeForCursor,
        pixelSize: cursorSize,
      };
    })();

    const brushCursorVisible =
      showBrushCursor &&
      !panIsPanning &&
      !isSpacePressedRef.current &&
      cursorStyle === 'none';

    return {
      cursorDescriptor,
      brushCursorVisible,
    };
  }, [cursorStyle, globalBrushSize, isSpacePressedRef, panIsPanning, showBrushCursor, tools]);
};
