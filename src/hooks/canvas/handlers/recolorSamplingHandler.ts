import type React from 'react';
import { RecolorManager } from '@/lib/colorCycle/RecolorManager';
import type { BrushSettings, Layer } from '@/types';
import type { RecolorSamplingState, EventHandlerDynamicDeps } from '../utils/types';
import { cssColorToHex } from './utils/colorSampling';

type SamplingStops = Array<{ position: number; color: string }>;

type RecolorSamplingDeps = {
  overlayCanvasRef: React.RefObject<HTMLCanvasElement>;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  updateRecolorSampling: (partial: Partial<RecolorSamplingState>) => void;
  stopRecolorSampling: () => void;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  sampleColorsAlongLine: (
    startX: number,
    startY: number,
    endX: number,
    endY: number,
    numSamples: number
  ) => string[];
};

type RecolorSamplingDynamicDeps = Pick<EventHandlerDynamicDeps, 'recolorSampling' | 'layers' | 'activeLayerId'>;

type Target = 'recolor' | 'brush';

type ApplySamplingParams = {
  target: Target;
  stops: SamplingStops;
  start: { x: number; y: number };
  end: { x: number; y: number };
  layers: Layer[];
  activeLayerId: string | null;
  setBrushSettings: (settings: Partial<BrushSettings>) => void;
  autoPlay: boolean;
};

const clearOverlay = (overlayCanvasRef: React.RefObject<HTMLCanvasElement>): void => {
  const overlayCanvas = overlayCanvasRef.current;
  if (!overlayCanvas) {
    return;
  }
  const overlayCtx = overlayCanvas.getContext('2d');
  overlayCtx?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
};

const applyRecolorSampling = ({
  target,
  stops,
  start,
  end,
  layers,
  activeLayerId,
  setBrushSettings,
  autoPlay,
}: ApplySamplingParams): void => {
  if (target === 'recolor') {
    const layer = layers.find(l => l.id === activeLayerId);
    if (layer) {
      const manager = RecolorManager.getInstance();
      (async () => {
        try {
          if (!layer.colorCycleData?.recolorSettings) {
            const ok = await manager.processLayer(layer, {
              quantizationMode: 'rgb332',
              ditherMode: 'off',
              cycleColors: 16,
              gradientPreset: 'custom',
              customGradient: stops
            });
            if (!ok) throw new Error('processLayer failed');
          } else {
            manager.updateGradient(layer, stops);
          }
          if (autoPlay) {
            try {
              manager.playSingle(layer.id);
            } catch (e) {
              console.warn('Failed to auto-play recolor animation:', e);
            }
          }
          const dx = end.x - start.x;
          const dy = end.y - start.y;
          const angle = (Math.atan2(dy, dx) * 180) / Math.PI;
          try { manager.setPaletteDirectionalOrder(layer.id, angle); } catch {}
          try { manager.autoSetAnimationDirection(layer.id, angle); } catch {}
        } catch (e) {
          console.warn('Failed to apply sampled gradient', e);
        }
      })();
    }
    return;
  }

  try {
    setBrushSettings({ colorCycleGradient: stops });
  } catch {}
};

export const handleRecolorSamplingPointerDown = ({
  deps,
  getDynamicDeps,
  worldPos,
}: {
  deps: RecolorSamplingDeps;
  getDynamicDeps: () => RecolorSamplingDynamicDeps;
  worldPos: { x: number; y: number };
}): boolean => {
  const rsUp = getDynamicDeps().recolorSampling;
  if (rsUp.active && rsUp.start) {
    const start = rsUp.start;
    const end = { x: worldPos.x, y: worldPos.y };
    const samples = Math.max(2, Math.min(32, rsUp.samples || 12));
    const colors = deps.sampleColorsAlongLine(start.x, start.y, end.x, end.y, samples);
    const stops = colors.map((c, i) => ({
      position: samples === 1 ? 0 : i / (samples - 1),
      color: cssColorToHex(c)
    }));
    const target = (rsUp.target || 'recolor') as Target;

    const { layers, activeLayerId } = getDynamicDeps();
    applyRecolorSampling({
      target,
      stops,
      start,
      end,
      layers,
      activeLayerId,
      setBrushSettings: deps.setBrushSettings,
      autoPlay: false,
    });

    clearOverlay(deps.overlayCanvasRef);
    deps.stopRecolorSampling();
    return true;
  }

  const rs1 = getDynamicDeps().recolorSampling;
  if (rs1.active) {
    deps.updateRecolorSampling({ start: { x: worldPos.x, y: worldPos.y }, end: null });
    clearOverlay(deps.overlayCanvasRef);
    return true;
  }

  return false;
};

export const handleRecolorSamplingPointerMove = ({
  deps,
  getDynamicDeps,
  worldPos,
  isPointerDown,
}: {
  deps: Pick<RecolorSamplingDeps, 'overlayCanvasRef' | 'viewTransformRef'>;
  getDynamicDeps: () => RecolorSamplingDynamicDeps;
  worldPos: { x: number; y: number };
  isPointerDown: boolean;
}): boolean => {
  const rsMove = getDynamicDeps().recolorSampling;
  if (rsMove.active && isPointerDown && rsMove.start) {
    const overlayCanvas = deps.overlayCanvasRef.current;
    const overlayCtx = overlayCanvas?.getContext('2d');
    if (overlayCtx && overlayCanvas) {
      overlayCtx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
      overlayCtx.save();
      overlayCtx.translate(deps.viewTransformRef.current.offsetX, deps.viewTransformRef.current.offsetY);
      overlayCtx.scale(deps.viewTransformRef.current.scale, deps.viewTransformRef.current.scale);
      overlayCtx.strokeStyle = '#00d1b2';
      overlayCtx.lineWidth = 2 / deps.viewTransformRef.current.scale;
      overlayCtx.beginPath();
      overlayCtx.moveTo(rsMove.start.x, rsMove.start.y);
      overlayCtx.lineTo(worldPos.x, worldPos.y);
      overlayCtx.stroke();
      overlayCtx.restore();
    }
    return true;
  }

  return false;
};

export const handleRecolorSamplingPointerUp = ({
  deps,
  getDynamicDeps,
  worldPos,
}: {
  deps: Pick<RecolorSamplingDeps, 'sampleColorsAlongLine' | 'setBrushSettings' | 'stopRecolorSampling'>;
  getDynamicDeps: () => RecolorSamplingDynamicDeps;
  worldPos: { x: number; y: number };
}): boolean => {
  const rsFinalize = getDynamicDeps().recolorSampling;
  if (!rsFinalize.active || !rsFinalize.start) {
    return false;
  }

  const startFinalize = rsFinalize.start;
  const endFinalize = { x: worldPos.x, y: worldPos.y };
  const samplesFinalize = Math.max(2, Math.min(32, rsFinalize.samples || 12));
  const colorsFinalize = deps.sampleColorsAlongLine(
    startFinalize.x,
    startFinalize.y,
    endFinalize.x,
    endFinalize.y,
    samplesFinalize
  );
  const stopsFinalize = colorsFinalize.map((c, i) => ({
    position: samplesFinalize === 1 ? 0 : i / (samplesFinalize - 1),
    color: cssColorToHex(c)
  }));
  const targetFinalize = (rsFinalize.target || 'recolor') as Target;

  const { layers, activeLayerId } = getDynamicDeps();
  applyRecolorSampling({
    target: targetFinalize,
    stops: stopsFinalize,
    start: startFinalize,
    end: endFinalize,
    layers,
    activeLayerId,
    setBrushSettings: deps.setBrushSettings,
    autoPlay: true,
  });

  deps.stopRecolorSampling();
  return true;
};
