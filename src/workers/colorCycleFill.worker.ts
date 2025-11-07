/// <reference lib="webworker" />

import { applyDitheringWithFillResolution } from '@/hooks/brushEngine/dithering';
import { fillConcentricToBuffer } from '@/utils/colorCycle/concentricFillCore';
import type {
  ColorCycleFillWorkerResponse,
  ConcentricFillJob,
  PaletteMapEntry,
} from './colorCycleFillTypes';

type WorkerMessage = {
  id: number;
  job: import('./colorCycleFillTypes').ColorCycleFillJob;
};

const ctx: DedicatedWorkerGlobalScope = self as unknown as DedicatedWorkerGlobalScope;

const buildPaletteMap = (entries: PaletteMapEntry[]) => {
  const map = new Map<string, number>();
  for (const entry of entries) {
    map.set(`${entry.rgb[0]},${entry.rgb[1]},${entry.rgb[2]}`, entry.index);
  }
  return map;
};

const handlePerceptualDither = (job: import('./colorCycleFillTypes').PerceptualDitherJob) => {
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

const unpackVertices = (flat: Float32Array) => {
  const out: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < flat.length; i += 2) {
    out.push({ x: flat[i], y: flat[i + 1] });
  }
  return out;
};

const handleConcentricFill = async (job: ConcentricFillJob) => {
  const buffer = await fillConcentricToBuffer({
    vertices: unpackVertices(job.vertices),
    bbox: job.bbox,
    bands: job.bands,
    baseOffset: job.baseOffset,
    maxDist: job.maxDist,
    ditherEnabled: job.ditherEnabled,
    ditherStrength: job.ditherStrength,
    ditherPixelSize: job.ditherPixelSize,
    noiseSeed: job.noiseSeed,
  });
  return { width: job.bbox.width, height: job.bbox.height, indices: buffer.buffer };
};

ctx.onmessage = (event: MessageEvent<WorkerMessage>) => {
  const { id, job } = event.data;
  const response: ColorCycleFillWorkerResponse = { id, ok: false, type: job.type };
  try {
    switch (job.type) {
      case 'perceptual-dither':
        response.result = handlePerceptualDither(job);
        response.ok = true;
        ctx.postMessage(response, response.result ? [response.result.indices] : undefined);
        return;
      case 'concentric-fill':
        handleConcentricFill(job).then((result) => {
          response.result = result;
          response.ok = true;
          ctx.postMessage(response, [result.indices]);
        }).catch((error) => {
          response.error = error instanceof Error ? error.message : String(error);
          ctx.postMessage(response);
        });
        return;
      default:
        throw new Error(`Unknown colorCycle fill job: ${job.type}`);
    }
  } catch (error) {
    response.error = error instanceof Error ? error.message : String(error);
    ctx.postMessage(response);
  }
};
