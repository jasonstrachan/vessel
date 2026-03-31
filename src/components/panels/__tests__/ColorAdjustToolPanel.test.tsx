import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';

import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer } from '@/types';

const DEFAULT_ALIGNMENT = {
  fit: 'none',
  horizontal: 'center',
  vertical: 'center',
  positioning: 'anchor',
} as const;

const createRasterLayer = (id: string, name: string): Layer => {
  const imageData = new ImageData(2, 2);
  const framebuffer = document.createElement('canvas');
  framebuffer.width = imageData.width;
  framebuffer.height = imageData.height;
  framebuffer.getContext('2d')?.putImageData(imageData, 0, 0);

  return {
    id,
    name,
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'normal',
    imageData,
    framebuffer,
    alignment: DEFAULT_ALIGNMENT,
  };
};

const createColorCycleLayer = (id: string, name: string): Layer => {
  const imageData = new ImageData(2, 2);
  const framebuffer = document.createElement('canvas');
  framebuffer.width = imageData.width;
  framebuffer.height = imageData.height;

  return {
    id,
    name,
    order: 0,
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    layerType: 'color-cycle',
    imageData,
    framebuffer,
    alignment: DEFAULT_ALIGNMENT,
    colorCycleData: {
      mode: 'brush',
      gradient: [
        { position: 0, color: 'rgb(255, 0, 0)' },
        { position: 1, color: 'rgb(255, 255, 0)' },
      ],
      gradientDefs: [{ id: 'g0', currentSlot: 0 }],
      slotPalettes: [{
        slot: 0,
        stops: [
          { position: 0, color: 'rgb(255, 0, 0)' },
          { position: 1, color: 'rgb(255, 255, 0)' },
        ],
      }],
      activeGradientId: 'g0',
      paintSlot: 0,
    },
  };
};

describe('ColorAdjustToolPanel', () => {
  const initialState = useAppStore.getInitialState();

  afterEach(() => {
    act(() => {
      useAppStore.setState({
        ...initialState,
      });
    });
    jest.restoreAllMocks();
  });

  it('renders the multi-layer Hue/Sat target without triggering the snapshot loop warning', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const layerA = createRasterLayer('layer-a', 'Layer A');
    const layerB = createRasterLayer('layer-b', 'Layer B');

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        layers: [layerA, layerB],
        activeLayerId: layerA.id,
        selectedLayerIds: [layerA.id, layerB.id],
        project: state.project
          ? {
              ...state.project,
              width: 2,
              height: 2,
              layers: [layerA, layerB],
            }
          : {
              id: 'test-project',
              name: 'Test Project',
              width: 2,
              height: 2,
              layers: [layerA, layerB],
              backgroundColor: '#000000',
              createdAt: new Date(),
              updatedAt: new Date(),
              customBrushes: [],
              palette: state.palette,
            },
        tools: {
          ...state.tools,
          currentTool: 'color-adjust',
          previousTool: 'brush',
        },
        colorAdjust: {
          ...state.colorAdjust,
          active: false,
          targetLayerId: null,
          targetLayerIds: [],
        },
      }));
    });

    render(<BrushSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText('2 Layers')).toBeInTheDocument();
    });

    expect(useAppStore.getState().colorAdjust.targetLayerIds).toEqual([layerA.id, layerB.id]);
    expect(
      consoleErrorSpy.mock.calls.some(([message]) =>
        String(message).includes('The result of getSnapshot should be cached')
      )
    ).toBe(false);
  });

  it('shows Selection for a single color-cycle target when a selection exists', async () => {
    const layer = createColorCycleLayer('cc-layer', 'CC Layer');

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        layers: [layer],
        activeLayerId: layer.id,
        selectedLayerIds: [layer.id],
        selectionStart: { x: 0, y: 0 },
        selectionEnd: { x: 1, y: 1 },
        project: state.project
          ? {
              ...state.project,
              width: 2,
              height: 2,
              layers: [layer],
            }
          : {
              id: 'test-project',
              name: 'Test Project',
              width: 2,
              height: 2,
              layers: [layer],
              backgroundColor: '#000000',
              createdAt: new Date(),
              updatedAt: new Date(),
              customBrushes: [],
              palette: state.palette,
            },
        tools: {
          ...state.tools,
          currentTool: 'color-adjust',
          previousTool: 'brush',
        },
        colorAdjust: {
          ...state.colorAdjust,
          active: false,
          targetLayerId: null,
          targetLayerIds: [],
          selectionBounds: null,
        },
      }));
    });

    render(<BrushSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText('CC Layer')).toBeInTheDocument();
      expect(screen.getByText('(Selection)')).toBeInTheDocument();
    });
  });
});
