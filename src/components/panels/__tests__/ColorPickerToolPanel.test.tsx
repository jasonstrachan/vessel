import React from 'react';
import { render, screen, act } from '@testing-library/react';
import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';

describe('ColorPickerToolPanel', () => {
  const originalTools = useAppStore.getState().tools;
  const originalPalette = useAppStore.getState().palette;

  afterEach(() => {
    act(() => {
      useAppStore.setState({
        tools: originalTools,
        palette: originalPalette,
      });
    });
  });

  it('shows hex and RGB values when color picker tool is active', () => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'color-picker' },
        palette: { ...state.palette, foregroundColor: '#1A2B3C', activeSlot: 'foreground' },
      }));
    });

    render(<BrushSettingsPanel />);

    expect(screen.getByText('#1A2B3C')).toBeInTheDocument();
    expect(screen.getByText('26, 43, 60')).toBeInTheDocument();
    expect(screen.getByText(/^Color Picker$/i)).toBeInTheDocument();
  });

  it('is hidden when a different tool is active', () => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'brush' },
      }));
    });

    render(<BrushSettingsPanel />);

    expect(screen.queryByText(/color picker/i)).toBeNull();
  });
});
