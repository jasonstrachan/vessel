import { type BrushSettings } from '@/types';

import type { RenderSettings } from './types';
import { shouldSkipPigmentLiftWithTransparencyLock } from './utilities';

export const createPigmentLiftController = (): {
  applyPigmentLift: (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    settings: RenderSettings,
    brushSettings: BrushSettings,
  ) => void;
  reset: () => void;
} => {
  let pigmentLiftMask: HTMLCanvasElement | null = null;
  let pigmentLiftMaskKey = '';

  const buildPigmentLiftMask = (
    size: number,
    feather: number,
    noise: number,
  ): HTMLCanvasElement | null => {
    if (typeof document === 'undefined') {
      return null;
    }

    const radius = Math.max(1, size / 2);
    const featherAmount = Math.max(0, feather);
    const maskSize = Math.max(2, Math.round(radius * 2 + featherAmount * 2));
    const key = `${maskSize}-${Math.round(featherAmount * 10)}-${Math.round(noise * 100)}`;

    if (pigmentLiftMask && pigmentLiftMaskKey === key) {
      return pigmentLiftMask;
    }

    const canvas = document.createElement('canvas');
    canvas.width = maskSize;
    canvas.height = maskSize;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return null;
    }

    const imageData = ctx.createImageData(maskSize, maskSize);
    const data = imageData.data;
    const cx = maskSize / 2;
    const cy = maskSize / 2;
    const noiseAmount = Math.min(1, Math.max(0, noise));

    for (let y = 0; y < maskSize; y += 1) {
      for (let x = 0; x < maskSize; x += 1) {
        const dx = x + 0.5 - cx;
        const dy = y + 0.5 - cy;
        const distance = Math.sqrt(dx * dx + dy * dy);
        const inCore = distance <= radius;
        let falloff = 0;
        if (!inCore && featherAmount > 0) {
          const over = distance - radius;
          falloff = Math.max(0, 1 - over / featherAmount);
        } else if (inCore) {
          falloff = 1;
        }

        if (falloff <= 0) {
          continue;
        }

        const noiseCut = noiseAmount > 0 ? noiseAmount * Math.random() : 0;
        const fullHole = noiseAmount > 0 && Math.random() < noiseAmount * 0.5;
        const alpha = fullHole
          ? 0
          : Math.max(0, Math.min(1, falloff * (1 - noiseCut * 1.6)));
        if (alpha <= 0) {
          continue;
        }

        const idx = (y * maskSize + x) * 4;
        data[idx] = 255;
        data[idx + 1] = 255;
        data[idx + 2] = 255;
        data[idx + 3] = Math.round(alpha * 255);
      }
    }

    ctx.putImageData(imageData, 0, 0);
    pigmentLiftMask = canvas;
    pigmentLiftMaskKey = key;
    return canvas;
  };

  const applyPigmentLift = (
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    settings: RenderSettings,
    brushSettings: BrushSettings,
  ): void => {
    const strength = Math.max(0, Math.min(1, brushSettings.pigmentLiftStrength ?? 0));
    if (
      !brushSettings.pigmentLiftEnabled ||
      strength <= 0 ||
      brushSettings.blendMode === 'destination-out'
    ) {
      return;
    }

    if (shouldSkipPigmentLiftWithTransparencyLock(ctx, x, y, brushSettings.transparencyLockEnabled)) {
      return;
    }

    const effectiveNoise = Math.min(1.2, (brushSettings.pigmentLiftNoise ?? 0) * 1.8);
    const mask = buildPigmentLiftMask(
      settings.size,
      brushSettings.pigmentLiftFeather ?? 0,
      effectiveNoise,
    );

    if (!mask) {
      return;
    }

    const prevComposite = ctx.globalCompositeOperation;
    const prevAlpha = ctx.globalAlpha;

    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = strength;
    const drawX = x - mask.width / 2;
    const drawY = y - mask.height / 2;
    ctx.drawImage(mask, drawX, drawY);

    ctx.globalCompositeOperation = prevComposite;
    ctx.globalAlpha = prevAlpha;
  };

  return {
    applyPigmentLift,
    reset: () => {
      pigmentLiftMask = null;
      pigmentLiftMaskKey = '';
    },
  };
};
