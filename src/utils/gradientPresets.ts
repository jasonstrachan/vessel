export type PresetGradientStop = { position: number; color: string };

export type PresetGradient = {
  id: string;
  name: string;
  stops: PresetGradientStop[];
};

// Central list of preset gradients to share across UI and rendering
export const GRADIENT_PRESETS: PresetGradient[] = [
  {
    id: 'rainbow',
    name: 'Rainbow',
    stops: [
      { position: 0.0, color: '#ff0000' },
      { position: 0.17, color: '#ff7f00' },
      { position: 0.33, color: '#ffff00' },
      { position: 0.5, color: '#00ff00' },
      { position: 0.67, color: '#0000ff' },
      { position: 0.83, color: '#4b0082' },
      { position: 1.0, color: '#9400d3' }
    ]
  },
  {
    id: 'fire',
    name: 'Fire',
    stops: [
      { position: 0.0, color: '#ff0000' },
      { position: 0.33, color: '#ff7f00' },
      { position: 0.67, color: '#ffff00' },
      { position: 1.0, color: '#ff0000' }
    ]
  },
  {
    id: 'ocean',
    name: 'Ocean',
    stops: [
      { position: 0.0, color: '#001f3f' },
      { position: 0.5, color: '#0074d9' },
      { position: 1.0, color: '#001f3f' }
    ]
  },
  {
    id: 'sunset',
    name: 'Sunset',
    stops: [
      { position: 0.0, color: '#ff6b6b' },
      { position: 0.33, color: '#ffa500' },
      { position: 0.67, color: '#ffd700' },
      { position: 1.0, color: '#4b0082' }
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

export function getPresetStops(id: string): PresetGradientStop[] | null {
  const preset = GRADIENT_PRESETS.find(p => p.id === id);
  return preset ? preset.stops : null;
}

export function getPresetOptions(): Array<{ value: string; label: string }>{
  return GRADIENT_PRESETS.map(p => ({ value: p.id, label: p.name }));
}

