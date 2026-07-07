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
  builtFromVersion: number | null;
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

export const createDefPaletteCache = (
  defs: DefPaletteEntry[],
  builtFromVersion: number | null,
): DefPaletteCache => {
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
    builtFromVersion,
    palettesById,
    rgbaById,
    signaturesById,
  };
};

export class ColorCycleDefPaletteCacheStore {
  private readonly cacheByLayer = new Map<string, DefPaletteCache>();
  private readonly appliedCacheByLayer = new Map<string, DefPaletteCache | null>();

  get(
    layerId: string,
    defs: DefPaletteEntry[] | undefined,
    builtFromVersion: number | null,
  ): DefPaletteCache | null {
    if (!defs || defs.length === 0) {
      this.cacheByLayer.delete(layerId);
      this.appliedCacheByLayer.delete(layerId);
      return null;
    }

    const signature = buildDefPaletteSignature(defs);
    const existing = this.cacheByLayer.get(layerId);
    if (
      existing &&
      existing.signature === signature &&
      existing.builtFromVersion === builtFromVersion
    ) {
      return existing;
    }

    const nextCache = createDefPaletteCache(defs, builtFromVersion);
    this.cacheByLayer.set(layerId, nextCache);
    return nextCache;
  }

  getLastApplied(layerId: string): DefPaletteCache | null {
    return this.appliedCacheByLayer.get(layerId) ?? null;
  }

  setLastApplied(layerId: string, cache: DefPaletteCache | null): void {
    this.appliedCacheByLayer.set(layerId, cache);
  }

  clear(): void {
    this.cacheByLayer.clear();
    this.appliedCacheByLayer.clear();
  }
}
