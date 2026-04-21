import type React from 'react';
import { useMemo } from 'react';
import { BrushShape, type BrushSettings, type CustomBrush, type Tool } from '@/types';
import { resolveBrushCursorDescriptor } from './resolveBrushCursorDescriptor';

export type BrushCursorDescriptor =
  | {
      kind: 'shape';
      shape: BrushShape;
      pixelSize: number;
      tipShape?: BrushSettings['ditherStrokeTipShape'];
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
      colorCycleStampShape?: BrushSettings['colorCycleStampShape'];
      currentBrushTip?: BrushSettings['currentBrushTip'];
      selectedCustomBrush?: string | null;
    };
    eraserSettings: {
      brushShape?: BrushShape;
      size?: number;
      linkSizeToBrush?: boolean;
      currentBrushTip?: BrushSettings['currentBrushTip'];
      selectedCustomBrush?: string | null;
    };
  };
  globalBrushSize: number;
  showBrushCursor: boolean;
  panIsPanning: boolean;
  isSpacePressedRef: React.MutableRefObject<boolean>;
  cursorStyle: string;
  temporaryCustomBrush?: CustomBrush | null;
  getCustomBrushByIdUnsafe?: ((id: string) => CustomBrush | null | undefined) | null;
}

export const useDrawingCanvasCursorModel = ({
  tools,
  globalBrushSize,
  showBrushCursor,
  panIsPanning,
  isSpacePressedRef,
  cursorStyle,
  temporaryCustomBrush,
  getCustomBrushByIdUnsafe,
}: UseDrawingCanvasCursorModelOptions) => {
  return useMemo(() => {
    const cursorDescriptor: BrushCursorDescriptor = resolveBrushCursorDescriptor({
      tools,
      globalBrushSize,
      temporaryCustomBrush,
      getCustomBrushByIdUnsafe,
    });

    const brushCursorVisible =
      showBrushCursor &&
      !panIsPanning &&
      !isSpacePressedRef.current &&
      cursorStyle === 'none';

    return {
      cursorDescriptor,
      brushCursorVisible,
    };
  }, [
    cursorStyle,
    getCustomBrushByIdUnsafe,
    globalBrushSize,
    isSpacePressedRef,
    panIsPanning,
    showBrushCursor,
    temporaryCustomBrush,
    tools,
  ]);
};
