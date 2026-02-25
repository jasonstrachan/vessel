import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';

describe('SelectionOptionsPanel', () => {
  const originalTools = useAppStore.getState().tools;
  const originalSelectionStart = useAppStore.getState().selectionStart;
  const originalSelectionEnd = useAppStore.getState().selectionEnd;

  afterEach(() => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: originalTools,
        selectionStart: originalSelectionStart,
        selectionEnd: originalSelectionEnd,
        floatingPaste: null,
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

  it('renders flip controls for the selection transform', () => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'selection', selectionMode: 'marquee' },
      }));
    });

    render(<BrushSettingsPanel />);

    expect(screen.getByRole('button', { name: 'Flip H' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Flip V' })).toBeInTheDocument();
  });

  it('flips floating selection horizontally from the panel control', () => {
    const imageData = new ImageData(
      new Uint8ClampedArray([
        1, 0, 0, 255,
        2, 0, 0, 255,
        3, 0, 0, 255,
        4, 0, 0, 255,
      ]),
      2,
      2
    );

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'selection', selectionMode: 'marquee' },
      }));
      useAppStore.getState().setFloatingPaste({
        imageData,
        position: { x: 0, y: 0 },
        width: 2,
        height: 2,
      });
    });

    render(<BrushSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Flip H' }));

    const flipped = useAppStore.getState().floatingPaste?.imageData;
    expect(flipped).toBeTruthy();
    expect(Array.from(flipped!.data)).toEqual([
      2, 0, 0, 255,
      1, 0, 0, 255,
      4, 0, 0, 255,
      3, 0, 0, 255,
    ]);
  });
});
