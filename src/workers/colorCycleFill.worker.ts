/// <reference lib="webworker" />

import { applyDitheringWithFillResolution } from '@/hooks/brushEngine/dithering';
import type { ColorCycleFillWorkerResponse, PaletteMapEntry } from './colorCycleFillTypes';

type WorkerMessage = {
  id: number;
  job: import('./colorCycleFillTypes').PerceptualDitherJob;
};

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const buildPaletteMap = (entries: PaletteMapEntry[]) => {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(`${entry.rgb[0]},${entry.rgb[1]},${entry.rgb[2]}`, entry.index);
  }
  return map;
};

const handlePerceptualDither = (job: WorkerMessage['job']) => {
  const pixels = new Uint8ClampedArray(job.pixels);
  const img = new ImageData(pixels, job.width, job.height);
  const dithered = applyDitheringWithFillResolution(
    img,
    job.quantLevels,
    Math.max(1, job.ditherPixelSize),
    'sierra-lite',
    undefined,
    job.paletteCss
  );
  const out = dithered.data;
  const indices = new Uint8Array(job.width * job.height);
  const map = buildPaletteMap(job.paletteMapEntries);
  for (let i = 0; i < indices.length; i++) {
    const idx = i * 4;
    const key = `${out[idx]},${out[idx + 1]},${out[idx + 2]}`;
    const gi = map.get(key);
    if (gi && gi > 0) {
      const shifted = (gi - 1 + job.baseOffset) % 255;
      indices[i] = shifted + 1;
    }
  }
  return { width: job.width, height: job.height, indices: indices.buffer };
};

ctx.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, job } = event.data;
  const response: ColorCycleFillWorkerResponse = { id, ok: false };
  try {
    switch (job.type) {
      case 'perceptual-dither':
        response.result = handlePerceptualDither(job);
        response.ok = true;
        ctx.postMessage(response, response.result ? [response.result.indices] : undefined);
        return;
      default:
        throw new Error(`Unknown colorCycle fill job: ${job.type}`);
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
    ctx.postMessage(response);
  }
};
