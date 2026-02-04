export type PresetGradientStop = { position: number; color: string };

export type PresetGradient = {
  id: string;
  name: string;
  stops: PresetGradientStop[];
};

// Central list of preset gradients to share across UI and rendering
export const GRADIENT_PRESETS: PresetGradient[] = [
  {
    id: 'bw-stripes',
    name: 'Black & White Stripes',
    stops: [
      { position: 0.0, color: '#000000' },   // deep black
      { position: 0.1, color: '#1f1f1f' },   // easing toward gray
      { position: 0.2, color: '#3f3f3f' },
      { position: 0.3, color: '#5f5f5f' },
      { position: 0.4, color: '#7f7f7f' },
      { position: 0.5, color: '#9f9f9f' },
      { position: 0.6, color: '#bfbfbf' },
      { position: 0.7, color: '#dfdfdf' },
      { position: 0.8, color: '#f5f5f5' },
      { position: 0.9, color: '#ffffff' },   // single white apex
      { position: 1.0, color: '#000000' }    // wrap back to black for loop continuity
    ]
  },
  {
    id: 'rainbow',
    name: 'Rainbow',
    stops: [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#8000ff' },
      { position: 1.0, color: '#ff0000' }
    ]
  },
  {
    id: 'classic-rgb',
    name: 'Classic RGB',
    stops: [
      { position: 0.0, color: '#ff0000' },
      { position: 0.5, color: '#00ff00' },
      { position: 1.0, color: '#0000ff' }
    ]
  },
  {
    id: 'acid',
    name: 'Acid',
    stops: [
      { position: 0.0, color: '#b7ff00' },
      { position: 0.5, color: '#fff200' },
      { position: 1.0, color: '#7fff00' }
    ]
  },
  {
    id: 'neon',
    name: 'Neon',
    stops: [
      { position: 0.0, color: '#ff4fd8' },
      { position: 0.5, color: '#7a00ff' },
      { position: 1.0, color: '#00e5ff' }
    ]
  },
  {
    id: 'cmy-split',
    name: 'CMY Split',
    stops: [
      { position: 0.0, color: '#00ffff' },
      { position: 0.5, color: '#ff00ff' },
      { position: 1.0, color: '#ffff00' }
    ]
  },
  {
    id: 'fire',
    name: 'Fire',
    stops: [
      { position: 0.0, color: '#000000' },
      { position: 0.3, color: '#800000' },
      { position: 0.6, color: '#ff4000' },
      { position: 0.8, color: '#ffff00' },
      { position: 1.0, color: '#ffffff' }
    ]
  },
  {
    id: 'ocean',
    name: 'Ocean',
    stops: [
      { position: 0.0, color: '#000040' },
      { position: 0.5, color: '#0080ff' },
      { position: 1.0, color: '#80ffff' }
    ]
  },
  {
    id: 'sunset',
    name: 'Sunset',
    stops: [
      { position: 0.0, color: '#4000ff' },
      { position: 0.3, color: '#ff0080' },
      { position: 0.6, color: '#ff8000' },
      { position: 1.0, color: '#ffff80' }
    ]
  },
  {
    id: 'mint',
    name: 'Mint',
    stops: [
      { position: 0.0, color: '#00ff88' },
      { position: 0.5, color: '#00ffff' },
      { position: 1.0, color: '#0088ff' }
    ]
  }
];

export const DEFAULT_GRADIENT_ID = 'bw-stripes';

export const DEFAULT_GRADIENT_STOPS: PresetGradientStop[] = (() => {
  const preset = GRADIENT_PRESETS.find(p => p.id === DEFAULT_GRADIENT_ID);
  return preset ? preset.stops.map(stop => ({ ...stop })) : [];
})();

export function getPresetStops(id: string): PresetGradientStop[] | null {
  const preset = GRADIENT_PRESETS.find(p => p.id === id);
  return preset ? preset.stops.map(stop => ({ ...stop })) : null;
}

export function getPresetOptions(): Array<{ value: string; label: string }>{
  return GRADIENT_PRESETS.map(p => ({ value: p.id, label: p.name }));
}

export function getPresetById(id: string): PresetGradient | null {
  const preset = GRADIENT_PRESETS.find(p => p.id === id);
  return preset
    ? {
        id: preset.id,
        name: preset.name,
        stops: preset.stops.map(stop => ({ ...stop }))
      }
    : null;
}
