import type { BrushSettings, Layer } from '@/types';

export type GradientStop = { position: number; color: string };

export const DEFAULT_CC_GRADIENT: GradientStop[] = [
  { position: 0.0, color: '#ff0000' },
  { position: 0.17, color: '#ff7f00' },
  { position: 0.33, color: '#ffff00' },
  { position: 0.5, color: '#00ff00' },
  { position: 0.67, color: '#0000ff' },
  { position: 0.83, color: '#4b0082' },
  { position: 1.0, color: '#9400d3' }
];

export const cloneStops = (stops: GradientStop[]): GradientStop[] =>
  stops.map((stop) => ({ position: stop.position, color: stop.color }));

export const getNextGradientSlot = (usedSlots: Set<number>): number | null => {
  for (let i = 0; i < 256; i += 1) {
    if (!usedSlots.has(i)) {
      return i;
    }
  }
  return null;
};

export const resolveActiveColorCycleGradient = (
  layer: Layer,
  brushSettings: BrushSettings
): {
  gradientDefs: Array<{ id: string; currentSlot: number }>;
  slotPalettes: Array<{ slot: number; stops: GradientStop[] }>;
  activeGradientId: string;
  activeSlot: number;
  activeStops: GradientStop[];
  needsBootstrap: boolean;
} => {
  const fallbackStops =
    layer.colorCycleData?.gradient ??
    brushSettings.colorCycleGradient ??
    DEFAULT_CC_GRADIENT;
  const gradientDefs = layer.colorCycleData?.gradientDefs?.length
    ? layer.colorCycleData.gradientDefs
    : [{ id: 'g0', currentSlot: 0 }];
  const slotPalettes = layer.colorCycleData?.slotPalettes?.length
    ? layer.colorCycleData.slotPalettes
    : [{ slot: 0, stops: fallbackStops }];
  const activeGradientId = layer.colorCycleData?.activeGradientId ?? gradientDefs[0].id;
  const activeDef =
    gradientDefs.find((entry) => entry.id === activeGradientId) ?? gradientDefs[0];
  const activeSlot = activeDef?.currentSlot ?? 0;
  const activePalette = slotPalettes.find((entry) => entry.slot === activeSlot);
  const activeStops =
    activePalette?.stops && activePalette.stops.length > 0
      ? activePalette.stops
      : fallbackStops;
  const hasActiveId =
    Boolean(layer.colorCycleData?.activeGradientId) &&
    gradientDefs.some((entry) => entry.id === layer.colorCycleData?.activeGradientId);
  const needsBootstrap = !layer.colorCycleData?.gradientDefs?.length || !hasActiveId;
  return {
    gradientDefs,
    slotPalettes,
    activeGradientId,
    activeSlot,
    activeStops,
    needsBootstrap,
  };
};

export const parseCssColorToRgba = (color: string): [number, number, number, number] => {
  const hex = color?.trim().toLowerCase();
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  if (hex?.startsWith('#')) {
    const raw = hex.slice(1);
    if (raw.length === 3 || raw.length === 4) {
      const r = parseInt(raw[0] + raw[0], 16);
      const g = parseInt(raw[1] + raw[1], 16);
      const b = parseInt(raw[2] + raw[2], 16);
      const a = raw.length === 4 ? parseInt(raw[3] + raw[3], 16) : 255;
      return [clamp(r), clamp(g), clamp(b), clamp(a)];
    }
    if (raw.length === 6 || raw.length === 8) {
      const r = parseInt(raw.slice(0, 2), 16);
      const g = parseInt(raw.slice(2, 4), 16);
      const b = parseInt(raw.slice(4, 6), 16);
      const a = raw.length === 8 ? parseInt(raw.slice(6, 8), 16) : 255;
      return [clamp(r), clamp(g), clamp(b), clamp(a)];
    }
  }

  // Fallback: use canvas parsing for named/rgba strings when DOM is available
  if (typeof document !== 'undefined') {
    const ctx = document.createElement('canvas').getContext('2d');
    if (ctx) {
      ctx.fillStyle = '#000';
      ctx.fillStyle = color;
      const computed = ctx.fillStyle;
      if (typeof computed === 'string' && computed.startsWith('rgb')) {
        const m = computed.match(/rgba?\\(([^)]+)\\)/);
        if (m?.[1]) {
          const parts = m[1].split(',').map(part => parseFloat(part.trim()));
          const [r, g, b, a = 1] = parts;
          return [clamp(r), clamp(g), clamp(b), clamp(a * 255)];
        }
      }
    }
  }

  return [0, 0, 0, 255];
};
