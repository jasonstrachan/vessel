import React from 'react';
import type { LayerAlignmentSettings } from '@/types';
import { fireEvent, render, screen } from '@testing-library/react';

const LAYER_ALIGNMENT_PANEL_EXPANDED_STORAGE_KEY = 'vessel-layer-alignment-panel-expanded';

jest.mock('@/stores/useAppStore', () => {
  type MockLayer = {
    id: string;
    alignment: {
      fit: LayerAlignmentSettings['fit'];
      horizontal: LayerAlignmentSettings['horizontal'];
      vertical: LayerAlignmentSettings['vertical'];
      positioning: LayerAlignmentSettings['positioning'];
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
    useAppStore: Object.assign(<T,>(selector: (store: MockState) => T): T => selector(state), { getState: () => state }),
  };
});

import AlignmentPanel from '@/components/panels/AlignmentPanel';

type TestState = {
  activeLayerId: string;
  layers: Array<{ id: string; alignment: LayerAlignmentSettings }>;
  selectedLayerIds: string[];
  updateLayerAlignment: jest.Mock;
};
const getState = () => (jest.requireMock('@/stores/useAppStore') as {
  useAppStore: { getState: () => TestState };
}).useAppStore.getState();
const aligned = (fit: LayerAlignmentSettings['fit'], horizontal: LayerAlignmentSettings['horizontal'],
  vertical: LayerAlignmentSettings['vertical'], x: number, y: number): LayerAlignmentSettings => ({
  fit, horizontal, vertical, positioning: 'anchor', offsetPx: { x, y },
});

describe('AlignmentPanel persistence', () => {
  beforeEach(() => {
    window.localStorage.removeItem(LAYER_ALIGNMENT_PANEL_EXPANDED_STORAGE_KEY);
    const state = getState();
    state.layers = [{ id: 'layer-1', alignment: aligned('contain', 'center', 'center', 0, 0) }];
    state.activeLayerId = 'layer-1';
    state.selectedLayerIds = ['layer-1'];
    state.updateLayerAlignment.mockReset();
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

describe('AlignmentPanel owned offset edits and accessible controls', () => {
  beforeEach(() => {
    window.localStorage.removeItem(LAYER_ALIGNMENT_PANEL_EXPANDED_STORAGE_KEY);
    getState().updateLayerAlignment.mockReset();
  });

  it.each([['X (px)', 'x', 7], ['Y (px)', 'y', -5]] as const)(
    '%s preserves every selected layer own fit, anchor and other axis', (label, axis, value) => {
      const state = getState();
      const a = aligned('none', 'left', 'top', 2, 3);
      const b = aligned('cover', 'right', 'bottom', 9, 11);
      state.layers = [{ id: 'a', alignment: a }, { id: 'b', alignment: b }];
      state.activeLayerId = 'b'; state.selectedLayerIds = ['a', 'b'];
      render(<AlignmentPanel />);
      fireEvent.change(screen.getByLabelText(label), { target: { value: String(value) } });
      expect(state.updateLayerAlignment.mock.calls).toEqual([
        ['a', { ...a, offsetPx: { ...a.offsetPx, [axis]: value } }],
        ['b', { ...b, offsetPx: { ...b.offsetPx, [axis]: value } }],
      ]);
      expect(a.offsetPx).toEqual({ x: 2, y: 3 });
      expect(b.offsetPx).toEqual({ x: 9, y: 11 });
    },
  );

  it('names all nine existing anchor buttons and exposes anchor, Auto and Fit pressed state', () => {
    const state = getState();
    state.layers = [{ id: 'a', alignment: aligned('cover', 'right', 'bottom', 0, 0) }];
    state.activeLayerId = 'a'; state.selectedLayerIds = ['a'];
    const view = render(<AlignmentPanel />);
    for (const vertical of ['top', 'middle', 'bottom']) {
      for (const horizontal of ['left', 'center', 'right']) {
        const control = screen.getByRole('button', { name: `Align ${vertical} ${horizontal}` });
        expect(control).toHaveAttribute('aria-pressed', String(vertical === 'bottom' && horizontal === 'right'));
        expect(control.textContent).toBe('');
      }
    }
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'false');
    for (const name of ['None', 'Contain', 'Cover', 'Fill', 'Tile']) {
      expect(screen.getByRole('button', { name })).toHaveAttribute('aria-pressed', String(name === 'Cover'));
    }
    fireEvent.click(screen.getByRole('button', { name: 'Align top left' }));
    expect(state.updateLayerAlignment).toHaveBeenLastCalledWith('a', aligned('cover', 'left', 'top', 0, 0));
    state.layers = [{ id: 'a', alignment: { ...aligned('contain', 'center', 'center', 0, 0), positioning: 'auto' } }];
    view.unmount();
    render(<AlignmentPanel />);
    expect(screen.getByRole('button', { name: 'Auto' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Align bottom right' })).toHaveAttribute('aria-pressed', 'false');
  });
});
