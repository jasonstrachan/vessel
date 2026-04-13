import React from 'react';
import { act, render, screen } from '@testing-library/react';

import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';

describe('BrushSettingsPanel filters section', () => {
  const initialState = useAppStore.getInitialState();

  afterEach(() => {
    act(() => {
      useAppStore.setState({
        ...initialState,
      });
    });
  });

  it('renders display filters inside the brush settings panel when the filters section is active', () => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        ui: {
          ...state.ui,
          brushPanelSection: 'filters',
        },
      }));
    });

    render(<BrushSettingsPanel />);

    expect(screen.getByText('Pixelate')).toBeInTheDocument();
    expect(screen.getByLabelText('Pixelate enabled')).toBeInTheDocument();
  });
});
