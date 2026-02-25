type Goblet2Layer = {
  id: string;
  name: string;
  type: string;
  source: { width: number; height: number };
  documentBoundsPx: { x: number; y: number; width: number; height: number };
  documentBoundsPercent: { x: number; y: number; width: number; height: number };
  alignment: { fit: string; horizontal: string; vertical: string; positioning: string };
  colorCycle?: Record<string, unknown>;
};

export const createGoblet2Bundle = (overrides: Partial<{ layers: Goblet2Layer[] }> = {}) => {
  const baseLayer: Goblet2Layer = {
    id: 'layer-0',
    name: 'Layer 0',
    type: 'color-cycle',
    source: { width: 2, height: 2 },
    documentBoundsPx: { x: 0, y: 0, width: 2, height: 2 },
    documentBoundsPercent: { x: 0, y: 0, width: 1, height: 1 },
    alignment: { fit: 'none', horizontal: 'left', vertical: 'top', positioning: 'anchor' },
    colorCycle: {
      mode: 'brush',
      speedMin: 0.1,
      speedMax: 0.3,
      isAnimating: true,
      brushState: {
        width: 2,
        height: 2,
        indexBuffer: [1, 2, 3, 4],
        gradientIdBuffer: [0, 0, 0, 0],
        speedBuffer: [255, 255, 255, 255],
        gradientStops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' }
        ],
        animationOffset: 0
      },
      slotPalettes: [
        {
          slot: 0,
          stops: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' }
          ]
        }
      ]
    }
  };

  return {
    format: 'vessel-goblet2',
    version: 1,
    exportedAt: new Date('2025-01-01T00:00:00Z').toISOString(),
    project: {
      id: 'proj-0',
      name: 'Goblet2 Fixture',
      width: 2,
      height: 2,
      backgroundColor: '#000000'
    },
    colorCycle: {
      schemaVersion: 2
    },
    viewport: {
      mode: 'fixed',
      designWidth: 2,
      designHeight: 2
    },
    container: {
      padding: { top: 0, right: 0, bottom: 0, left: 0 },
      sizeMode: 'fill'
    },
    animation: {
      fps: 30,
      totalFrames: 60,
      durationSeconds: 2,
      perfectLoop: false
    },
    settings: {
      includeHiddenLayers: true,
      embedCanvasFallback: false,
      minifyOutput: false,
      perfectLoop: false,
      bundleFormat: 'json',
      htmlTitle: 'Goblet2 Fixture'
    },
    layers: overrides.layers ?? [baseLayer]
  };
};
