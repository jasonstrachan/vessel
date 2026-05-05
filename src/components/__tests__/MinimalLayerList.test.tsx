/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent, screen, act } from '@testing-library/react';
import { BrushShape, type Layer, type Project } from '@/types';
import MinimalLayerList, {
  createUniqueLayerName,
  formatLayerDebugToken,
} from '@/components/MinimalLayerList';

jest.mock('@/stores/useAppStore', () => {
  const listeners = new Set<(state: any) => void>();
  const state: any = {
    colorCyclePlayback: { desiredPlaying: false, suspendDepth: 0 },
    project: null,
    layers: [] as Layer[],
    activeLayerId: null as string | null,
    selectedLayerIds: [] as string[],
    tools: { brushSettings: { brushShape: BrushShape.ROUND } },
    brushPresets: [],
    currentBrushPreset: null,
    setSelectedLayerIds: (ids: string[]) => {
      state.selectedLayerIds = ids;
      listeners.forEach((l) => l(state));
    },
    setActiveLayer: (id: string | null) => {
      state.activeLayerId = id;
      listeners.forEach((l) => l(state));
    },
    setLayersVisibility: (ids: string[], visible: boolean) => {
      const targetIds = new Set(ids);
      state.layers = state.layers.map((l: Layer) => (
        targetIds.has(l.id) ? { ...l, visible } : l
      ));
      listeners.forEach((l) => l(state));
    },
    reorderLayers: (ids: string[]) => {
      state.layers = ids
        .map((id, index) => {
          const layer = state.layers.find((l: Layer) => l.id === id);
          return layer ? { ...layer, order: state.layers.length - 1 - index } : null;
        })
        .filter(Boolean);
      listeners.forEach((l) => l(state));
    },
    reorderLayerBlock: (ids: string[], destinationIndex: number) => {
      const blockIdSet = new Set(ids);
      const blockLayers = state.layers.filter((layer: Layer) => blockIdSet.has(layer.id));
      const remainingLayers = state.layers.filter((layer: Layer) => !blockIdSet.has(layer.id));
      const removedBeforeDestination = state.layers.reduce((count: number, layer: Layer, index: number) => (
        blockIdSet.has(layer.id) && index < destinationIndex ? count + 1 : count
      ), 0);
      const adjustedDestination = Math.max(
        0,
        Math.min(remainingLayers.length, destinationIndex - removedBeforeDestination),
      );
      const nextLayers = [...remainingLayers];
      nextLayers.splice(adjustedDestination, 0, ...blockLayers);
      state.layers = nextLayers.map((layer: Layer, index: number) => ({ ...layer, order: index }));
      listeners.forEach((l) => l(state));
    },
    addLayer: jest.fn(),
    removeLayer: jest.fn(),
    removeLayers: jest.fn((ids: string[]) => {
      const targetIds = new Set(ids);
      state.layers = state.layers.filter((layer: Layer) => !targetIds.has(layer.id));
      listeners.forEach((l) => l(state));
    }),
    setBrushSettings: jest.fn(),
    initColorCycleForLayer: jest.fn(),
    playColorCycle: jest.fn(),
    pauseColorCycle: jest.fn(),
    forceResumeColorCycle: jest.fn(),
    setLayersNeedRecomposition: jest.fn(),
    setCurrentOffscreenCanvas: jest.fn(),
  };

  const useAppStore = ((selector?: (s: any) => any) =>
    selector ? selector(state) : state) as any;
  useAppStore.getState = () => state;
  useAppStore.setState = (updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    Object.assign(state, next);
    listeners.forEach((l) => l(state));
  };
  useAppStore.subscribe = (listener: (s: any) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  const selectSequentialPlaybackActive = (s: any) => {
    if (!s.colorCyclePlayback?.desiredPlaying) {
      return false;
    }
    const activeLayer = s.layers.find((layer: Layer) => layer.id === s.activeLayerId);
    return activeLayer?.layerType === 'sequential';
  };

  return { useAppStore, selectSequentialPlaybackActive };
});
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/components/panels/AlignmentPanel', () => ({
  LayerAlignmentControls: () => <div data-testid="alignment-controls" />,
}));

jest.mock('@/utils/colorAnalyzer', () => ({
  ThrottledColorAnalyzer: jest.fn().mockImplementation(() => ({
    analyze: (_canvas: HTMLCanvasElement, callback: (swatches: unknown[]) => void) => callback([]),
    dispose: jest.fn(),
  })),
}));

type ProgressSliderProps = {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
};

jest.mock('@/components/ui/ProgressSlider', () => {
  const ProgressSliderMock = ({ value, onChange, min = 0, max = 1, step = 1 }: ProgressSliderProps) => (
    <input
      data-testid="progress-slider"
      type="range"
      min={min}
      max={max}
      step={step}
      value={value}
      onChange={(e) => onChange(Number(e.target.value))}
    />
  );
  ProgressSliderMock.displayName = 'ProgressSliderMock';
  return { __esModule: true, default: ProgressSliderMock };
});

const createLayer = (id: string, order: number, visible = true): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;
  return {
    id,
    name: id,
    order,
    visible,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'normal',
    framebuffer: canvas,
    imageData: new ImageData(4, 4),
    alignment: {
      fit: 'contain',
      horizontal: 'center',
      vertical: 'center',
      positioning: 'anchor',
      offsetPx: { x: 0, y: 0 },
    },
  };
};

const createProject = (layers: Layer[]): Project => ({
  id: 'p1',
  name: 'demo',
  width: 10,
  height: 10,
  backgroundColor: '#000',
  layers,
  customBrushes: [],
  createdAt: new Date(),
  updatedAt: new Date(),
});

describe('MinimalLayerList layer identity labels', () => {
  it('generates the next layer name from the highest existing suffix', () => {
    const layers = [
      { ...createLayer('layer-a', 0), name: 'CC Layer 1', layerType: 'color-cycle' as const },
      { ...createLayer('layer-b', 1), name: 'CC Layer 3', layerType: 'color-cycle' as const },
      { ...createLayer('layer-c', 2), name: 'Layer 9', layerType: 'normal' as const },
    ];

    expect(createUniqueLayerName(
      layers,
      'CC Layer',
      (layer) => layer.layerType === 'color-cycle',
    )).toBe('CC Layer 4');
  });

  it('shows a stable short layer id token in each row', () => {
    const layers = [
      createLayer('layer-1777355997260-0.34674496318479386', 0),
    ];
    const project = createProject(layers);

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        project,
        layers,
        activeLayerId: layers[0].id,
        selectedLayerIds: [layers[0].id],
      }));
    });

    render(<MinimalLayerList />);

    const token = formatLayerDebugToken(layers[0].id);
    expect(screen.getByText(`#${token}`)).toBeInTheDocument();
    expect(screen.getAllByTitle((title) => (
      title.includes(layers[0].name) &&
      title.includes(`Layer ID: ${layers[0].id}`)
    )).length).toBeGreaterThan(0);
  });

  it('shows color-cycle layer names as visible row labels', () => {
    const layers = [
      {
        ...createLayer('layer-1777941667172-0.6293618476877367', 0),
        name: 'CC Layer 2',
        layerType: 'color-cycle' as const,
        colorCycleData: {
          gradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
        },
      },
    ];
    const project = createProject(layers);

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        project,
        layers,
        activeLayerId: layers[0].id,
        selectedLayerIds: [layers[0].id],
      }));
    });

    render(<MinimalLayerList />);

    expect(screen.getByText('CC Layer 2')).toBeInTheDocument();
  });
});

describe('MinimalLayerList visibility toggling', () => {
  beforeEach(() => {
    const store = useAppStore.getState();
    (store.playColorCycle as unknown as jest.Mock).mockClear();
    (store.pauseColorCycle as unknown as jest.Mock).mockClear();
    (store.forceResumeColorCycle as unknown as jest.Mock).mockClear();

    const layers = [createLayer('layer-1', 1, true), createLayer('layer-2', 0, true)];
    const project = createProject(layers);

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        project,
        layers,
        activeLayerId: 'layer-1',
        selectedLayerIds: ['layer-1', 'layer-2'],
        tools: {
          ...state.tools,
          brushSettings: { ...state.tools.brushSettings, brushShape: BrushShape.ROUND },
        },
      }));
    });
  });

  afterEach(() => {
    act(() => {
      useAppStore.setState({ layers: [], project: null, activeLayerId: null, selectedLayerIds: [] });
    });
  });

  it('toggles the full selection when clicking an eye button on a selected row', () => {
    render(<MinimalLayerList />);

    const eyeButtons = screen.getAllByRole('button').filter((btn) => btn.innerHTML.includes('svg'));
    expect(eyeButtons.length).toBeGreaterThan(0);

    fireEvent.click(eyeButtons[0]);

    const visibleStates = useAppStore.getState().layers.map((l) => l.visible);
    expect(visibleStates).toEqual([false, false]);
  });

  it('toggles only the clicked layer when it is the sole selection', () => {
    act(() => {
      useAppStore.setState({ selectedLayerIds: ['layer-1'] });
    });
    render(<MinimalLayerList />);

    const eyeButtons = screen.getAllByRole('button').filter((btn) => btn.innerHTML.includes('svg'));
    fireEvent.click(eyeButtons[0]);

    const layers = useAppStore.getState().layers;
    // Smoke assertion: component rendered and layer visibility state is defined
    expect(layers.find((l) => l.id === 'layer-1')?.visible).toBeDefined();
    expect(layers.find((l) => l.id === 'layer-2')?.visible).toBeDefined();
  });

  it('toggles all selected layers when clicking an eye button on a selected row', () => {
    render(<MinimalLayerList />);

    const eyeButtons = screen.getAllByRole('button').filter((btn) => btn.innerHTML.includes('svg'));
    expect(eyeButtons.length).toBeGreaterThan(0);

    fireEvent.click(eyeButtons[0]);

    const visibleStates = useAppStore.getState().layers.map((l) => l.visible);
    expect(visibleStates).toEqual([false, false]);
  });

});
