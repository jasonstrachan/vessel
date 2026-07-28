import type React from 'react';
import { useMemo } from 'react';
import { BrushShape, type BrushSettings, type CustomBrush, type Tool } from '@/types';
import { supportsPressure, supportsRotation } from '@/utils/brushCategories';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { resolveBrushCursorDescriptor } from './resolveBrushCursorDescriptor';

type BrushCursorDynamics = {
  initialRotationRadians?: number;
  pixelWidth?: number;
  pixelHeight?: number;
  pressureSizing?: {
    minPercent: number;
    maxPercent: number;
  };
  rotationEnabled?: boolean;
  rotationOffsetRadians?: number;
  rotationScale?: number;
  rotationStepRadians?: number;
};

export type BrushCursorDescriptor = (
  | {
      kind: 'shape';
      shape: BrushShape;
      pixelSize: number;
      tipShape?: BrushSettings['ditherStrokeTipShape'];
    }
  | {
      kind: 'stroke-line';
      pixelSize: number;
      rotationEnabled: boolean;
      rotationRadians: number;
    }
  | {
      kind: 'custom-brush';
      pixelSize: number;
      pixelWidth: number;
      pixelHeight: number;
      imageData?: ImageData;
    }
) & BrushCursorDynamics;

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
      rotation?: number;
      pressureEnabled?: boolean;
      minPressure?: number;
      maxPressure?: number;
      colorCycleFillMode?: BrushSettings['colorCycleFillMode'];
      ditherStrokeTipShape?: BrushSettings['ditherStrokeTipShape'];
      colorCycleStampShape?: BrushSettings['colorCycleStampShape'];
      currentBrushTip?: BrushSettings['currentBrushTip'];
      selectedCustomBrush?: string | null;
    };
    eraserSettings: {
      brushShape?: BrushShape;
      size?: number;
      linkSizeToBrush?: boolean;
      pressureEnabled?: boolean;
      minPressure?: number;
      maxPressure?: number;
      rotationEnabled?: boolean;
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
    const baseDescriptor = resolveBrushCursorDescriptor({
      tools,
      globalBrushSize,
      temporaryCustomBrush,
      getCustomBrushByIdUnsafe,
    });
    const activeSettings =
      tools.currentTool === 'eraser' ? tools.eraserSettings : tools.brushSettings;
    const pressureRange = resolveBrushPressureRange(activeSettings as BrushSettings);
    const configuredBrushShape =
      activeSettings.brushShape ?? tools.brushSettings.brushShape ?? BrushShape.ROUND;
    const brushShape = baseDescriptor.kind === 'shape' ? baseDescriptor.shape : undefined;
    const isColorCycleStroke =
      configuredBrushShape === BrushShape.COLOR_CYCLE ||
      configuredBrushShape === BrushShape.COLOR_CYCLE_TRIANGLE;
    const ditherTipShape = tools.brushSettings.ditherStrokeTipShape ?? 'round';
    const ditherTipRendersRotation =
      configuredBrushShape !== BrushShape.PIXEL_DITHER ||
      (ditherTipShape !== 'checkered' &&
        ditherTipShape !== 'diamond5' &&
        ditherTipShape !== 'diamond7' &&
        ditherTipShape !== 'diamond9' &&
        ditherTipShape !== 'triangle');
    const isPixelRotated =
      configuredBrushShape === BrushShape.PIXEL_ROUND ||
      configuredBrushShape === BrushShape.PIXEL_DITHER ||
      (configuredBrushShape === BrushShape.SQUARE &&
        tools.brushSettings.antialiasing === false);
    const isMosaic = brushShape === BrushShape.MOSAIC;
    const rotationEnabled =
      baseDescriptor.kind !== 'stroke-line' &&
      supportsRotation(configuredBrushShape) &&
      ditherTipRendersRotation &&
      Boolean(activeSettings.rotationEnabled);
    const pressureEnabled =
      baseDescriptor.kind !== 'stroke-line' &&
      supportsPressure(configuredBrushShape) &&
      pressureRange.enabled;
    const cursorDescriptor: BrushCursorDescriptor = {
      ...baseDescriptor,
      ...(pressureEnabled
        ? {
            pressureSizing: {
              minPercent: pressureRange.minPercent,
              maxPercent: pressureRange.maxPercent,
            },
          }
        : {}),
      ...(rotationEnabled
        ? {
            rotationEnabled: true,
            rotationScale: isColorCycleStroke ? 1 : 0.5,
            rotationOffsetRadians: isMosaic ? Math.PI / 2 : 0,
            rotationStepRadians: isPixelRotated ? Math.PI / 12 : undefined,
          }
        : {}),
      ...(isMosaic
        ? {
            initialRotationRadians: Math.PI / 2,
            pixelWidth: baseDescriptor.pixelSize,
            pixelHeight: Math.max(
              1,
              (tools.brushSettings.mosaicTilePx ?? 8) *
                ((tools.brushSettings.size ?? globalBrushSize) / 60),
            ),
          }
        : {}),
    };

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
