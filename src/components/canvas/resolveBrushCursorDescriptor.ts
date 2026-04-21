import { BrushShape, type BrushSettings, type CustomBrush, type Tool } from '@/types';
import { resolveBrushCursorShape } from './brushCursorShape';
import type { BrushCursorDescriptor } from './useDrawingCanvasCursorModel';

type CursorToolSettings = {
  currentTool: Tool;
    brushSettings: {
      size?: number;
      brushShape?: BrushShape;
      mosaicTilePx?: number;
      mosaicBlocksCount?: number;
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

interface ResolveBrushCursorDescriptorOptions {
  tools: CursorToolSettings;
  globalBrushSize: number;
  temporaryCustomBrush?: CustomBrush | null;
  getCustomBrushByIdUnsafe?: ((id: string) => CustomBrush | null | undefined) | null;
}

const resolvePixelDitherCursorSize = (
  baseBrushSize: number,
  tipShape: BrushSettings['ditherStrokeTipShape'] | undefined
): number => {
  const stampSize = Math.max(1, Math.round(baseBrushSize));
  switch (tipShape ?? 'round') {
    case 'diamond':
      return Math.max(stampSize, Math.ceil(stampSize * Math.SQRT2));
    case 'diamond5':
    case 'diamond7':
    case 'diamond9': {
      const gridSize = tipShape === 'diamond9' ? 9 : tipShape === 'diamond7' ? 7 : 5;
      const pixelScale = Math.max(1, Math.round(stampSize / gridSize));
      return Math.max(stampSize, pixelScale * gridSize);
    }
    case 'checkered': {
      const gridSize = 4;
      const pixelScale = Math.max(1, Math.round(stampSize / gridSize));
      return Math.max(stampSize, pixelScale * gridSize);
    }
    case 'round':
    case 'square':
    case 'triangle':
    default:
      return stampSize;
  }
};

export const resolveBrushCursorDescriptor = ({
  tools,
  globalBrushSize,
  temporaryCustomBrush,
  getCustomBrushByIdUnsafe,
}: ResolveBrushCursorDescriptorOptions): BrushCursorDescriptor => {
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
      : Math.max(
          1,
          mosaicCursorSize ??
            (tools.brushSettings.brushShape === BrushShape.PIXEL_DITHER
              ? resolvePixelDitherCursorSize(baseBrushSize, tools.brushSettings.ditherStrokeTipShape)
              : tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE &&
                  tools.brushSettings.colorCycleStampShape === 'checkered'
                ? resolvePixelDitherCursorSize(baseBrushSize, 'checkered')
              : baseBrushSize)
        );
  const activeSettings =
    tools.currentTool === 'eraser' ? tools.eraserSettings : tools.brushSettings;
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

  if (brushShapeForCursor === BrushShape.CUSTOM) {
    const selectedCustomBrush = activeSettings.selectedCustomBrush;
    const fallbackBrush =
      selectedCustomBrush && temporaryCustomBrush?.id === selectedCustomBrush
        ? temporaryCustomBrush
        : selectedCustomBrush && typeof getCustomBrushByIdUnsafe === 'function'
          ? getCustomBrushByIdUnsafe(selectedCustomBrush) ?? null
          : null;

    if (fallbackBrush) {
      const naturalWidth = fallbackBrush.naturalWidth ?? fallbackBrush.width;
      const naturalHeight = fallbackBrush.naturalHeight ?? fallbackBrush.height;
      const maxDimension =
        fallbackBrush.maxDimension ?? Math.max(naturalWidth, naturalHeight);
      const scale = maxDimension > 0 ? cursorSize / maxDimension : 1;

      return {
        kind: 'custom-brush',
        pixelSize: cursorSize,
        pixelWidth: Math.max(1, naturalWidth * scale),
        pixelHeight: Math.max(1, naturalHeight * scale),
      };
    }
  }

  const tipShape =
    tools.currentTool === 'eraser'
      ? undefined
      : tools.brushSettings.brushShape === BrushShape.PIXEL_DITHER
        ? tools.brushSettings.ditherStrokeTipShape
        : tools.brushSettings.brushShape === BrushShape.COLOR_CYCLE
          ? tools.brushSettings.colorCycleStampShape
        : undefined;

  return {
    kind: 'shape',
    shape: brushShapeForCursor,
    pixelSize: cursorSize,
    tipShape,
  };
};
