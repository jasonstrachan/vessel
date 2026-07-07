import type { LayerStrokeState } from './colorCycleCanvas2DTypes';
import { paintBufferHasContent } from './colorCycleLayerStrokeBuffers';

export type ColorCycleBufferValidationContext = {
  getActiveLayerId(): string | null;
  getStrokeState(layerId: string): LayerStrokeState | undefined;
  createStrokeState(options: { hasContent: boolean; bufferSize: number }): LayerStrokeState;
  setStrokeState(layerId: string, strokeData: LayerStrokeState): void;
  getCanvasPixelCount(): number;
};

export function hasValidColorCycleBuffers(
  context: ColorCycleBufferValidationContext,
): boolean {
  const activeLayerId = context.getActiveLayerId();
  if (!activeLayerId) {
    return true;
  }

  let layerData = context.getStrokeState(activeLayerId);
  if (!layerData) {
    layerData = context.createStrokeState({
      hasContent: false,
      bufferSize: Math.max(1, context.getCanvasPixelCount()),
    });
    context.setStrokeState(activeLayerId, layerData);
  }
  return !!layerData.buffers.paint;
}

export type ColorCyclePaintBufferClearVerificationContext = {
  hasAnimator(layerId: string): boolean;
  getPaintBuffer(layerId: string): Uint8Array | undefined;
  getCanvasWidth(): number;
  getCanvasHeight(): number;
  log(message: string, ...args: unknown[]): void;
  warn(message: string, error: unknown): void;
};

export function verifyColorCyclePaintBufferCleared(
  context: ColorCyclePaintBufferClearVerificationContext,
  layerId: string,
): boolean {
  if (!context.hasAnimator(layerId)) {
    context.log('[Debug] No animator exists for layer:', layerId);
    return true;
  }

  const paint = context.getPaintBuffer(layerId);
  try {
    if (!paint) {
      context.log('[Debug] No paint buffer data on layer');
      return true;
    }
    const hasContent = paintBufferHasContent(
      paint,
      context.getCanvasWidth(),
      context.getCanvasHeight(),
    );
    context.log('[Debug] Animator buffer has content:', hasContent, 'layer:', layerId);
    return !hasContent;
  } catch (error) {
    context.warn('[Debug] Failed to verify animator canvas content:', error);
    return false;
  }
}
