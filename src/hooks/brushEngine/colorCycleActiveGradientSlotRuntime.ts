import type { GradientStop } from '@/lib/GradientPalette';
import {
  appendGradientSeamProfileSignature,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';
import type { ColorCycleAnimator } from '@/lib/ColorCycleAnimator';

import type { LayerStrokeState } from './colorCycleCanvas2DTypes';

export type ColorCycleActiveGradientSlotContext = {
  getActiveLayerId(): string | null;
  getActiveSlotsView(): ReadonlyMap<string, number>;
  getActiveSlot(layerId: string): number;
  setActiveSlot(layerId: string, slot: number, builtFromVersion: number | null): void;
  setActiveLayerId(layerId: string): void;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  getSlotStops(layerId: string, slot: number): GradientStop[] | null | undefined;
  getSlotSeamProfile(layerId: string, slot: number): GradientSeamProfile;
  getSlotSignature(layerId: string, slot: number): string | undefined;
  setSlot(
    layerId: string,
    slot: number,
    stops: GradientStop[],
    signature: string,
    seamProfile: GradientSeamProfile,
    builtFromVersion: number | null,
  ): void;
  getActiveGradientSignature(layerId: string): string | undefined;
  setActiveGradientSignature(layerId: string, signature: string, builtFromVersion: number | null): void;
  getLayerDocumentVersion(layerId: string): number | null;
  getAnimator(layerId: string): ColorCycleAnimator;
  setRuntimeGradientStops(stops: GradientStop[], builtFromVersion: number | null): void;
  shouldPreserveGradientPhaseOnChange(): boolean;
  resetStampCounter(): void;
  flowSlotMask: number;
};

export function computeColorCycleGradientSignature(
  stops: GradientStop[],
  seamProfile: GradientSeamProfile = 'hard',
): string {
  if (!stops || stops.length === 0) {
    return appendGradientSeamProfileSignature('[]', seamProfile);
  }

  const signature = stops
    .map((stop) => {
      const pos = Number.isFinite(stop.position) ? stop.position.toFixed(6) : 'NaN';
      const color = stop.color;
      if (typeof color === 'string') {
        return `${pos}:${color}`;
      }
      if (color && typeof color === 'object') {
        const { r = 0, g = 0, b = 0 } = color as { r?: number; g?: number; b?: number };
        return `${pos}:${Math.round(r)}-${Math.round(g)}-${Math.round(b)}`;
      }
      return `${pos}:?`;
    })
    .join('|');
  return appendGradientSeamProfileSignature(signature, seamProfile);
}

export function applyColorCycleGradientForLayer(
  context: ColorCycleActiveGradientSlotContext,
  layerId: string,
  stops: GradientStop[],
  seamProfile: GradientSeamProfile = 'hard',
): void {
  const animator = context.getAnimator(layerId);
  const activeSlot = context.getActiveSlot(layerId);
  const builtFromVersion = context.getLayerDocumentVersion(layerId);

  const signature = computeColorCycleGradientSignature(stops, seamProfile);
  const previousSignature = context.getActiveGradientSignature(layerId);
  const gradientChanged = signature !== previousSignature;

  if (gradientChanged) {
    context.setActiveGradientSignature(layerId, signature, builtFromVersion);
  }

  if (typeof animator.setGradientSlot === 'function') {
    animator.setGradientSlot(activeSlot, stops, seamProfile);
    animator.setActiveGradientSlot?.(activeSlot);
  } else {
    animator.setGradient(stops, seamProfile);
  }

  context.setRuntimeGradientStops(stops, builtFromVersion);

  if (gradientChanged && !context.shouldPreserveGradientPhaseOnChange()) {
    context.resetStampCounter();
    const strokeData = context.getStrokeState(layerId);
    if (strokeData) {
      strokeData.stampCounter = 0;
    }
  }
}

export function setColorCycleGradient(
  context: ColorCycleActiveGradientSlotContext,
  stops: GradientStop[],
  layerId?: string,
): void {
  const id = layerId || context.getActiveLayerId() || 'default';
  const slot = context.getActiveSlot(id);
  setColorCycleGradientSlot(context, id, slot, stops);
  setColorCycleActiveGradientSlot(context, id, slot);
}

export function updateColorCycleGradient(
  context: ColorCycleActiveGradientSlotContext,
  stops: GradientStop[],
): void {
  const layerId = context.getActiveLayerId() ?? 'default';
  context.setActiveLayerId(layerId);
  setColorCycleGradient(context, stops, layerId);
}

export function getColorCycleActiveGradientSlots(
  context: ColorCycleActiveGradientSlotContext,
): ReadonlyMap<string, number> {
  return context.getActiveSlotsView();
}

export function getColorCycleActiveGradientSlot(
  context: ColorCycleActiveGradientSlotContext,
  layerId?: string,
): number {
  const id = layerId || context.getActiveLayerId() || 'default';
  return context.getActiveSlot(id);
}

export function setColorCycleGradientSlot(
  context: ColorCycleActiveGradientSlotContext,
  layerId: string,
  slot: number,
  stops: GradientStop[],
  seamProfile: GradientSeamProfile = 'hard',
): void {
  const id = layerId || context.getActiveLayerId() || 'default';
  const clampedSlot = Math.max(0, Math.min(context.flowSlotMask, Math.round(slot)));
  const builtFromVersion = context.getLayerDocumentVersion(id);

  const signature = computeColorCycleGradientSignature(stops, seamProfile);
  const previousSignature = context.getSlotSignature(id, clampedSlot);
  const signatureChanged = signature !== previousSignature;

  if (!signatureChanged) {
    const activeSlot = context.getActiveSlot(id);
    if (activeSlot === clampedSlot && context.getActiveGradientSignature(id) !== signature) {
      applyColorCycleGradientForLayer(context, id, stops, seamProfile);
    }
    return;
  }

  context.setSlot(id, clampedSlot, stops, signature, seamProfile, builtFromVersion);

  if (context.getActiveSlot(id) === clampedSlot) {
    applyColorCycleGradientForLayer(context, id, stops, seamProfile);
  }
}

export function setColorCycleGradientSlotStops(
  context: ColorCycleActiveGradientSlotContext,
  layerId: string,
  slot: number,
  stops: GradientStop[],
  seamProfile: GradientSeamProfile = 'hard',
): void {
  const id = layerId || context.getActiveLayerId() || 'default';
  const clampedSlot = Math.max(0, Math.min(context.flowSlotMask, Math.round(slot)));
  const builtFromVersion = context.getLayerDocumentVersion(id);

  const signature = computeColorCycleGradientSignature(stops, seamProfile);
  const previousSignature = context.getSlotSignature(id, clampedSlot);
  const signatureChanged = signature !== previousSignature;

  if (!signatureChanged) {
    return;
  }

  context.setSlot(id, clampedSlot, stops, signature, seamProfile, builtFromVersion);

  if (context.getActiveSlot(id) === clampedSlot) {
    applyColorCycleGradientForLayer(context, id, stops, seamProfile);
    return;
  }

  const animator = context.getAnimator(id);
  if (typeof animator.setGradientSlot === 'function') {
    animator.setGradientSlot(clampedSlot, stops, seamProfile);
  }
}

export function setColorCycleActiveGradientSlot(
  context: ColorCycleActiveGradientSlotContext,
  layerId: string,
  slot: number,
): void {
  const id = layerId || context.getActiveLayerId() || 'default';
  const clampedSlot = Math.max(0, Math.min(context.flowSlotMask, Math.round(slot)));
  if (context.getActiveSlot(id) === clampedSlot) {
    return;
  }

  context.setActiveSlot(id, clampedSlot, context.getLayerDocumentVersion(id));
  context.setActiveLayerId(id);
  const strokeData = context.getStrokeState(id);
  if (strokeData) {
    strokeData.flow.activeSlot = clampedSlot;
  }

  const stops = context.getSlotStops(id, clampedSlot);
  if (stops && stops.length > 0) {
    applyColorCycleGradientForLayer(
      context,
      id,
      stops,
      context.getSlotSeamProfile(id, clampedSlot),
    );
  }
}
