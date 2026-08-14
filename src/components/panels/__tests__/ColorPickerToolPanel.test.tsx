import React from 'react';
import { render, screen, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import BrushSettingsPanel from '../BrushSettingsPanel';
import { useAppStore } from '@/stores/useAppStore';

describe('ColorPickerToolPanel', () => {
  const originalTools = useAppStore.getState().tools;
  const originalPalette = useAppStore.getState().palette;
  const originalLayers = useAppStore.getState().layers;
  const originalActiveLayerId = useAppStore.getState().activeLayerId;
  const originalProject = useAppStore.getState().project;
  const originalPreference = useAppStore.getState().colorPickerPreferReferenceLayer;

  afterEach(() => {
    act(() => {
      useAppStore.setState({
        tools: originalTools,
        palette: originalPalette,
        layers: originalLayers,
        activeLayerId: originalActiveLayerId,
        project: originalProject,
        colorPickerPreferReferenceLayer: originalPreference,
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
    expect(screen.getByText(/^Eyedropper$/i)).toBeInTheDocument();
    expect(screen.getByText('CC gradients')).toBeInTheDocument();
    expect(screen.getByText('Regular pixels')).toBeInTheDocument();
    expect(screen.queryByText(/reuse its complete gradient/i)).not.toBeInTheDocument();
  });

  it('shows and switches the actual CC and regular pixel sources', async () => {
    const user = userEvent.setup();
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'color-picker' },
        layers: [
          { id: 'active-cc', name: 'Animated ink', layerType: 'color-cycle', visible: true },
          { id: 'reference', name: 'Portrait ref', layerType: 'normal', visible: true },
        ] as typeof state.layers,
        activeLayerId: 'active-cc',
        project: { ...state.project, referenceLayerId: 'reference' } as typeof state.project,
        colorPickerPreferReferenceLayer: true,
      }));
    });

    render(<BrushSettingsPanel />);

    expect(screen.getByText('Reference · Portrait ref')).toBeInTheDocument();
    expect(screen.getByText('None')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Canvas' }));

    expect(screen.getByText('Active · Animated ink')).toBeInTheDocument();
    expect(screen.getByText('Visible canvas')).toBeInTheDocument();
    expect(useAppStore.getState().colorPickerPreferReferenceLayer).toBe(false);
  });

  it('is hidden when a different tool is active', () => {
    act(() => {
      useAppStore.setState((state) => ({
        ...state,
        tools: { ...state.tools, currentTool: 'brush' },
      }));
    });

    render(<BrushSettingsPanel />);

    expect(screen.queryByText(/eyedropper/i)).toBeNull();
  });
});
