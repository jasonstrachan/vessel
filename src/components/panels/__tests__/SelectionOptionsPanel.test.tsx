import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';

describe('SelectionOptionsPanel', () => {
  const originalTools = useAppStore.getState().tools;
  const originalSelectionStart = useAppStore.getState().selectionStart;
  const originalSelectionEnd = useAppStore.getState().selectionEnd;
  const originalSelectionMask = useAppStore.getState().selectionMask;
  const originalSelectionMaskBounds = useAppStore.getState().selectionMaskBounds;
  const originalProject = useAppStore.getState().project;
  const originalLayers = useAppStore.getState().layers;
  const originalActiveLayerId = useAppStore.getState().activeLayerId;

  afterEach(() => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: originalTools,
        selectionStart: originalSelectionStart,
        selectionEnd: originalSelectionEnd,
        selectionMask: originalSelectionMask,
        selectionMaskBounds: originalSelectionMaskBounds,
        project: originalProject,
        layers: originalLayers,
        activeLayerId: originalActiveLayerId,
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
    expect(screen.getByRole('button', { name: 'Invert' })).toBeInTheDocument();
  });

  it('inverts the current marquee selection from the panel control', () => {
    const canvas = document.createElement('canvas');
    canvas.width = 4;
    canvas.height = 3;

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'selection', selectionMode: 'marquee' },
        project: {
          id: 'selection-options-project',
          name: 'Selection Options Project',
          width: 4,
          height: 3,
          layers: [],
          backgroundColor: '#000000',
          createdAt: new Date(),
          updatedAt: new Date(),
          customBrushes: [],
        },
        layers: [{
          id: 'selection-options-layer',
          name: 'Layer',
          visible: true,
          opacity: 1,
          blendMode: 'source-over',
          locked: false,
          transparencyLocked: false,
          order: 0,
          imageData: new ImageData(4, 3),
          framebuffer: canvas,
          alignment: createDefaultLayerAlignment(),
          layerType: 'normal',
        }],
        activeLayerId: 'selection-options-layer',
        selectionStart: { x: 1, y: 1 },
        selectionEnd: { x: 3, y: 2 },
      }));
    });

    render(<BrushSettingsPanel />);
    fireEvent.click(screen.getByRole('button', { name: 'Invert' }));

    const state = useAppStore.getState();
    expect(state.selectionMask).toBeTruthy();
    expect(state.selectionMaskBounds).toEqual({ x: 0, y: 0, width: 4, height: 3 });
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
