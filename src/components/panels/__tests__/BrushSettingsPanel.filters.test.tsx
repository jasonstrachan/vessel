import React from 'react';
import { act, render, screen } from '@testing-library/react';

import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

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

  it('prioritizes the selected adjustment layer editor and explains its scope', () => {
    const canvas = document.createElement('canvas');
    const layer: Layer = {
      id: 'adjustment-1',
      name: 'Hue/Sat 1',
      visible: true,
      opacity: 1,
      blendMode: 'source-over',
      locked: false,
      order: 0,
      imageData: null,
      framebuffer: canvas,
      alignment: createDefaultLayerAlignment(),
      layerType: 'adjustment',
      adjustmentData: {
        effect: {
          id: 'hue-sat',
          settings: {
            hue: 0,
            saturation: 0,
            vibrance: 0,
            lightness: 0,
            contrast: 0,
            red: 0,
            green: 0,
            blue: 0,
            hueRangeEnabled: false,
            hueRangeStart: 0,
            hueRangeEnd: 360,
          },
        },
      },
    };
    act(() => {
      useAppStore.setState({
        layers: [layer],
        activeLayerId: layer.id,
        selectedLayerIds: [layer.id],
      });
    });

    render(<BrushSettingsPanel />);

    expect(screen.getByText('Hue/Sat 1')).toBeInTheDocument();
    expect(screen.getByText('Affects all lower layers. Layer opacity controls strength.')).toBeInTheDocument();
    expect(screen.getByLabelText('Strength adjustment')).toBeInTheDocument();
    expect(screen.getByText('Reset Effect')).toBeInTheDocument();
    expect(screen.queryByText('Pixelate')).not.toBeInTheDocument();
  });
});
