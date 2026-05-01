import type { GradientStop } from '@/lib/GradientPalette';
import {
  appendGradientSeamProfileSignature,
  normalizeGradientSeamProfile,
  type GradientSeamProfile,
} from '@/lib/colorCycle/gradientSeamProfile';
import { ensurePalette } from '@/lib/colorCycle/paletteService';

export type DefPaletteEntry = {
  id: number;
  hash: string;
  stops?: GradientStop[];
  seamProfile?: GradientSeamProfile;
};

export type DefPaletteCache = {
  signature: string;
  palettesById: Map<number, Uint32Array>;
  rgbaById: Map<number, Uint8ClampedArray | Uint8Array>;
  signaturesById: Map<number, string>;
};

export const buildDefStopsSignature = (stops: GradientStop[] | undefined): string => {
  if (!Array.isArray(stops) || stops.length === 0) {
    return '';
  }
  return stops
    .map((stop) => `${stop.position}:${stop.color}:${Number.isFinite(stop.opacity) ? stop.opacity : 1}`)
    .join('|');
};

export const buildDefPaletteSignature = (defs: DefPaletteEntry[]): string =>
  defs
    .map((entry) => {
      const stopsSignature = buildDefStopsSignature(entry.stops);
      return `${entry.id}:${appendGradientSeamProfileSignature(entry.hash, entry.seamProfile)}:${stopsSignature}`;
    })
    .sort()
    .join('|');

export const createDefPaletteCache = (defs: DefPaletteEntry[]): DefPaletteCache => {
  const palettesById = new Map<number, Uint32Array>();
  const rgbaById = new Map<number, Uint8ClampedArray | Uint8Array>();
  const signaturesById = new Map<number, string>();

  for (const def of defs) {
    if (!def || !def.stops || def.stops.length === 0) {
      continue;
    }
    const handle = ensurePalette({
      stops: def.stops,
      seamProfile: normalizeGradientSeamProfile(def.seamProfile),
    });
    const stopsSignature = buildDefStopsSignature(def.stops);
    palettesById.set(def.id, handle.uint32);
    rgbaById.set(def.id, handle.rgba);
    signaturesById.set(def.id, `${appendGradientSeamProfileSignature(def.hash, def.seamProfile)}:${stopsSignature}`);
  }

  return {
    signature: buildDefPaletteSignature(defs),
    palettesById,
    rgbaById,
    signaturesById,
  };
};
