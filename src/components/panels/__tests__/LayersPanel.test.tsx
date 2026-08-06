import React from 'react';
import { createEvent, fireEvent, render, screen } from '@testing-library/react';

import { BrushShape, type BrushPreset, type Layer } from '@/types';

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
  warmingColorCycleLayerIds: string[];
  referenceLayerId: string | null;
  sequentialRecord: {
    frameCount: number;
    fps: number;
  };
  tools: {
    brushSettings: {
      brushShape?: BrushShape;
      selectedCustomBrush?: string | null;
      customBrushColorCycle?: boolean;
      colorCycleGradient?: Array<{ position: number; color: string }>;
      colorCycleFlowMode?: 'forward' | 'reverse' | 'pingpong';
    };
  };
  brushPresets: BrushPreset[];
  currentBrushPreset: BrushPreset | null;
  project: {
    width: number;
    height: number;
  } | null;
  addLayer: jest.Mock;
  duplicateLayer: jest.Mock;
  duplicateLayers: jest.Mock;
  removeLayer: jest.Mock;
  removeLayers: jest.Mock;
  updateLayer: jest.Mock;
  setActiveLayer: jest.Mock;
  reorderLayers: jest.Mock;
  reorderLayerBlock: jest.Mock;
  setSelectedLayerIds: jest.Mock;
  selectLayerAlpha: jest.Mock;
  initColorCycleForLayer: jest.Mock;
  setReferenceLayer: jest.Mock;
  setBrushSettings: jest.Mock;
  setBrushPreset: jest.Mock;
  addNotification: jest.Mock;
  mergeLayers: jest.Mock;
  convertColorCycleLayerToNormal: jest.Mock;
  setLayersVisibility: jest.Mock;
  toggleLayersVisibility: jest.Mock;
  createLayerGroupFromSelection: jest.Mock;
  moveLayersToGroup: jest.Mock;
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
  warmingColorCycleLayerIds: [],
  referenceLayerId: null,
  sequentialRecord: {
    frameCount: 24,
    fps: 24,
  },
  tools: {
    brushSettings: {
      brushShape: BrushShape.SQUARE,
      selectedCustomBrush: null,
      customBrushColorCycle: false,
      colorCycleGradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      colorCycleFlowMode: 'forward',
    },
  },
  brushPresets: [
    { id: 'color-cycle-gradient', name: 'CC Gradient' } as BrushPreset,
    { id: 'color-cycle-stroke', name: 'CC Stroke' } as BrushPreset,
  ],
  currentBrushPreset: null,
  project: {
    width: 64,
    height: 64,
  },
  addLayer: jest.fn(() => null),
  duplicateLayer: jest.fn(() => null),
  duplicateLayers: jest.fn(() => []),
  removeLayer: jest.fn(),
  removeLayers: jest.fn(),
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
  setBrushPreset: jest.fn(),
  addNotification: jest.fn(),
  mergeLayers: jest.fn(),
  convertColorCycleLayerToNormal: jest.fn(),
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
  moveLayersToGroup: jest.fn((
    layerIds: string[],
    groupId: string | undefined,
    destinationIndex: number,
  ) => {
    const blockIdSet = new Set(layerIds);
    const blockLayers = state.layers
      .filter((layer) => blockIdSet.has(layer.id))
      .map((layer) => ({ ...layer, groupId }));
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
  name = id,
  order,
  visible,
  layerType = 'normal',
  colorCycleData,
}: {
  id: string;
  name?: string;
  order: number;
  visible: boolean;
  layerType?: Layer['layerType'];
  colorCycleData?: Layer['colorCycleData'];
}): Layer => {
  const canvas = document.createElement('canvas');
  canvas.width = 4;
  canvas.height = 4;

  return {
    id,
    name,
    order,
    visible,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    transparencyLocked: false,
    layerType,
    colorCycleData,
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
  state.warmingColorCycleLayerIds = [];
  state.referenceLayerId = null;
  state.brushPresets = [
    { id: 'color-cycle-gradient', name: 'CC Gradient' } as BrushPreset,
    { id: 'color-cycle-stroke', name: 'CC Stroke' } as BrushPreset,
  ];
  state.currentBrushPreset = null;
  state.tools.brushSettings = {
    brushShape: BrushShape.SQUARE,
    selectedCustomBrush: null,
    customBrushColorCycle: false,
    colorCycleGradient: [
      { position: 0, color: '#000000' },
      { position: 1, color: '#ffffff' },
    ],
    colorCycleFlowMode: 'forward',
  };

  state.updateLayer.mockClear();
  state.addLayer.mockClear();
  state.initColorCycleForLayer.mockClear();
  state.setBrushSettings.mockClear();
  state.setBrushPreset.mockClear();
  state.addNotification.mockClear();
  state.mergeLayers.mockClear();
  state.duplicateLayers.mockClear();
  state.removeLayers.mockClear();
  state.setLayersVisibility.mockClear();
  state.toggleLayersVisibility.mockClear();
  state.createLayerGroupFromSelection.mockClear();
  state.moveLayersToGroup.mockClear();
  state.removeLayerGroup.mockClear();
  state.setLayerGroupVisibility.mockClear();
  state.convertColorCycleLayerToNormal.mockClear();
  state.setSelectedLayerIds.mockClear();
  state.setActiveLayer.mockClear();
  state.reorderLayerBlock.mockClear();
  groupVisibilityMemory.clear();
};

const getLayerRows = () => {
  const rows = document.querySelectorAll('div.group.relative[draggable="true"]');
  return Array.from(rows);
};

const mockRowBounds = (row: Element, top: number = 0, height: number = 40) => {
  jest.spyOn(row, 'getBoundingClientRect').mockReturnValue({
    bottom: top + height,
    height,
    left: 0,
    right: 260,
    top,
    width: 260,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect);
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

  it('shows an in-button loading animation while color-cycle payloads warm', () => {
    state.layers = state.layers.map((layer) => (
      layer.id === 'layer-c'
        ? {
            ...layer,
            layerType: 'color-cycle',
            colorCycleData: {
              isAnimating: false,
              deferredRuntimeRestore: true,
              runtimeHydrationState: 'cold',
            },
          }
        : layer
    ));
    state.warmingColorCycleLayerIds = ['layer-c'];

    render(<LayersPanel />);

    const warmingBadge = screen.getByLabelText('layer-c color-cycle payloads warming');
    expect(warmingBadge).toHaveAttribute('title', 'Warming color-cycle payloads');
    expect(warmingBadge.querySelector('svg')).toHaveClass('animate-spin');
  });

  it('does not render bulk selected visibility actions in layer menu', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    render(<LayersPanel />);

    openMenuForLayerC();
    expect(screen.queryByText('Show selected')).toBeNull();
    expect(screen.queryByText('Hide selected')).toBeNull();
    expect(screen.queryByText('Toggle selected')).toBeNull();
  });

  it('keeps deletion in the layer menu instead of a row hover control', () => {
    render(<LayersPanel />);

    expect(screen.queryByTitle('Delete Layer')).not.toBeInTheDocument();

    openMenuForLayerC();
    expect(screen.getByTitle('Delete this layer')).toBeInTheDocument();
  });

  it('shows compact one-line layer names with a narrow type tag and the full id in the tooltip', () => {
    state.layers = [
      createLayer({
        id: 'layer-1777941667172-0.6293618476877367',
        name: 'CC Layer 2',
        order: 0,
        visible: true,
        layerType: 'color-cycle',
        colorCycleData: {
          gradient: [
            { position: 0, color: '#000000' },
            { position: 1, color: '#ffffff' },
          ],
        },
      }),
    ];
    state.activeLayerId = state.layers[0].id;
    state.selectedLayerIds = [state.layers[0].id];

    render(<LayersPanel />);

    expect(screen.getByText('CC Layer 2')).toHaveAttribute(
      'title',
      'CC Layer 2\nLayer ID: layer-1777941667172-0.6293618476877367',
    );
    expect(screen.getByTitle('Color-cycle brush layer')).toHaveClass('w-8');
    expect(screen.queryByText('#667172')).not.toBeInTheDocument();
    expect(screen.queryByText('Type')).not.toBeInTheDocument();
  });

  it('renames one layer inline on double-click and commits with Enter', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    render(<LayersPanel />);

    fireEvent.doubleClick(screen.getByText('layer-c'));

    const input = screen.getByRole('textbox', { name: 'Rename layer layer-c' });
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '  Sky highlights  ' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(state.updateLayer).toHaveBeenCalledTimes(1);
    expect(state.updateLayer).toHaveBeenCalledWith('layer-c', { name: 'Sky highlights' });
    expect(screen.queryByRole('textbox', { name: 'Rename layer layer-c' })).not.toBeInTheDocument();
    expect(screen.getByText('Sky highlights')).toBeInTheDocument();
  });

  it('commits a layer rename on blur and rejects an empty name', () => {
    render(<LayersPanel />);

    fireEvent.doubleClick(screen.getByText('layer-c'));
    const input = screen.getByRole('textbox', { name: 'Rename layer layer-c' });
    fireEvent.change(input, { target: { value: 'Foreground ink' } });
    fireEvent.blur(input);

    expect(state.updateLayer).toHaveBeenCalledWith('layer-c', { name: 'Foreground ink' });

    fireEvent.doubleClick(screen.getByText('Foreground ink'));
    const emptyInput = screen.getByRole('textbox', { name: 'Rename layer Foreground ink' });
    fireEvent.change(emptyInput, { target: { value: '   ' } });
    fireEvent.blur(emptyInput);

    expect(state.updateLayer).toHaveBeenCalledTimes(1);
    expect(screen.getByText('Foreground ink')).toBeInTheDocument();
  });

  it('cancels a layer rename with Escape', () => {
    render(<LayersPanel />);

    fireEvent.doubleClick(screen.getByText('layer-c'));
    const input = screen.getByRole('textbox', { name: 'Rename layer layer-c' });
    fireEvent.change(input, { target: { value: 'Discard this' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    expect(state.updateLayer).not.toHaveBeenCalled();
    expect(screen.getByText('layer-c')).toBeInTheDocument();
  });

  it('commits a layer rename before allowing the save shortcut to continue', () => {
    const saveShortcutListener = jest.fn();
    window.addEventListener('keydown', saveShortcutListener);

    try {
      render(<LayersPanel />);

      fireEvent.doubleClick(screen.getByText('layer-c'));
      const input = screen.getByRole('textbox', { name: 'Rename layer layer-c' });
      fireEvent.change(input, { target: { value: 'Saved from shortcut' } });
      fireEvent.keyDown(input, { key: 's', metaKey: true });

      expect(state.updateLayer).toHaveBeenCalledWith('layer-c', { name: 'Saved from shortcut' });
      expect(saveShortcutListener).toHaveBeenCalledTimes(1);
    } finally {
      window.removeEventListener('keydown', saveShortcutListener);
    }
  });

  it('keeps single-layer eye toggle behavior unchanged', () => {
    render(<LayersPanel />);

    const firstLayerRow = getLayerRows()[0];
    const groupedHideButton = firstLayerRow?.querySelector('button[title=\"Hide Layer\"]');
    expect(groupedHideButton).not.toBeNull();
    expect(groupedHideButton).toHaveClass('h-6', 'w-6', '-mx-1', '-mb-1', '-mt-0.5');
    fireEvent.click(groupedHideButton as Element);

    expect(state.setLayersVisibility).toHaveBeenCalledWith(['layer-c'], false);
    expect(state.toggleLayersVisibility).not.toHaveBeenCalled();
  });

  it('applies row visibility toggles to the full selection when the clicked row is selected', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    render(<LayersPanel />);

    const firstLayerRow = getLayerRows()[0];
    const groupedHideButton = firstLayerRow?.querySelector('button[title=\"Hide Layer\"]');
    expect(groupedHideButton).not.toBeNull();
    fireEvent.click(groupedHideButton as Element);

    expect(state.setLayersVisibility).toHaveBeenCalledWith(['layer-a', 'layer-c'], false);
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
    const rows = getLayerRows();
    expect(rows[0]?.firstElementChild?.className).toContain('pl-4');
    expect(rows[1]?.firstElementChild?.className).not.toContain('pl-4');
    expect(rows[2]?.firstElementChild?.className).toContain('pl-4');

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
      { ...createLayer({ id: 'layer-c', order: 1, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-b', order: 2, visible: true }),
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    const rows = getLayerRows();
    const sourceRow = rows[0];
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
    mockRowBounds(groupHeader as Element);
    fireEvent.dragOver(groupHeader as Element, { clientY: 20, dataTransfer });
    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');
    fireEvent.drop(groupHeader as Element, { dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-b'], 'group-1', 2);
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.groupId).toBe('group-1');
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-c',
      'layer-a',
    ]);
  });

  it('drags one group member to the top when the full group is selected', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.selectedLayerIds = ['layer-a', 'layer-b', 'layer-c'];
    render(<LayersPanel />);

    const sourceRow = getLayerRows()[2];
    const groupHeader = screen.getByText('Foreground').closest('div');
    expect(sourceRow).not.toBeUndefined();
    expect(groupHeader).not.toBeNull();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-a'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    expect(state.setSelectedLayerIds).toHaveBeenCalledWith(['layer-a']);
    mockRowBounds(groupHeader as Element);
    fireEvent.dragOver(groupHeader as Element, { clientY: 20, dataTransfer });
    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');
    fireEvent.drop(groupHeader as Element, { dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-a'], 'group-1', 3);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-a',
      'layer-c',
      'layer-b',
    ]);
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

  it('moves a group above an ungrouped top row with an insertion preview', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-c', order: 2, visible: true }),
      createLayer({ id: 'layer-d', order: 3, visible: true }),
    ];
    state.layerGroups = [{ id: 'group-1', name: 'One' }];
    render(<LayersPanel />);

    const sourceHeader = screen.getByText('One').closest('div');
    const targetRow = getLayerRows()[0];
    expect(sourceHeader).not.toBeNull();
    expect(targetRow).not.toBeUndefined();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'group:group-1'),
    };

    fireEvent.dragStart(sourceHeader as Element, { dataTransfer });
    const currentTargetRow = getLayerRows()[0];
    expect(currentTargetRow).not.toBeUndefined();
    mockRowBounds(currentTargetRow as Element);
    fireEvent.dragOver(currentTargetRow as Element, { clientY: 5, dataTransfer });

    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');

    fireEvent.drop(currentTargetRow as Element, { clientY: 5, dataTransfer });

    expect(state.reorderLayerBlock).toHaveBeenCalledWith(['layer-a', 'layer-b'], 4);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-a',
      'layer-d',
      'layer-c',
    ]);
    expect(state.layers.filter((layer) => layer.groupId === 'group-1').map((layer) => layer.id)).toEqual([
      'layer-a',
      'layer-b',
    ]);
  });

  it('moves a group below another group from the lower half of its header', () => {
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

    const sourceHeader = screen.getByText('Two').closest('div');
    const targetHeader = screen.getByText('One').closest('div');
    expect(sourceHeader).not.toBeNull();
    expect(targetHeader).not.toBeNull();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'group:group-2'),
    };

    fireEvent.dragStart(sourceHeader as Element, { dataTransfer });
    const currentTargetHeader = screen.getByText('One').closest('div');
    expect(currentTargetHeader).not.toBeNull();
    mockRowBounds(currentTargetHeader as Element);
    const dragOverEvent = createEvent.dragOver(currentTargetHeader as Element, { dataTransfer });
    Object.defineProperty(dragOverEvent, 'clientY', { value: 30 });
    fireEvent(currentTargetHeader as Element, dragOverEvent);

    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');

    const dropEvent = createEvent.drop(currentTargetHeader as Element, { dataTransfer });
    Object.defineProperty(dropEvent, 'clientY', { value: 30 });
    fireEvent(currentTargetHeader as Element, dropEvent);

    expect(state.reorderLayerBlock).toHaveBeenCalledWith(['layer-c', 'layer-d'], 0);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-a',
      'layer-d',
      'layer-c',
    ]);
    expect(state.layers.filter((layer) => layer.groupId === 'group-2').map((layer) => layer.id)).toEqual([
      'layer-c',
      'layer-d',
    ]);
  });

  it('moves a top group to the bottom drop slot', () => {
    state.layers = [
      createLayer({ id: 'layer-a', order: 0, visible: true }),
      createLayer({ id: 'layer-b', order: 1, visible: true }),
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-d', order: 3, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'One' }];
    render(<LayersPanel />);

    const sourceHeader = screen.getByText('One').closest('div');
    expect(sourceHeader).not.toBeNull();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'group:group-1'),
    };

    fireEvent.dragStart(sourceHeader as Element, { dataTransfer });
    const bottomDropTarget = screen.getByTestId('layer-drop-bottom');
    fireEvent.dragOver(bottomDropTarget, { dataTransfer });

    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');

    fireEvent.drop(bottomDropTarget, { dataTransfer });

    expect(state.reorderLayerBlock).toHaveBeenCalledWith(['layer-c', 'layer-d'], 0);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-a',
      'layer-d',
      'layer-c',
    ]);
    expect(state.layers.filter((layer) => layer.groupId === 'group-1').map((layer) => layer.id)).toEqual([
      'layer-c',
      'layer-d',
    ]);
  });

  it('snaps a group drop below the full target group instead of splitting it', () => {
    state.layers = [
      createLayer({ id: 'layer-e', order: 0, visible: true }),
      { ...createLayer({ id: 'layer-a', order: 1, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 2, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-c', order: 3, visible: true }), groupId: 'group-2' },
      { ...createLayer({ id: 'layer-d', order: 4, visible: true }), groupId: 'group-2' },
    ];
    state.layerGroups = [
      { id: 'group-1', name: 'One' },
      { id: 'group-2', name: 'Two' },
    ];
    render(<LayersPanel />);

    const sourceHeader = screen.getByText('Two').closest('div');
    expect(sourceHeader).not.toBeNull();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'group:group-2'),
    };

    fireEvent.dragStart(sourceHeader as Element, { dataTransfer });
    const targetTopRow = getLayerRows()[2];
    expect(targetTopRow).not.toBeUndefined();
    mockRowBounds(targetTopRow as Element);
    const dragOverEvent = createEvent.dragOver(targetTopRow as Element, { dataTransfer });
    Object.defineProperty(dragOverEvent, 'clientY', { value: 30 });
    fireEvent(targetTopRow as Element, dragOverEvent);

    const targetBottomRow = screen.getByText('layer-a').closest('div[draggable="true"]');
    expect(targetBottomRow?.querySelector('[data-testid="layer-drop-indicator"]')).not.toBeNull();

    const dropEvent = createEvent.drop(targetTopRow as Element, { dataTransfer });
    Object.defineProperty(dropEvent, 'clientY', { value: 30 });
    fireEvent(targetTopRow as Element, dropEvent);

    expect(state.reorderLayerBlock).toHaveBeenCalledWith(['layer-c', 'layer-d'], 1);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-a',
      'layer-d',
      'layer-c',
      'layer-e',
    ]);
  });

  it('does not preview or reorder a group at its current boundary', () => {
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

    const sourceHeader = screen.getByText('One').closest('div');
    expect(sourceHeader).not.toBeNull();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'group:group-1'),
    };

    fireEvent.dragStart(sourceHeader as Element, { dataTransfer });
    const targetHeader = screen.getByText('Two').closest('div');
    expect(targetHeader).not.toBeNull();
    mockRowBounds(targetHeader as Element);
    const dragOverEvent = createEvent.dragOver(targetHeader as Element, { dataTransfer });
    Object.defineProperty(dragOverEvent, 'clientY', { value: 30 });
    fireEvent(targetHeader as Element, dragOverEvent);

    expect(screen.queryByTestId('layer-drop-indicator')).not.toBeInTheDocument();

    const dropEvent = createEvent.drop(targetHeader as Element, { dataTransfer });
    Object.defineProperty(dropEvent, 'clientY', { value: 30 });
    fireEvent(targetHeader as Element, dropEvent);

    expect(state.reorderLayerBlock).not.toHaveBeenCalled();
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
    const currentTargetRow = getLayerRows()[0];
    expect(currentTargetRow).not.toBeUndefined();
    mockRowBounds(currentTargetRow as Element);
    const dragOverEvent = createEvent.dragOver(currentTargetRow as Element, { dataTransfer });
    Object.defineProperty(dragOverEvent, 'clientY', { value: 30 });
    fireEvent(currentTargetRow as Element, dragOverEvent);
    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-bottom-px');
    const dropEvent = createEvent.drop(currentTargetRow as Element, { dataTransfer });
    Object.defineProperty(dropEvent, 'clientY', { value: 30 });
    fireEvent(currentTargetRow as Element, dropEvent);

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-b'], 'group-1', 2);
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.groupId).toBe('group-1');
  });

  it('treats dropping a grouped layer onto its own row as a no-op', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    const sourceRow = getLayerRows()[1];
    expect(sourceRow).not.toBeUndefined();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-b'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    const currentSourceRow = getLayerRows()[1];
    expect(currentSourceRow).not.toBeUndefined();
    mockRowBounds(currentSourceRow as Element);
    fireEvent.dragOver(currentSourceRow as Element, { clientY: 5, dataTransfer });

    expect(screen.queryByTestId('layer-drop-indicator')).not.toBeInTheDocument();

    fireEvent.drop(currentSourceRow as Element, { clientY: 5, dataTransfer });

    expect(state.moveLayersToGroup).not.toHaveBeenCalled();
    expect(state.layers.find((layer) => layer.id === 'layer-b')?.groupId).toBe('group-1');
  });

  it('moves an interior group member to the top without dragging it out', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.selectedLayerIds = ['layer-a'];
    render(<LayersPanel />);

    const targetRow = getLayerRows()[0];
    const sourceRow = getLayerRows()[2];
    expect(targetRow).not.toBeUndefined();
    expect(sourceRow).not.toBeUndefined();
    mockRowBounds(targetRow as Element);

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-a'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    fireEvent.dragOver(targetRow as Element, { clientY: 5, dataTransfer });
    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');
    fireEvent.drop(targetRow as Element, { clientY: 5, dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-a'], 'group-1', 3);
    expect(state.layers.find((layer) => layer.id === 'layer-a')?.groupId).toBe('group-1');
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-a',
      'layer-c',
      'layer-b',
    ]);
  });

  it('moves an interior group member to the bottom without dragging it out', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    state.selectedLayerIds = ['layer-c'];
    render(<LayersPanel />);

    const sourceRow = getLayerRows()[0];
    const targetRow = getLayerRows()[2];
    expect(sourceRow).not.toBeUndefined();
    expect(targetRow).not.toBeUndefined();
    mockRowBounds(targetRow as Element);

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-c'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    fireEvent.dragOver(targetRow as Element, { clientY: 30, dataTransfer });
    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');
    const dropEvent = createEvent.drop(targetRow as Element, { dataTransfer });
    Object.defineProperty(dropEvent, 'clientY', { value: 30 });
    fireEvent(targetRow as Element, dropEvent);

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-c'], 'group-1', 0);
    expect(state.layers.find((layer) => layer.id === 'layer-c')?.groupId).toBe('group-1');
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-a',
      'layer-c',
    ]);
  });

  it('drags the top member out above its own group boundary', () => {
    state.layers = [
      createLayer({ id: 'layer-a', order: 0, visible: true }),
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-c', order: 2, visible: true }), groupId: 'group-1' },
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    const sourceRow = getLayerRows()[0];
    expect(sourceRow).not.toBeUndefined();
    mockRowBounds(sourceRow as Element);
    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-c'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    fireEvent.dragOver(sourceRow as Element, { clientY: 5, dataTransfer });
    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');
    fireEvent.drop(sourceRow as Element, { clientY: 5, dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-c'], undefined, 3);
    expect(state.layers.find((layer) => layer.id === 'layer-c')?.groupId).toBeUndefined();
  });

  it('drags the bottom member out below its own group boundary', () => {
    state.layers = [
      { ...createLayer({ id: 'layer-a', order: 0, visible: true }), groupId: 'group-1' },
      { ...createLayer({ id: 'layer-b', order: 1, visible: true }), groupId: 'group-1' },
      createLayer({ id: 'layer-c', order: 2, visible: true }),
    ];
    state.layerGroups = [{ id: 'group-1', name: 'Foreground' }];
    render(<LayersPanel />);

    const sourceRow = getLayerRows()[2];
    expect(sourceRow).not.toBeUndefined();
    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-a'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    const bottomDropTarget = screen.getByTestId('layer-drop-bottom');
    fireEvent.dragOver(bottomDropTarget, { dataTransfer });
    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');
    fireEvent.drop(bottomDropTarget, { dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-a'], undefined, 0);
    expect(state.layers.find((layer) => layer.id === 'layer-a')?.groupId).toBeUndefined();
  });

  it('duplicates the full selection from the layer menu when the clicked row is selected', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    state.duplicateLayers.mockReturnValue(['layer-a-copy', 'layer-c-copy']);
    render(<LayersPanel />);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Duplicate layer'));

    expect(state.duplicateLayers).toHaveBeenCalledWith(['layer-a', 'layer-c']);
  });

  it('deletes the full selection from the layer menu when the clicked row is selected', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    render(<LayersPanel />);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Delete layer'));

    expect(state.removeLayers).toHaveBeenCalledWith(['layer-a', 'layer-c']);
  });

  it('converts a color-cycle layer to regular from its layer menu', () => {
    state.layers = state.layers.map((layer) => (
      layer.id === 'layer-c'
        ? { ...layer, layerType: 'color-cycle', colorCycleData: { isAnimating: false } }
        : layer
    ));
    state.convertColorCycleLayerToNormal.mockReturnValueOnce(true);
    render(<LayersPanel />);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Convert to regular'));

    expect(state.convertColorCycleLayerToNormal).toHaveBeenCalledWith('layer-c');
    expect(state.addNotification).not.toHaveBeenCalled();
  });

  it('reports when selected layers cannot be merged safely', () => {
    state.selectedLayerIds = ['layer-a', 'layer-c'];
    state.activeLayerId = 'layer-c';
    state.mergeLayers.mockReturnValueOnce(null);
    render(<LayersPanel />);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Merge layers'));

    expect(state.mergeLayers).toHaveBeenCalledWith(['layer-a', 'layer-c']);
    expect(state.addNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'warning',
      title: 'Layers were not merged',
    }));
  });

  it('reports a color-cycle conversion that could not complete safely', () => {
    state.layers = state.layers.map((layer) => (
      layer.id === 'layer-c'
        ? { ...layer, layerType: 'color-cycle', colorCycleData: { isAnimating: false } }
        : layer
    ));
    state.convertColorCycleLayerToNormal.mockReturnValueOnce(false);
    render(<LayersPanel />);

    openMenuForLayerC();
    fireEvent.click(screen.getByText('Convert to regular'));

    expect(state.addNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      title: 'Layer was not converted',
    }));
  });

  it('moves a lower layer above the current top layer and previews the insertion boundary', () => {
    state.selectedLayerIds = ['layer-a'];
    state.activeLayerId = 'layer-a';
    render(<LayersPanel />);

    const rows = getLayerRows();
    const targetRow = rows[0];
    const sourceRow = rows[2];
    expect(sourceRow).not.toBeUndefined();
    expect(targetRow).not.toBeUndefined();
    mockRowBounds(targetRow as Element);

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-a'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    fireEvent.dragOver(targetRow as Element, { clientY: 5, dataTransfer });

    expect(screen.getByTestId('layer-drop-indicator')).toBeInTheDocument();

    fireEvent.drop(targetRow as Element, { clientY: 5, dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-a'], undefined, 3);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-a',
      'layer-c',
      'layer-b',
    ]);
    expect(screen.queryByTestId('layer-drop-indicator')).not.toBeInTheDocument();
  });

  it('moves the top layer to the bottom boundary', () => {
    render(<LayersPanel />);

    const sourceRow = getLayerRows()[0];
    expect(sourceRow).not.toBeUndefined();

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-c'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    const bottomDropTarget = screen.getByTestId('layer-drop-bottom');
    fireEvent.dragOver(bottomDropTarget, { dataTransfer });

    expect(screen.getByTestId('layer-drop-indicator')).toHaveClass('-top-px');

    fireEvent.drop(bottomDropTarget, { dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-c'], undefined, 0);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-a',
      'layer-c',
    ]);
  });

  it('reorders the full selected block when dropping above another row', () => {
    state.selectedLayerIds = ['layer-a', 'layer-b'];
    state.activeLayerId = 'layer-b';
    render(<LayersPanel />);

    const rows = getLayerRows();
    const sourceRow = rows[1];
    const targetRow = rows[0];
    expect(sourceRow).not.toBeUndefined();
    expect(targetRow).not.toBeUndefined();
    mockRowBounds(targetRow as Element);

    const dataTransfer = {
      effectAllowed: 'move',
      dropEffect: 'move',
      setData: jest.fn(),
      getData: jest.fn(() => 'layer-b'),
    };

    fireEvent.dragStart(sourceRow as Element, { dataTransfer });
    fireEvent.drop(targetRow as Element, { clientY: 5, dataTransfer });

    expect(state.moveLayersToGroup).toHaveBeenCalledWith(['layer-a', 'layer-b'], undefined, 3);
    expect(state.layers.slice().reverse().map((layer) => layer.id)).toEqual([
      'layer-b',
      'layer-a',
      'layer-c',
    ]);
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

  it('places the sequence layer button after the more commonly used layer types', () => {
    render(<LayersPanel />);

    const addButtons = [
      screen.getByTitle('Add Regular Layer'),
      screen.getByTitle('Add CC Layer'),
      screen.getByTitle('Add Sequence Layer'),
    ];

    expect(Array.from(addButtons[0].parentElement?.children ?? [])).toEqual(addButtons);
  });

  it('preserves an active temporary color-cycle custom brush when adding a color-cycle layer', () => {
    state.addLayer.mockReturnValueOnce('cc-layer-new');
    state.tools.brushSettings = {
      ...state.tools.brushSettings,
      brushShape: BrushShape.CUSTOM,
      selectedCustomBrush: 'temp_brush_1',
      customBrushColorCycle: true,
    };

    render(<LayersPanel />);

    fireEvent.click(screen.getByTitle('Add CC Layer'));

    expect(state.addLayer).toHaveBeenCalledTimes(1);
    expect(state.initColorCycleForLayer).toHaveBeenCalledWith('cc-layer-new', 64, 64);
    expect(state.setBrushPreset).not.toHaveBeenCalled();
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

    fireEvent.click(screen.getByTitle('Add Sequence Layer'));

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
