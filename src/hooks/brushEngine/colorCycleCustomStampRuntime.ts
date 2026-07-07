import type { GradientStop } from '@/lib/GradientPalette';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';
import type { FlowMode } from '@/lib/colorCycle/flowEncoding';
import type { CustomBrushColorCycleData } from '@/types';

import {
  ColorCycleCustomStampCache,
  getBrushProfileNow,
  getCcCustomStampProfile,
  type CustomStampInput,
} from './colorCycleCustomStampCache';
import { stampMaskHasVisiblePixels } from './colorCycleStampMask';
import type {
  LayerStrokeState,
} from './colorCycleCanvas2DTypes';

export type { CustomStampInput };

type CustomStampAnimator = ColorCycleAnimator;

type CapturedStampGradientBinding = {
  slot: number;
  defId: number;
};

export type ResolveCustomStampIndexFn = (args: {
  isCapturedDataStamp: boolean;
  capturedPhaseMap?: Uint16Array;
  capturedMapWidth: number;
  capturedMapHeight: number;
  px: number;
  py: number;
  maskWidth: number;
  maskHeight: number;
  scaledWidth: number;
  scaledHeight: number;
  rotation: number;
  fallbackColorIndex: number;
  phaseOffset: number;
  cycleSpan: number;
}) => number | null;

export const resolveCustomStampIndex: ResolveCustomStampIndexFn = ({
  isCapturedDataStamp,
  capturedPhaseMap,
  capturedMapWidth,
  capturedMapHeight,
  px,
  py,
  maskWidth,
  maskHeight,
  scaledWidth,
  scaledHeight,
  rotation,
  fallbackColorIndex,
  phaseOffset,
  cycleSpan,
}): number | null => {
  if (!isCapturedDataStamp) {
    return fallbackColorIndex;
  }

  if (!capturedPhaseMap || capturedMapWidth <= 0 || capturedMapHeight <= 0) {
    return null;
  }

  const sampleX = px + 0.5 - maskWidth / 2;
  const sampleY = py + 0.5 - maskHeight / 2;
  const invCos = Math.cos(-rotation);
  const invSin = Math.sin(-rotation);
  const unrotatedX = sampleX * invCos - sampleY * invSin + scaledWidth / 2;
  const unrotatedY = sampleX * invSin + sampleY * invCos + scaledHeight / 2;

  if (
    unrotatedX < 0 ||
    unrotatedY < 0 ||
    unrotatedX >= scaledWidth ||
    unrotatedY >= scaledHeight
  ) {
    return null;
  }

  const srcX = Math.max(
    0,
    Math.min(
      capturedMapWidth - 1,
      Math.floor((unrotatedX * capturedMapWidth) / Math.max(1, scaledWidth))
    )
  );
  const srcY = Math.max(
    0,
    Math.min(
      capturedMapHeight - 1,
      Math.floor((unrotatedY * capturedMapHeight) / Math.max(1, scaledHeight))
    )
  );
  const sourceIndex = capturedPhaseMap[srcY * capturedMapWidth + srcX] ?? 0;
  const normalizedSource = Math.max(0, sourceIndex);
  const span = Math.max(1, cycleSpan);
  const mapped = (normalizedSource + phaseOffset) % span;
  return mapped + 1;
};

export interface ColorCycleCustomStampRuntimeDeps {
  width: number;
  height: number;
  getActiveLayerId: () => string | null;
  getLayerDocumentVersion: (layerId: string) => number | null;
  prepareStrokeContext: (layerId: string) => {
    id: string;
    animator: CustomStampAnimator;
    strokeData: LayerStrokeState;
  };
  applyStrokeFlowSpeed: (strokeData: LayerStrokeState, speedSamplePxPerMs?: number) => void;
  isStampDitherEnabled: () => boolean;
  getWriteSpeedByte: (strokeData: LayerStrokeState) => number;
  getFlowMode: () => FlowMode;
  resolvePressureBrushSize: (pressure: number) => number;
  advanceStrokePhase: (strokeData: LayerStrokeState) => void;
  computeColorBandIndexPerStamp: (strokeData: LayerStrokeState) => number;
  getNonDitherStrokeColorIndex: (strokeData: LayerStrokeState) => number;
  resolveCapturedStampGradientBinding: (
    layerId: string,
    colorCycle: CustomBrushColorCycleData | undefined
  ) => CapturedStampGradientBinding | null;
  resolveActiveStrokeSlot: (layerId: string, strokeData: LayerStrokeState) => number;
  resolveFlowSlot: (strokeData: LayerStrokeState, activeSlot: number) => number;
  resolveGradientDefIdForSlot: (layerId: string, slot: number) => number | null;
  logSetIndexSample: (layerId: string, x: number, y: number) => void;
  markStrokeStateContentWritten: (strokeData: LayerStrokeState) => void;
  getLayerGradientDefs: (layerId: string) => Array<{
    id: number;
    hash: string;
    stops: GradientStop[];
  }> | undefined;
  applyDefBindingsForLayer: (
    layerId: string,
    animator: CustomStampAnimator,
    strokeData: LayerStrokeState,
    defs: Array<{ id: number; hash: string; stops: GradientStop[] }> | undefined,
    options: { forceDefDirty: boolean }
  ) => void;
  markPresenterLayerDirty: (layerId: string) => void;
  scheduleDirtyRender: () => void;
}

export class ColorCycleCustomStampRuntime {
  private readonly cache = new ColorCycleCustomStampCache();
  private customStampBuiltFromVersion: number | null = null;

  get builtFromVersion(): number | null {
    return this.customStampBuiltFromVersion;
  }

  clear(): void {
    this.cache.clear();
    this.customStampBuiltFromVersion = null;
  }

  paint(
    stamp: CustomStampInput,
    x: number,
    y: number,
    deps: ColorCycleCustomStampRuntimeDeps,
    layerId?: string,
    pressure: number = 1,
    rotation: number = 0,
    speedSamplePxPerMs?: number
  ): void {
    if (!stamp?.imageData) {
      return;
    }
    const profile = getCcCustomStampProfile();
    const paintStart = profile ? getBrushProfileNow() : 0;
    let wrotePixels = 0;

    const targetLayerId = layerId || deps.getActiveLayerId() || 'default';
    this.customStampBuiltFromVersion = deps.getLayerDocumentVersion(targetLayerId);
    const { id, animator, strokeData } = deps.prepareStrokeContext(targetLayerId);
    deps.applyStrokeFlowSpeed(strokeData, speedSamplePxPerMs);
    const useStampDither = deps.isStampDitherEnabled();
    const speedByte = useStampDither ? deps.getWriteSpeedByte(strokeData) : 0;
    if (typeof animator.setStrokeSpeedByte === 'function') {
      animator.setStrokeSpeedByte(speedByte);
    }
    try {
      animator.setFlowMode(deps.getFlowMode());
    } catch {}

    const targetSize = deps.resolvePressureBrushSize(pressure);

    const baseWidth = Math.max(1, stamp.width);
    const baseHeight = Math.max(1, stamp.height);
    const maxDimension = Math.max(baseWidth, baseHeight);
    const scale = maxDimension > 0 ? targetSize / maxDimension : 1;
    const scaledWidth = Math.max(1, Math.round(baseWidth * scale));
    const scaledHeight = Math.max(1, Math.round(baseHeight * scale));

    const scaledCanvas = this.cache.getScaledStampCanvas(stamp, scaledWidth, scaledHeight);
    const cos = Math.cos(rotation);
    const sin = Math.sin(rotation);
    const rotatedWidth = Math.abs(scaledWidth * cos) + Math.abs(scaledHeight * sin);
    const rotatedHeight = Math.abs(scaledWidth * sin) + Math.abs(scaledHeight * cos);
    const targetWidth = Math.max(1, Math.ceil(rotatedWidth));
    const targetHeight = Math.max(1, Math.ceil(rotatedHeight));

    const maskEntry = this.cache.getStampMask(
      stamp,
      scaledCanvas,
      scaledWidth,
      scaledHeight,
      targetWidth,
      targetHeight,
      rotation
    );
    if (!maskEntry) {
      return;
    }

    const originX = Math.round(x - maskEntry.width / 2);
    const originY = Math.round(y - maskEntry.height / 2);
    const alpha = maskEntry.alpha;
    if (!stampMaskHasVisiblePixels(alpha)) {
      return;
    }

    const colorCycle = stamp.colorCycle;
    const isCapturedDataStamp =
      colorCycle?.schemaVersion === 2 &&
      colorCycle.mode === 'captured-data';
    if (useStampDither || isCapturedDataStamp) {
      deps.advanceStrokePhase(strokeData);
    }
    const fallbackColorIndex = useStampDither
      ? deps.computeColorBandIndexPerStamp(strokeData)
      : deps.getNonDitherStrokeColorIndex(strokeData);
    const capturedPhaseMap =
      colorCycle?.schemaVersion === 2 && colorCycle.mode === 'captured-data'
        ? (
            colorCycle.phaseMap && colorCycle.phaseMap.length === colorCycle.mapWidth * colorCycle.mapHeight
              ? colorCycle.phaseMap
              : colorCycle.indexMap && colorCycle.indexMap.length === colorCycle.mapWidth * colorCycle.mapHeight
                ? colorCycle.indexMap
                : undefined
          )
        : undefined;
    const capturedMapWidth = colorCycle?.schemaVersion === 2 ? colorCycle.mapWidth : 0;
    const capturedMapHeight = colorCycle?.schemaVersion === 2 ? colorCycle.mapHeight : 0;
    const capturedDataAvailable =
      Boolean(capturedPhaseMap) &&
      capturedMapWidth > 0 &&
      capturedMapHeight > 0;
    if (isCapturedDataStamp && !capturedDataAvailable) {
      return;
    }
    const capturedGradientBinding = deps.resolveCapturedStampGradientBinding(id, colorCycle);
    const activeSlot = capturedGradientBinding?.slot ?? deps.resolveActiveStrokeSlot(id, strokeData);
    strokeData.flow.activeSlot = activeSlot;
    const flowSlot = deps.resolveFlowSlot(strokeData, activeSlot);
    const activeDefId = capturedGradientBinding?.defId ?? deps.resolveGradientDefIdForSlot(id, activeSlot);
    const cycleSpan =
      colorCycle?.schemaVersion === 2
        ? Math.max(1, Math.min(255, Math.round(colorCycle.sourceCycleLength || 256) - 1))
        : 255;
    const phaseOffset = cycleSpan > 0
      ? Math.floor(((strokeData.strokePhaseUnits % cycleSpan) + cycleSpan) % cycleSpan)
      : 0;
    for (let py = 0; py < maskEntry.height; py++) {
      const targetY = originY + py;
      if (targetY < 0 || targetY >= deps.height) continue;
      const rowOffset = py * maskEntry.width;
      for (let px = 0; px < maskEntry.width; px++) {
        const targetX = originX + px;
        if (targetX < 0 || targetX >= deps.width) continue;
        if (alpha[rowOffset + px] < 16) continue;
        deps.logSetIndexSample(id, targetX, targetY);
        const colorIndex = resolveCustomStampIndex({
          isCapturedDataStamp,
          capturedPhaseMap,
          capturedMapWidth,
          capturedMapHeight,
          px,
          py,
          maskWidth: maskEntry.width,
          maskHeight: maskEntry.height,
          scaledWidth,
          scaledHeight,
          rotation,
          fallbackColorIndex,
          phaseOffset,
          cycleSpan,
        });
        if (colorIndex === null) {
          continue;
        }
        animator.setIndex(targetX, targetY, colorIndex, flowSlot);
        strokeData.buffers.def[targetY * deps.width + targetX] = colorIndex > 0
          ? activeDefId ?? 0
          : 0;
        wrotePixels += 1;
      }
    }
    strokeData.lastPoint = { x, y };
    if (wrotePixels > 0) {
      deps.markStrokeStateContentWritten(strokeData);
      try {
        deps.applyDefBindingsForLayer(
          id,
          animator,
          strokeData,
          deps.getLayerGradientDefs(id),
          { forceDefDirty: true }
        );
      } catch {}
    }
    strokeData.stampCounter++;

    deps.markPresenterLayerDirty(id);
    deps.scheduleDirtyRender();

    if (profile) {
      profile.paintCalls += 1;
      profile.paintTotalMs += getBrushProfileNow() - paintStart;
      profile.writePixels += wrotePixels;
    }
  }
}
