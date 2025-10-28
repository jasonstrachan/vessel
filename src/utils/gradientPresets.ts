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
      { position: 0.0, color: '#000000' },
      { position: 0.0625, color: '#ffffff' },
      { position: 0.125, color: '#000000' },
      { position: 0.1875, color: '#ffffff' },
      { position: 0.25, color: '#000000' },
      { position: 0.3125, color: '#ffffff' },
      { position: 0.375, color: '#000000' },
      { position: 0.4375, color: '#ffffff' },
      { position: 0.5, color: '#000000' },
      { position: 0.5625, color: '#ffffff' },
      { position: 0.625, color: '#000000' },
      { position: 0.6875, color: '#ffffff' },
      { position: 0.75, color: '#000000' },
      { position: 0.8125, color: '#ffffff' },
      { position: 0.875, color: '#000000' },
      { position: 0.9375, color: '#ffffff' },
      { position: 1.0, color: '#000000' }
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
