import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import type { Layer } from '@/types';

jest.mock('@/components/MinimalLayerList', () => ({
  LayerColorSwatches: () => <div data-testid="layer-swatches" />,
}));

jest.mock('@/components/ui/ProgressSlider', () => {
  const ProgressSliderMock = ({
    value,
    onChange,
  }: {
    value: number;
    onChange: (value: number) => void;
  }) => (
    <input
      aria-label="Layer Opacity"
      data-testid="progress-slider"
      type="range"
      value={value}
      onChange={(event) => onChange(Number(event.target.value))}
    />
  );

  ProgressSliderMock.displayName = 'ProgressSliderMock';

  return {
    __esModule: true,
    default: ProgressSliderMock,
  };
});

type StoreState = {
  layers: Layer[];
  layerGroups: Array<{ id: string; name: string }>;
  activeLayerId: string | null;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  sequentialRecord: {
    frameCount: number;
    fps: number;
  };
  addLayer: jest.Mock;
  duplicateLayer: jest.Mock;
  removeLayer: jest.Mock;
  updateLayer: jest.Mock;
  setActiveLayer: jest.Mock;
  reorderLayers: jest.Mock;
  setSelectedLayerIds: jest.Mock;
  selectLayerAlpha: jest.Mock;
  initColorCycleForLayer: jest.Mock;
  setReferenceLayer: jest.Mock;
  setBrushSettings: jest.Mock;
  mergeLayers: jest.Mock;
  setLayersVisibility: jest.Mock;
  toggleLayersVisibility: jest.Mock;
  createLayerGroupFromSelection: jest.Mock;
  removeLayerGroup: jest.Mock;
  setLayerGroupVisibility: jest.Mock;
};

const listeners = new Set<() => void>();

const state: StoreState = {
  layers: [],
  layerGroups: [],
  activeLayerId: null,
  selectedLayerIds: [],
  referenceLayerId: null,
  sequentialRecord: {
    frameCount: 24,
    fps: 24,
  },
  addLayer: jest.fn(() => null),
  duplicateLayer: jest.fn(() => null),
  removeLayer: jest.fn(),
  updateLayer: jest.fn((layerId: string, updates: Partial<Layer>) => {
    state.layers = state.layers.map((layer) => (layer.id === layerId ? { ...layer, ...updates } : layer));
  }),
  setActiveLayer: jest.fn((layerId: string | null) => {
    state.activeLayerId = layerId;
  }),
  reorderLayers: jest.fn(),
  setSelectedLayerIds: jest.fn((layerIds: string[]) => {
    state.selectedLayerIds = [...layerIds];
  }),
  selectLayerAlpha: jest.fn(),
  initColorCycleForLayer: jest.fn(),
  setReferenceLayer: jest.fn((layerId: string | null) => {
    state.referenceLayerId = layerId;
  }),
  setBrushSettings: jest.fn(),
  mergeLayers: jest.fn(),
  setLayersVisibility: jest.fn((layerIds: string[], visible: boolean) => {
    const targetIds = new Set(layerIds);
    state.layers = state.layers.map((layer) =>
      targetIds.has(layer.id) ? { ...layer, visible } : layer
    );
  }),
  toggleLayersVisibility: jest.fn((layerIds: string[]) => {
    const targetIds = new Set(layerIds);
    state.layers = state.layers.map((layer) =>
      targetIds.has(layer.id) ? { ...layer, visible: !layer.visible } : layer
    );
  }),
  createLayerGroupFromSelection: jest.fn(() => null),
  removeLayerGroup: jest.fn(),
  setLayerGroupVisibility: jest.fn((groupId: string, visible: boolean) => {
    state.layers = state.layers.map((layer) =>
      layer.groupId === groupId ? { ...layer, visible } : layer
    );
  }),
};

jest.mock('@/stores/useAppStore', () => {
  const useAppStore = <T,>(selector: (store: StoreState) => T): T => selector(state);

  useAppStore.getState = () => state;
  useAppStore.setState = (
    updater: Partial<StoreState> | ((current: StoreState) => Partial<StoreState>)
  ) => {
    const patch = typeof updater === 'function' ? updater(state) : updater;
    Object.assign(state, patch);
    listeners.forEach((listener) => listener());
  };
  useAppStore.subscribe = (listener: () => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };

  return {
    __esModule: true,
    useAppStore,
  };
});

import LayersPanel from '@/components/panels/LayersPanel';

const createLayer = ({
  id,
  order,
  visible,
}: {
  id: string;
  order: number;
  visible: boolean;
}): Layer => {
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
    transparencyLocked: false,
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

const setupLayers = () => {
  state.layers = [
    createLayer({ id: 'layer-a', order: 0, visible: true }),
    createLayer({ id: 'layer-b', order: 1, visible: false }),
    createLayer({ id: 'layer-c', order: 2, visible: true }),
  ];
  state.layerGroups = [];
  state.activeLayerId = 'layer-c';
  state.selectedLayerIds = ['layer-c'];
  state.referenceLayerId = null;

  state.updateLayer.mockClear();
  state.setLayersVisibility.mockClear();
  state.toggleLayersVisibility.mockClear();
  state.createLayerGroupFromSelection.mockClear();
  state.removeLayerGroup.mockClear();
  state.setLayerGroupVisibility.mockClear();
  state.setSelectedLayerIds.mockClear();
  state.setActiveLayer.mockClear();
};

const getLayerRows = () => {
  const rows = document.querySelectorAll('[draggable=\"true\"]');
  return Array.from(rows);
};

const openMenuForLayerB = () => {
  const showButton = screen.getAllByTitle('Show Layer')[0];
  const row = showButton?.closest('[draggable="true"]');
  expect(row).not.toBeNull();
  fireEvent.contextMenu(row as Element);
};

const openMenuForLayerC = () => {
  const row = getLayerRows()[0];
  expect(row).not.toBeNull();
  fireEvent.contextMenu(row as Element);
};

describe('LayersPanel bulk visibility controls', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setupLayers();
  });

  it('disables bulk visibility actions when selection size is below two', () => {
    render(<LayersPanel />);

    openMenuForLayerC();

    expect(screen.getByText('Show selected').closest('button')).toBeDisabled();
    expect(screen.getByText('Hide selected').closest('button')).toBeDisabled();
    expect(screen.getByText('Toggle selected').closest('button')).toBeDisabled();
  });

  it('routes show/hide/toggle actions to selected layer ids', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    render(<LayersPanel />);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Show selected'));
    expect(state.setLayersVisibility).toHaveBeenLastCalledWith(['layer-a', 'layer-c'], true);
    expect(state.layers.find((layer) => layer.id === 'layer-a')?.visible).toBe(true);
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.visible).toBe(false);
    expect(state.layers.find((layer) => layer.id === 'layer-c')?.visible).toBe(true);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Hide selected'));
    expect(state.setLayersVisibility).toHaveBeenLastCalledWith(['layer-a', 'layer-c'], false);
    expect(state.layers.find((layer) => layer.id === 'layer-a')?.visible).toBe(false);
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.visible).toBe(false);
    expect(state.layers.find((layer) => layer.id === 'layer-c')?.visible).toBe(false);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Toggle selected'));
    expect(state.toggleLayersVisibility).toHaveBeenCalledWith(['layer-a', 'layer-c']);
    expect(state.layers.find((layer) => layer.id === 'layer-a')?.visible).toBe(true);
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.visible).toBe(false);
    expect(state.layers.find((layer) => layer.id === 'layer-c')?.visible).toBe(true);
  });

  it('keeps single-layer eye toggle behavior unchanged', () => {
    render(<LayersPanel />);

    const firstLayerRow = getLayerRows()[0];
    const groupedHideButton = firstLayerRow?.querySelector('button[title=\"Hide Layer\"]');
    expect(groupedHideButton).not.toBeNull();
    fireEvent.click(groupedHideButton as Element);

    expect(state.updateLayer).toHaveBeenCalledWith('layer-c', { visible: false });
    expect(state.setLayersVisibility).not.toHaveBeenCalled();
    expect(state.toggleLayersVisibility).not.toHaveBeenCalled();
  });

  it('renders group headers and applies visibility to all group members', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: false }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    expect(screen.getAllByText('Foreground').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTitle('Show group: Foreground')[0] as Element);

    expect(state.setLayerGroupVisibility).toHaveBeenCalledWith('group-1', true);
    expect(state.layers.find((layer) => layer.id === 'layer-a')?.visible).toBe(true);
    expect(state.layers.find((layer) => layer.id === 'layer-c')?.visible).toBe(true);
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.visible).toBe(true);
  });

  it('selects the full group and opens the layer menu when right-clicking the group header', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: false }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.selectedLayerIds = ['layer-b'];

    render(<LayersPanel />);

    const groupHeaderLabel = screen.getByText('Foreground');
    const groupHeaderRow = groupHeaderLabel.closest('div');
    expect(groupHeaderRow).not.toBeNull();
    fireEvent.contextMenu(groupHeaderRow as Element);

    expect(state.setSelectedLayerIds).toHaveBeenLastCalledWith(['layer-a', 'layer-c']);
    expect(state.setActiveLayer).toHaveBeenLastCalledWith('layer-a', { preserveSelection: true });
    expect(screen.getByText('Show selected').closest('button')).not.toBeDisabled();
    expect(screen.getByText('Hide selected').closest('button')).not.toBeDisabled();
    expect(screen.getByText('Toggle selected').closest('button')).not.toBeDisabled();
  });

  it('collapses and expands grouped layers from the group header', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: false }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    expect(getLayerRows()).toHaveLength(3);
    fireEvent.click(screen.getByTitle('Collapse group: Foreground'));
    expect(getLayerRows()).toHaveLength(1);
    fireEvent.click(screen.getByTitle('Expand group: Foreground'));
    expect(getLayerRows()).toHaveLength(3);
  });

  it('persists collapsed group state across remounts', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: false }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];

    const view = render(<LayersPanel />);
    fireEvent.click(screen.getByTitle('Collapse group: Foreground'));

    expect(window.localStorage.getItem('vessel-layer-groups-collapsed')).toBe('["group-1"]');
    expect(getLayerRows()).toHaveLength(1);

    view.unmount();
    render(<LayersPanel />);
    expect(getLayerRows()).toHaveLength(1);
    expect(screen.getByTitle('Expand group: Foreground')).toBeInTheDocument();
  });

  it('prunes stale collapsed group ids from persisted storage', () => {
    window.localStorage.setItem(
      'vessel-layer-groups-collapsed',
      JSON.stringify(['group-stale', 'group-1']),
    );

    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];

    render(<LayersPanel />);

    expect(window.localStorage.getItem('vessel-layer-groups-collapsed')).toBe('["group-1"]');
    expect(getLayerRows()).toHaveLength(1);
    expect(screen.getByTitle('Expand group: Foreground')).toBeInTheDocument();
  });

  it('keeps selection on right-click for selected rows and collapses to row for unselected rows', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    render(<LayersPanel />);

    openMenuForLayerC();
    expect(state.setSelectedLayerIds).not.toHaveBeenCalled();
    expect(state.setActiveLayer).not.toHaveBeenCalled();

    openMenuForLayerB();
    expect(state.setSelectedLayerIds).toHaveBeenLastCalledWith(['layer-b']);
    expect(state.setActiveLayer).toHaveBeenLastCalledWith('layer-b');
    expect(screen.getByText('Show selected').closest('button')).toBeDisabled();
    expect(screen.getByText('Hide selected').closest('button')).toBeDisabled();
    expect(screen.getByText('Toggle selected').closest('button')).toBeDisabled();
  });

  it('creates groups from selection and can ungroup via layer menu', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    state.layers = [
      createLayer({ id: 'layer-a', order: 0, visible: true }),
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];

    render(<LayersPanel />);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Group selection'));
    expect(state.createLayerGroupFromSelection).toHaveBeenCalledWith(['layer-a', 'layer-c']);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Ungroup'));
    expect(state.removeLayerGroup).toHaveBeenCalledWith('group-1');
  });
});
