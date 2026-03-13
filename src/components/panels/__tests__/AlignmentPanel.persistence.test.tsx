import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';

const LAYER_ALIGNMENT_PANEL_EXPANDED_STORAGE_KEY = 'vessel-layer-alignment-panel-expanded';

jest.mock('@/stores/useAppStore', () => {
  type MockLayer = {
    id: string;
    alignment: {
      fit: 'contain';
      horizontal: 'center';
      vertical: 'center';
      positioning: 'anchor';
      offsetPx: { x: number; y: number };
    };
  };

  type MockState = {
    activeLayerId: string | null;
    layers: MockLayer[];
    selectedLayerIds: string[];
    project: null;
    updateLayerAlignment: jest.Mock;
  };

  const state: MockState = {
    activeLayerId: 'layer-1',
    layers: [
      {
        id: 'layer-1',
        alignment: {
          fit: 'contain',
          horizontal: 'center',
          vertical: 'center',
          positioning: 'anchor',
          offsetPx: { x: 0, y: 0 },
        },
      },
    ],
    selectedLayerIds: ['layer-1'],
    project: null,
    updateLayerAlignment: jest.fn(),
  };

  return {
    useAppStore: <T,>(selector: (store: MockState) => T): T => selector(state),
  };
});

import AlignmentPanel from '@/components/panels/AlignmentPanel';

describe('AlignmentPanel persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(LAYER_ALIGNMENT_PANEL_EXPANDED_STORAGE_KEY);
  });

  it('restores collapsed state across remounts', () => {
    const view = render(<AlignmentPanel />);

    fireEvent.click(screen.getByRole('button', { name: /Layer alignment/i }));

    expect(window.localStorage.getItem(LAYER_ALIGNMENT_PANEL_EXPANDED_STORAGE_KEY)).toBe('0');
    expect(screen.queryByText('Anchor')).toBeNull();

    view.unmount();
    render(<AlignmentPanel />);

    expect(screen.getByRole('button', { name: /Layer alignment/i })).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Anchor')).toBeNull();
  });
});
