import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

import { InterlaceSettingsPanel } from '@/components/panels/InterlaceSettingsPanel';

const updateInterlaceGroup = jest.fn();
const mockStore = {
  layers: [
    { id: 'pose-a', name: 'Pose A', layerType: 'normal', groupId: 'interlace-1', order: 0 },
    { id: 'pose-b', name: 'Pose B', layerType: 'normal', groupId: 'interlace-1', order: 1 },
  ],
  layerGroups: [{
    id: 'interlace-1',
    name: 'Interlace 1',
    kind: 'interlace',
    interlace: {
      cellSize: 16,
      dominance: 0.86,
      patternPreset: 'classic',
      motionMode: 'fixed',
      direction: 'right',
      travelCycles: 1,
      loopDurationSeconds: 10,
      seed: 17,
    },
  }],
  activeLayerId: 'pose-a',
  selectedLayerIds: ['pose-a', 'pose-b'],
  createInterlaceGroupFromSelection: jest.fn(),
  updateInterlaceGroup,
  moveLayersToGroup: jest.fn(),
  removeLayerGroup: jest.fn(),
  reorderLayerBlock: jest.fn(),
};

const initialStoreData = JSON.stringify({
  layers: mockStore.layers, layerGroups: mockStore.layerGroups, activeLayerId: mockStore.activeLayerId, selectedLayerIds: mockStore.selectedLayerIds,
});

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe('InterlaceSettingsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    Object.assign(mockStore, JSON.parse(initialStoreData));
  });

  it('offers distinct animation sets and updates the selected Interlace group', () => {
    render(<InterlaceSettingsPanel />);

    const select = screen.getByLabelText('Interlace pattern animation');
    expect(screen.getByRole('option', { name: 'Classic pulse' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Ripple' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Counterflow' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Hypnotic' })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: 'Sierra travel' })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Wave Field' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Interference' })).not.toBeInTheDocument();
    expect(screen.queryByRole('option', { name: 'Cascade' })).not.toBeInTheDocument();

    fireEvent.change(select, { target: { value: 'sierra-travel' } });

    expect(updateInterlaceGroup).toHaveBeenCalledWith('interlace-1', {
      patternPreset: 'sierra-travel',
    });
  });

  it('shows Sierra Travel as a fixed 50/50 pattern instead of a dominance control', () => {
    mockStore.layerGroups[0].interlace.patternPreset = 'sierra-travel';

    render(<InterlaceSettingsPanel />);

    expect(screen.getByText('Window action · Leading edge B → trailing edge A')).toBeInTheDocument();
    expect(screen.getByText('Pattern motion · Rigid horizontal sheet')).toBeInTheDocument();
    expect(screen.queryByLabelText('Interlace pose dominance')).not.toBeInTheDocument();

  });
  it('offers only normal and Color Cycle layers in the public Add selector', () => {
    mockStore.layers.push(
      { id: 'normal', name: 'Outside normal', layerType: 'normal', groupId: '', order: 2 },
      { id: 'cc', name: 'Outside CC', layerType: 'color-cycle', groupId: '', order: 3 },
      { id: 'adjustment', name: 'Outside adjustment', layerType: 'adjustment', groupId: '', order: 4 },
      { id: 'sequence', name: 'Outside sequence', layerType: 'sequential', groupId: '', order: 5 },
    );
    render(<InterlaceSettingsPanel />);

    const select = screen.getByRole('combobox', { name: 'Layer to add to interlace' });
    expect(Array.from((select as HTMLSelectElement).options).map(option => option.value)).toEqual(['normal', 'cc']);
    fireEvent.change(select, { target: { value: 'cc' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(mockStore.moveLayersToGroup).toHaveBeenCalledWith(['cc'], 'interlace-1', 2);
  });

  it('disables Add when only unsupported outside layers are available', () => {
    mockStore.layers.push(
      { id: 'adjustment', name: 'Outside adjustment', layerType: 'adjustment', groupId: '', order: 2 },
      { id: 'sequence', name: 'Outside sequence', layerType: 'sequential', groupId: '', order: 3 },
    );
    render(<InterlaceSettingsPanel />);

    expect(screen.getByRole('option', { name: 'No available layers' })).toHaveValue('');
    const add = screen.getByRole('button', { name: 'Add' });
    expect(add).toBeDisabled();
    fireEvent.click(add);
    expect(mockStore.moveLayersToGroup).not.toHaveBeenCalled();
  });

  it('disables Create when the selected set has only one eligible source', () => {
    mockStore.layerGroups = [];
    mockStore.layers = [
      { id: 'normal', name: 'Normal', layerType: 'normal', groupId: '', order: 0 },
      { id: 'adjustment', name: 'Adjustment', layerType: 'adjustment', groupId: '', order: 1 },
      { id: 'sequence', name: 'Sequence', layerType: 'sequential', groupId: '', order: 2 },
    ];
    mockStore.activeLayerId = 'normal';
    mockStore.selectedLayerIds = mockStore.layers.map(layer => layer.id);
    render(<InterlaceSettingsPanel />);

    const create = screen.getByRole('button', { name: 'Create from selection' });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(mockStore.createInterlaceGroupFromSelection).not.toHaveBeenCalled();
  });

  it('passes only the two eligible selected IDs to Create', () => {
    mockStore.layerGroups = [];
    mockStore.layers = [
      { id: 'normal', name: 'Normal', layerType: 'normal', groupId: '', order: 0 },
      { id: 'adjustment', name: 'Adjustment', layerType: 'adjustment', groupId: '', order: 1 },
      { id: 'cc', name: 'CC', layerType: 'color-cycle', groupId: '', order: 2 },
      { id: 'sequence', name: 'Sequence', layerType: 'sequential', groupId: '', order: 3 },
    ];
    mockStore.activeLayerId = 'normal';
    mockStore.selectedLayerIds = mockStore.layers.map(layer => layer.id);
    render(<InterlaceSettingsPanel />);

    const create = screen.getByRole('button', { name: 'Create from selection' });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    expect(mockStore.createInterlaceGroupFromSelection).toHaveBeenCalledWith(['normal', 'cc']);
  });

  it('does not expose unsupported stale group members as pose controls', () => {
    mockStore.layers.push(
      { id: 'adjustment', name: 'Adjustment', layerType: 'adjustment', groupId: 'interlace-1', order: 2 },
      { id: 'sequence', name: 'Sequence', layerType: 'sequential', groupId: 'interlace-1', order: 3 },
    );
    render(<InterlaceSettingsPanel />);

    expect(screen.getByRole('button', { name: 'Remove Pose A from interlace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove Pose B from interlace' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Adjustment from interlace' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Remove Sequence from interlace' })).not.toBeInTheDocument();
  });

});
