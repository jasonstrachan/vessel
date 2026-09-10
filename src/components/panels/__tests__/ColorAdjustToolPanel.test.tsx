import React from 'react';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

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

    expect(screen.getByRole('slider', { name: 'Contrast adjustment' })).toBeInTheDocument();
    expect(screen.queryByRole('slider', { name: 'CC Ink Contrast adjustment' })).not.toBeInTheDocument();
    expect(useAppStore.getState().colorAdjust.targetLayerIds).toEqual([layerA.id, layerB.id]);
    act(() => useAppStore.getState().updateColorAdjustParams({
      lightnessRangeEnabled: true, lightnessRangeStart: 20, lightnessRangeEnd: 90,
    }));
    const endValue = screen.getByRole('spinbutton', { name: 'Lightness range end value' });
    fireEvent.focus(endValue);
    fireEvent.change(endValue, { target: { value: '3' } });
    expect(endValue).toHaveValue(3);
    expect(useAppStore.getState().colorAdjust.params.lightnessRangeEnd).toBe(90);
    fireEvent.change(endValue, { target: { value: '35' } });
    fireEvent.blur(endValue);
    expect(useAppStore.getState().colorAdjust.params.lightnessRangeEnd).toBe(35);
    fireEvent.change(endValue, { target: { value: '80' } });
    fireEvent.keyDown(endValue, { key: 'Escape' });
    expect(endValue).toHaveValue(35);
    expect(useAppStore.getState().colorAdjust.active).toBe(true);
    expect(
      consoleErrorSpy.mock.calls.some(([message]) =>
        String(message).includes('The result of getSnapshot should be cached')
      )
    ).toBe(false);
  });

  it('shows Selection for a single color-cycle target when a selection exists', async () => {
    const layer = createColorCycleLayer('cc-layer', 'CC Layer');
    const ensureColorCycleLayerRuntime = jest.fn(async () => true);

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
        ensureColorCycleLayerRuntime,
      }));
    });

    render(<BrushSettingsPanel />);

    await waitFor(() => {
      expect(screen.getByText('CC Layer')).toBeInTheDocument();
      expect(screen.getByText('(Selection)')).toBeInTheDocument();
    });
    expect(screen.getByRole('slider', { name: 'Contrast adjustment' })).toBeInTheDocument();
    expect(screen.getByRole('slider', { name: 'CC Ink Contrast adjustment' })).toBeInTheDocument();
    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith(layer.id, { target: 'active' });
  });

  it('waits for a color-cycle runtime before enabling Hue/Sat edits', async () => {
    const layer = createColorCycleLayer('cc-cold-layer', 'Cold CC Layer');
    let resolveRuntime: ((ready: boolean) => void) | null = null;
    const runtimeReady = new Promise<boolean>((resolve) => {
      resolveRuntime = resolve;
    });
    const ensureColorCycleLayerRuntime = jest.fn(() => runtimeReady);
    const originalStartColorAdjustSession = useAppStore.getState().startColorAdjustSession;
    const startColorAdjustSession = jest.fn(() => originalStartColorAdjustSession());

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        layers: [layer],
        activeLayerId: layer.id,
        selectedLayerIds: [layer.id],
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
          currentTool: 'brush',
          previousTool: 'selection',
        },
        colorAdjust: {
          ...state.colorAdjust,
          active: false,
          targetLayerId: null,
          targetLayerIds: [],
        },
        ensureColorCycleLayerRuntime,
        startColorAdjustSession,
      }));
    });

    render(<BrushSettingsPanel />);
    act(() => {
      useAppStore.getState().setCurrentTool('color-adjust');
    });

    await waitFor(() => {
      expect(screen.getByRole('status')).toHaveTextContent('Preparing Color Cycle data');
    });
    expect(screen.getByRole('slider', { name: 'Saturation adjustment' })).toBeDisabled();
    expect(startColorAdjustSession).not.toHaveBeenCalled();

    await act(async () => {
      resolveRuntime?.(true);
      await runtimeReady;
    });

    await waitFor(() => {
      expect(startColorAdjustSession).toHaveBeenCalledTimes(1);
      expect(screen.getByRole('slider', { name: 'Saturation adjustment' })).toBeEnabled();
    });
    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith(layer.id, { target: 'active' });
  });

  it('restarts the session when the selected color-cycle layer changes', async () => {
    const layerA = createColorCycleLayer('cc-layer-a', 'CC Layer A');
    const layerB = createColorCycleLayer('cc-layer-b', 'CC Layer B');
    const ensureColorCycleLayerRuntime = jest.fn(async () => true);
    const originalCancelColorAdjust = useAppStore.getState().cancelColorAdjust;
    const cancelColorAdjust = jest.fn(() => originalCancelColorAdjust());

    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        layers: [layerA, layerB],
        activeLayerId: layerA.id,
        selectedLayerIds: [layerA.id],
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
          currentTool: 'brush',
          previousTool: 'selection',
        },
        colorAdjust: {
          ...state.colorAdjust,
          active: false,
          targetLayerId: null,
          targetLayerIds: [],
        },
        ensureColorCycleLayerRuntime,
        cancelColorAdjust,
      }));
    });

    render(<BrushSettingsPanel />);
    act(() => {
      useAppStore.getState().setCurrentTool('color-adjust');
    });

    await waitFor(() => {
      expect(useAppStore.getState().colorAdjust.targetLayerIds).toEqual([layerA.id]);
    });

    act(() => {
      useAppStore.setState({
        activeLayerId: layerB.id,
        selectedLayerIds: [layerB.id],
      });
    });

    await waitFor(() => {
      expect(useAppStore.getState().colorAdjust.targetLayerIds).toEqual([layerB.id]);
    });
    expect(cancelColorAdjust).toHaveBeenCalledTimes(1);
    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith(layerA.id, { target: 'active' });
    expect(ensureColorCycleLayerRuntime).toHaveBeenCalledWith(layerB.id, { target: 'active' });
  });
});
