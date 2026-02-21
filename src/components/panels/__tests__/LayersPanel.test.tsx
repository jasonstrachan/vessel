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
  hiddenLayerGroupIds: string[];
  activeLayerId: string | null;
  selectedLayerIds: string[];
  referenceLayerId: string | null;
  sequentialRecord: {
    frameCount: number;
    fps: number;
  };
  tools: {
    brushSettings: {
      colorCycleGradient?: Array<{ position: number; color: string }>;
      colorCycleFlowMode?: 'forward' | 'reverse' | 'pingpong';
    };
  };
  project: {
    width: number;
    height: number;
  } | null;
  addLayer: jest.Mock;
  duplicateLayer: jest.Mock;
  removeLayer: jest.Mock;
  updateLayer: jest.Mock;
  setActiveLayer: jest.Mock;
  reorderLayers: jest.Mock;
  reorderLayerBlock: jest.Mock;
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
const groupVisibilityMemory = new Map<string, Map<string, boolean>>();

const state: StoreState = {
  layers: [],
  layerGroups: [],
  hiddenLayerGroupIds: [],
  activeLayerId: null,
  selectedLayerIds: [],
  referenceLayerId: null,
  sequentialRecord: {
    frameCount: 24,
    fps: 24,
  },
  tools: {
    brushSettings: {
      colorCycleGradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      colorCycleFlowMode: 'forward',
    },
  },
  project: {
    width: 64,
    height: 64,
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
  reorderLayerBlock: jest.fn((layerIds: string[], destinationIndex: number) => {
    const blockIdSet = new Set(layerIds);
    const blockLayers = state.layers.filter((layer) => blockIdSet.has(layer.id));
    const remaining = state.layers.filter((layer) => !blockIdSet.has(layer.id));
    const removedBefore = state.layers.reduce((count, layer, index) => (
      blockIdSet.has(layer.id) && index < destinationIndex ? count + 1 : count
    ), 0);
    const adjustedDestination = Math.max(
      0,
      Math.min(remaining.length, destinationIndex - removedBefore),
    );
    const next = [...remaining];
    next.splice(adjustedDestination, 0, ...blockLayers);
    state.layers = next.map((layer, index) => ({ ...layer, order: index }));
  }),
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
    if (visible) {
      const snapshot = groupVisibilityMemory.get(groupId) ?? new Map<string, boolean>();
      state.hiddenLayerGroupIds = state.hiddenLayerGroupIds.filter((id) => id !== groupId);
      state.layers = state.layers.map((layer) => {
        if (layer.groupId !== groupId) {
          return layer;
        }
        const restored = snapshot.has(layer.id) ? Boolean(snapshot.get(layer.id)) : layer.visible;
        return { ...layer, visible: restored };
      });
      return;
    }

    const snapshot = new Map<string, boolean>();
    state.layers.forEach((layer) => {
      if (layer.groupId === groupId) {
        snapshot.set(layer.id, layer.visible);
      }
    });
    groupVisibilityMemory.set(groupId, snapshot);
    if (!state.hiddenLayerGroupIds.includes(groupId)) {
      state.hiddenLayerGroupIds = [...state.hiddenLayerGroupIds, groupId];
    }
    state.layers = state.layers.map((layer) =>
      layer.groupId === groupId ? { ...layer, visible: false } : layer
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
  state.hiddenLayerGroupIds = [];
  state.activeLayerId = 'layer-c';
  state.selectedLayerIds = ['layer-c'];
  state.referenceLayerId = null;

  state.updateLayer.mockClear();
  state.addLayer.mockClear();
  state.initColorCycleForLayer.mockClear();
  state.setBrushSettings.mockClear();
  state.setLayersVisibility.mockClear();
  state.toggleLayersVisibility.mockClear();
  state.createLayerGroupFromSelection.mockClear();
  state.removeLayerGroup.mockClear();
  state.setLayerGroupVisibility.mockClear();
  state.setSelectedLayerIds.mockClear();
  state.setActiveLayer.mockClear();
  state.reorderLayerBlock.mockClear();
  groupVisibilityMemory.clear();
};

const getLayerRows = () => {
  const rows = document.querySelectorAll('div.group.relative[draggable="true"]');
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

describe('LayersPanel interactions', () => {
  beforeEach(() => {
    window.localStorage.clear();
    setupLayers();
  });

  it('does not render bulk selected visibility actions in layer menu', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    render(<LayersPanel />);

    openMenuForLayerC();
    expect(screen.queryByText('Show selected')).toBeNull();
    expect(screen.queryByText('Hide selected')).toBeNull();
    expect(screen.queryByText('Toggle selected')).toBeNull();
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
    state.hiddenLayerGroupIds = ['group-1'];
    groupVisibilityMemory.set(
      'group-1',
      new Map<string, boolean>([
        ['layer-a', true],
        ['layer-c', false],
      ]),
    );
    render(<LayersPanel />);

    expect(screen.getAllByText('Foreground').length).toBeGreaterThan(0);
    fireEvent.click(screen.getAllByTitle('Show group: Foreground')[0] as Element);

    expect(state.setLayerGroupVisibility).toHaveBeenCalledWith('group-1', true);
    expect(state.layers.find((layer) => layer.id === 'layer-a')?.visible).toBe(true);
    expect(state.layers.find((layer) => layer.id === 'layer-c')?.visible).toBe(false);
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
    expect(state.setActiveLayer).toHaveBeenLastCalledWith('layer-c', { preserveSelection: true });
    expect(screen.queryByText('Show selected')).toBeNull();
    expect(screen.queryByText('Hide selected')).toBeNull();
    expect(screen.queryByText('Toggle selected')).toBeNull();
  });

  it('uses the standard selected row styling for non-active members when a full group is selected', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: false }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.activeLayerId = 'layer-c';
    state.selectedLayerIds = ['layer-a', 'layer-c'];

    render(<LayersPanel />);

    const rows = getLayerRows();
    const rowLayerC = rows[0] as HTMLElement | undefined;
    const rowLayerA = rows[2] as HTMLElement | undefined;
    expect(rowLayerA).toBeDefined();
    expect(rowLayerC).toBeDefined();

    expect(rowLayerA?.className).toContain('bg-[#E8F2FF]');
    expect(rowLayerA?.className).not.toContain('bg-[#2C3B47]');
    expect(rowLayerC?.className).toContain('bg-[#E8F2FF]');
    expect(screen.getByTitle('Hide group: Foreground').className).toContain('text-[#1A1A1A]');
  });

  it('supports dragging a layer into a group via the group header', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    const rows = getLayerRows();
    const sourceRow = rows[1];
    expect(sourceRow).not.toBeUndefined();
    const groupHeader = screen.getByText('Foreground').closest('div');
    expect(groupHeader).not.toBeNull();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-b'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    fireEvent.drop(groupHeader as Element, { dataTransfer });

    expect(state.updateLayer).toHaveBeenCalledWith('layer-b', { groupId: 'group-1' });
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.groupId).toBe('group-1');
  });

  it('reorders dragged group above target group when dropped on another group header', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-2' },
      { ...createLayer({ id: 'layer-d', order: 3, visible: true }), groupId: 'group-2' },
    ];
    state.layerGroups = [
      { id: 'group-1', name: 'One' },
      { id: 'group-2', name: 'Two' },
    ];
    render(<LayersPanel />);

    const groupOneHeader = screen.getByText('One').closest('div');
    const groupTwoHeader = screen.getByText('Two').closest('div');
    expect(groupOneHeader).not.toBeNull();
    expect(groupTwoHeader).not.toBeNull();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'group:group-1'),
    };

    fireEvent.dragStart(groupOneHeader as Element, { dataTransfer });
    fireEvent.drop(groupTwoHeader as Element, { dataTransfer });

    expect(state.reorderLayerBlock).toHaveBeenCalledWith(['layer-a', 'layer-b'], 4);
    const visibleGroupLabels = screen.getAllByText(/One|Two/).map((element) => element.textContent);
    expect(visibleGroupLabels[0]).toBe('One');
    expect(visibleGroupLabels[1]).toBe('Two');
  });

  it('drops layer into target group when dropped on a grouped layer row', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    const rows = getLayerRows();
    const targetRow = rows[0];
    const sourceRow = rows[1];
    expect(targetRow).not.toBeUndefined();
    expect(sourceRow).not.toBeUndefined();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-b'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    fireEvent.drop(targetRow as Element, { dataTransfer });

    expect(state.updateLayer).toHaveBeenCalledWith('layer-b', { groupId: 'group-1' });
    expect(state.reorderLayers).toHaveBeenCalledWith(1, 2);
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.groupId).toBe('group-1');
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
    expect(screen.queryByText('Show selected')).toBeNull();
    expect(screen.queryByText('Hide selected')).toBeNull();
    expect(screen.queryByText('Toggle selected')).toBeNull();
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

  it('inherits group membership when adding a regular layer above a grouped active layer', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.activeLayerId = 'layer-c';
    state.selectedLayerIds = ['layer-c'];

    render(<LayersPanel />);

    fireEvent.click(screen.getByTitle('Add Regular Layer'));

    expect(state.addLayer).toHaveBeenCalledTimes(1);
    const payload = state.addLayer.mock.calls[0]?.[0];
    expect(payload?.layerType).toBe('normal');
    expect(payload?.groupId).toBe('group-1');
  });

  it('inherits group membership when adding a color-cycle layer above a grouped active layer', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.activeLayerId = 'layer-c';
    state.selectedLayerIds = ['layer-c'];

    render(<LayersPanel />);

    fireEvent.click(screen.getByTitle('Add CC Layer'));

    expect(state.addLayer).toHaveBeenCalledTimes(1);
    const payload = state.addLayer.mock.calls[0]?.[0];
    expect(payload?.layerType).toBe('color-cycle');
    expect(payload?.groupId).toBe('group-1');
  });

  it('inherits group membership when adding an animation layer above a grouped active layer', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.activeLayerId = 'layer-c';
    state.selectedLayerIds = ['layer-c'];

    render(<LayersPanel />);

    fireEvent.click(screen.getByTitle('Add Animation Layer'));

    expect(state.addLayer).toHaveBeenCalledTimes(1);
    const payload = state.addLayer.mock.calls[0]?.[0];
    expect(payload?.layerType).toBe('sequential');
    expect(payload?.groupId).toBe('group-1');
  });

  it('adds a new regular layer outside the group when the full group is selected', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.activeLayerId = 'layer-c';
    state.selectedLayerIds = ['layer-a', 'layer-c'];

    render(<LayersPanel />);

    fireEvent.click(screen.getByTitle('Add Regular Layer'));

    expect(state.addLayer).toHaveBeenCalledTimes(1);
    const payload = state.addLayer.mock.calls[0]?.[0];
    expect(payload?.layerType).toBe('normal');
    expect(payload?.groupId).toBeUndefined();
  });
});
