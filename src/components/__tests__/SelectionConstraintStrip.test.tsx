import React from 'react';
import { act, render, screen } from '@testing-library/react';

import SelectionConstraintStrip from '@/components/SelectionConstraintStrip';
import { useAppStore } from '@/stores/useAppStore';

describe('SelectionConstraintStrip', () => {
  const originalState = useAppStore.getState();

  afterEach(() => {
    act(() => {
      useAppStore.setState({
        tools: originalState.tools,
        selectionStart: originalState.selectionStart,
        selectionEnd: originalState.selectionEnd,
        selectionMask: originalState.selectionMask,
        selectionMaskBounds: originalState.selectionMaskBounds,
      });
    });
  });

  it('renders for constrained tools when a rectangular selection is active', () => {
    act(() => {
      useAppStore.setState((state) => ({
        tools: { ...state.tools, currentTool: 'brush' },
        selectionStart: { x: 1, y: 1 },
        selectionEnd: { x: 4, y: 4 },
        selectionMask: null,
        selectionMaskBounds: null,
      }));
    });

    render(<SelectionConstraintStrip />);

    expect(screen.getByText('Selection active: paint output constrained to selected area')).toBeInTheDocument();
  });

  it('renders for mask-backed selections', () => {
    const mask = new ImageData(2, 2);
    mask.data[3] = 255;

    act(() => {
      useAppStore.setState((state) => ({
        tools: { ...state.tools, currentTool: 'fill' },
        selectionStart: null,
        selectionEnd: null,
        selectionMask: mask,
        selectionMaskBounds: { x: 0, y: 0, width: 2, height: 2 },
      }));
    });

    render(<SelectionConstraintStrip />);

    expect(screen.getByText('Selection active: paint output constrained to selected area')).toBeInTheDocument();
  });

  it('does not render for unconstrained tools', () => {
    act(() => {
      useAppStore.setState((state) => ({
        tools: { ...state.tools, currentTool: 'selection' },
        selectionStart: { x: 1, y: 1 },
        selectionEnd: { x: 4, y: 4 },
        selectionMask: null,
        selectionMaskBounds: null,
      }));
    });

    render(<SelectionConstraintStrip />);

    expect(screen.queryByText('Selection active: paint output constrained to selected area')).not.toBeInTheDocument();
  });
});
