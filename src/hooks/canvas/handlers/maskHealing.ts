import type { MaskManager } from '@/layers/MaskManager';
import type { BrushStampSource } from '@/tools/stamps/BrushStampSource';
import { applyPressureCurve } from '@/utils/pressureCurve';
import { resolveBrushPressureRange } from '@/utils/pressureSettings';
import { BrushShape } from '@/types';
import type { AppState } from '@/stores/useAppStore';

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
  createBrushStampSource: (options?: { forceOpaque?: boolean }) => BrushStampSource;
  maskManager: MaskManager;
  debugWarn: (message: string, error?: unknown) => void;
  isEnabled: boolean;
  getState: () => AppState;
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

export type CreateMaskHealingDispatchersArgs = {
  maskHealStateRef: React.MutableRefObject<MaskHealState | null>;
  createBrushStampSource: (options?: { forceOpaque?: boolean }) => BrushStampSource;
  maskManager: MaskManager;
  debugWarn: (message: string, error?: unknown) => void;
  isEnabled: boolean;
  getState: () => AppState;
};

type MaskTipShape = 'square' | 'round' | 'triangle' | 'diamond' | 'diamond5' | 'diamond7' | 'diamond9';

const resolveMaskTipShape = (state: AppState): MaskTipShape => {
  const settings = state.tools.brushSettings;
  if (settings.brushShape === BrushShape.COLOR_CYCLE_TRIANGLE) {
    return 'triangle';
  }
  return settings.colorCycleStampShape ?? 'square';
};

const resolveMaskTipSize = (state: AppState, pressure: number): number => {
  const settings = state.tools.brushSettings;
  let size = Math.max(1, settings.size ?? state.globalBrushSize ?? 1);
  const pressureRange = resolveBrushPressureRange(settings);
  if (pressureRange.enabled) {
    size *= applyPressureCurve(pressure, pressureRange.minPercent, pressureRange.maxPercent, 's-curve');
  }
  return Math.max(1, Math.round(size));
};

const drawInitialMaskTipStamp = (
  ctx: CanvasRenderingContext2D,
  point: { x: number; y: number },
  size: number,
  shape: MaskTipShape
): void => {
  const half = size / 2;
  const cx = Math.round(point.x);
  const cy = Math.round(point.y);

  if (shape === 'round') {
    ctx.beginPath();
    ctx.arc(cx, cy, half, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (shape === 'triangle') {
    ctx.beginPath();
    ctx.moveTo(cx, Math.round(cy - half));
    ctx.lineTo(Math.round(cx + half), Math.round(cy + half));
    ctx.lineTo(Math.round(cx - half), Math.round(cy + half));
    ctx.closePath();
    ctx.fill();
    return;
  }

  if (shape === 'diamond' || shape === 'diamond5' || shape === 'diamond7' || shape === 'diamond9') {
    if (shape === 'diamond5' || shape === 'diamond7' || shape === 'diamond9') {
      const gridSize =
        shape === 'diamond9'
          ? 9
          : shape === 'diamond7'
            ? 7
            : 5;
      const pixelScale = Math.max(1, Math.round(size / gridSize));
      const stampSize = gridSize * pixelScale;
      const originX = Math.round(cx - stampSize / 2);
      const originY = Math.round(cy - stampSize / 2);
      const mask = gridSize === 9
        ? [
          0, 0, 0, 0, 1, 0, 0, 0, 0,
          0, 0, 0, 1, 1, 1, 0, 0, 0,
          0, 0, 1, 1, 1, 1, 1, 0, 0,
          0, 1, 1, 1, 1, 1, 1, 1, 0,
          1, 1, 1, 1, 1, 1, 1, 1, 1,
          0, 1, 1, 1, 1, 1, 1, 1, 0,
          0, 0, 1, 1, 1, 1, 1, 0, 0,
          0, 0, 0, 1, 1, 1, 0, 0, 0,
          0, 0, 0, 0, 1, 0, 0, 0, 0,
        ]
        : gridSize === 7
          ? [
            0, 0, 0, 1, 0, 0, 0,
            0, 0, 1, 1, 1, 0, 0,
            0, 1, 1, 1, 1, 1, 0,
            1, 1, 1, 1, 1, 1, 1,
            0, 1, 1, 1, 1, 1, 0,
            0, 0, 1, 1, 1, 0, 0,
            0, 0, 0, 1, 0, 0, 0,
          ]
          : [
            0, 0, 1, 0, 0,
            0, 1, 1, 1, 0,
            1, 1, 1, 1, 1,
            0, 1, 1, 1, 0,
            0, 0, 1, 0, 0,
          ];
      for (let row = 0; row < gridSize; row += 1) {
        for (let col = 0; col < gridSize; col += 1) {
          if (mask[row * gridSize + col] === 0) continue;
          ctx.fillRect(
            originX + col * pixelScale,
            originY + row * pixelScale,
            pixelScale,
            pixelScale
          );
        }
      }
      return;
    }

    const diamondHalf = half;
    ctx.beginPath();
    ctx.moveTo(cx, Math.round(cy - diamondHalf));
    ctx.lineTo(Math.round(cx + diamondHalf), cy);
    ctx.lineTo(cx, Math.round(cy + diamondHalf));
    ctx.lineTo(Math.round(cx - diamondHalf), cy);
    ctx.closePath();
    ctx.fill();
    return;
  }

  ctx.fillRect(Math.round(cx - half), Math.round(cy - half), size, size);
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
    const stampSource = deps.createBrushStampSource({ forceOpaque: true });
    maskCtx.save();
    try {
      maskCtx.globalCompositeOperation = 'destination-out';
      maskCtx.globalAlpha = 1;
      maskCtx.imageSmoothingEnabled = false;
    } catch {}
    stampSource.begin(maskCtx, args.startPoint, args.pressure, { skipInitialStamp: true });
    const state = deps.getState();
    drawInitialMaskTipStamp(
      maskCtx,
      args.startPoint,
      resolveMaskTipSize(state, args.pressure),
      resolveMaskTipShape(state)
    );
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

export const createMaskHealingDispatchers = (
  args: CreateMaskHealingDispatchersArgs
): {
  beginMaskHealingStroke: (layerId: string, startPoint: { x: number; y: number }, pressure: number) => void;
  extendMaskHealingStroke: (from: { x: number; y: number }, to: { x: number; y: number }, pressure: number) => void;
  endMaskHealingStroke: () => void;
} => ({
  beginMaskHealingStroke: (layerId, startPoint, pressure) => {
    beginMaskHealingStroke(
      { layerId, startPoint, pressure, maskHealStateRef: args.maskHealStateRef },
      {
        createBrushStampSource: args.createBrushStampSource,
        maskManager: args.maskManager,
        debugWarn: args.debugWarn,
        isEnabled: args.isEnabled,
        getState: args.getState,
      }
    );
  },
  extendMaskHealingStroke: (from, to, pressure) => {
    extendMaskHealingStroke(
      { from, to, pressure, maskHealStateRef: args.maskHealStateRef },
      { debugWarn: args.debugWarn, isEnabled: args.isEnabled }
    );
  },
  endMaskHealingStroke: () => {
    endMaskHealingStroke(args.maskHealStateRef, {
      maskManager: args.maskManager,
      isEnabled: args.isEnabled,
    });
  },
});
