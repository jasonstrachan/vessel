import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';

export type MaskHealState = {
  ctx: CanvasRenderingContext2D;
  layerId: string;
  stampSource: BrushStampSource;
  dirty: boolean;
};

export type EndMaskHealingDeps = {
  maskManager: MaskManager;
  isEnabled: boolean;
};

export type BeginMaskHealingArgs = {
  layerId: string;
  startPoint: { x: number; y: number };
  pressure: number;
  maskHealStateRef: React.MutableRefObject<MaskHealState | null>;
};

export type BeginMaskHealingDeps = {
  createBrushStampSource: () => BrushStampSource;
  maskManager: MaskManager;
  debugWarn: (message: string, error?: unknown) => void;
  isEnabled: boolean;
};

export type ExtendMaskHealingArgs = {
  from: { x: number; y: number };
  to: { x: number; y: number };
  pressure: number;
  maskHealStateRef: React.MutableRefObject<MaskHealState | null>;
};

export type ExtendMaskHealingDeps = {
  debugWarn: (message: string, error?: unknown) => void;
  isEnabled: boolean;
};

export const endMaskHealingStroke = (
  maskHealStateRef: React.MutableRefObject<MaskHealState | null>,
  deps: EndMaskHealingDeps
): void => {
  const healState = maskHealStateRef.current;
  if (!healState) {
    return;
  }
  try {
    healState.stampSource.end();
  } catch {}
  try {
    healState.ctx.restore();
  } catch {}
  if (healState.dirty && deps.isEnabled) {
    try {
      deps.maskManager.bumpVersion(healState.layerId);
    } catch {}
  }
  maskHealStateRef.current = null;
};

export const beginMaskHealingStroke = (
  args: BeginMaskHealingArgs,
  deps: BeginMaskHealingDeps
): void => {
  if (!deps.isEnabled) {
    return;
  }
  endMaskHealingStroke(args.maskHealStateRef, deps);
  try {
    const maskCanvas = deps.maskManager.getMask(args.layerId);
    const maskCtx = maskCanvas.getContext('2d', { willReadFrequently: true });
    if (!maskCtx) {
      return;
    }
    const stampSource = deps.createBrushStampSource();
    maskCtx.save();
    try {
      maskCtx.globalCompositeOperation = 'destination-out';
      maskCtx.globalAlpha = 1;
      maskCtx.imageSmoothingEnabled = false;
    } catch {}
    stampSource.begin(maskCtx, args.startPoint, args.pressure);
    args.maskHealStateRef.current = {
      ctx: maskCtx,
      layerId: args.layerId,
      stampSource,
      dirty: true
    };
  } catch (error) {
    deps.debugWarn('[mask-heal] Failed to begin mask heal stroke', error);
    args.maskHealStateRef.current = null;
  }
};

export const extendMaskHealingStroke = (
  args: ExtendMaskHealingArgs,
  deps: ExtendMaskHealingDeps
): void => {
  if (!deps.isEnabled) {
    return;
  }
  const healState = args.maskHealStateRef.current;
  if (!healState) {
    return;
  }
  try {
    healState.stampSource.draw(healState.ctx, args.from, args.to, { pressure: args.pressure });
    healState.dirty = true;
  } catch (error) {
    deps.debugWarn('[mask-heal] Failed to extend mask heal stroke', error);
  }
};
