import { createSequentialFrameDelta } from '@/history/deltas/sequentialFrameDelta';
import { useAppStore } from '@/stores/useAppStore';
import { BrushShape, type Layer, type SequentialLayerData } from '@/types';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

const createSequentialLayer = (id: string, sequentialData: SequentialLayerData): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 16;
  return {
    id,
    name: id,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: canvas,
    alignment: createDefaultLayerAlignment(),
    layerType: 'sequential',
    sequentialData,
  };
};

const createSequentialData = (eventIds: string[]): SequentialLayerData => ({
  frameCount: 12,
  fps: 12,
  durationMs: 1000,
  events: eventIds.map((id, index) => ({
    id,
    layerId: 'layer-seq',
    strokeId: `stroke-${index}`,
    timestampMs: index,
    frameIndex: index % 12,
    brush: {
      tool: 'brush',
      brushShape: BrushShape.ROUND,
      size: 8,
      opacity: 1,
      blendMode: 'source-over',
      rotation: 0,
      spacing: 1,
      color: '#ff0000',
      customStampId: null,
    },
    stamps: [{ x: 1 + index, y: 1, pressure: 1, rotation: 0, size: 8, alpha: 1 }],
  })),
});

describe('SequentialFrameDelta', () => {
  beforeEach(() => {
    const before = createSequentialData(['event-a']);
    useAppStore.setState((state) => ({
      layers: [createSequentialLayer('layer-seq', before)],
      activeLayerId: 'layer-seq',
      project: state.project
        ? { ...state.project, width: 16, height: 16 }
        : state.project,
    }));
  });

  it('applies backward and forward sequential payloads', () => {
    const before = createSequentialData(['event-a']);
    const after = createSequentialData(['event-a', 'event-b', 'event-c']);
    useAppStore.getState().updateLayer(
      'layer-seq',
      { sequentialData: after },
      { skipColorCycleSync: true }
    );

    const delta = createSequentialFrameDelta({
      layerId: 'layer-seq',
      before,
      after,
    });

    void delta.apply('backward');
    let layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual(['event-a']);

    void delta.apply('forward');
    layer = useAppStore.getState().layers.find((entry) => entry.id === 'layer-seq');
    expect(layer?.sequentialData?.events.map((event) => event.id)).toEqual([
      'event-a',
      'event-b',
      'event-c',
    ]);
  });
});
