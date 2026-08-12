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

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe('InterlaceSettingsPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.layerGroups[0].interlace.patternPreset = 'classic';
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
});
