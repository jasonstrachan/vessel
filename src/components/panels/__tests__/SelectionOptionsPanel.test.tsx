import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';

describe('SelectionOptionsPanel', () => {
  const originalTools = useAppStore.getState().tools;

  afterEach(() => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: originalTools,
      }));
    });
  });

  it('renders selection mode controls when selection tool is active', () => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'selection', selectionMode: 'marquee' },
      }));
    });

    render(<BrushSettingsPanel />);

    expect(screen.getByRole('button', { name: 'Marquee' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Freehand' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Click Line' })).toBeInTheDocument();
  });

  it('updates selection mode when selecting an option', () => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'selection', selectionMode: 'marquee' },
      }));
    });

    render(<BrushSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Freehand' }));
    expect(useAppStore.getState().tools.selectionMode).toBe('freehand');
  });
});
