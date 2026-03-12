import { act, fireEvent, render, screen } from '@testing-library/react';
import React from 'react';

import GridSettingsPanel from '@/components/panels/GridSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';
import { createDefaultUIState } from '@/stores/slices/uiSlice';

describe('GridSettingsPanel', () => {
  beforeEach(() => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        ui: createDefaultUIState(),
      }));
    });
  });

  it('renders current grid settings and updates dimensions', () => {
    render(<GridSettingsPanel />);

    const rowsInput = screen.getByLabelText('Grid rows') as HTMLInputElement;
    const columnsInput = screen.getByLabelText('Grid columns') as HTMLInputElement;
    expect(rowsInput.value).toBe('8');
    expect(columnsInput.value).toBe('8');

    fireEvent.change(rowsInput, { target: { value: '12' } });
    fireEvent.change(columnsInput, { target: { value: '5' } });

    const state = useAppStore.getState();
    expect(state.ui.grid.rows).toBe(12);
    expect(state.ui.grid.columns).toBe(5);
  });

  it('toggles the grid from the settings panel', () => {
    render(<GridSettingsPanel />);

    const toggle = screen.getByLabelText('On') as HTMLInputElement;
    expect(toggle.checked).toBe(false);

    fireEvent.click(toggle);

    expect(useAppStore.getState().ui.grid.enabled).toBe(true);
  });
});
