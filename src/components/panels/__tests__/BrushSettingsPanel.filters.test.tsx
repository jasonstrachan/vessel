import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';

import BrushSettingsPanel from '../BrushSettingsPanel';
import BrushLibrary from '@/components/BrushLibrary';
import studioExtension from '@/extensions/studioExtension';
import { useAppStore } from '@/stores/useAppStore';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer } from '@/types';

jest.mock('@/utils/brushThumbnailGenerator', () => ({
  generateBrushThumbnail: () => '',
}));

describe('BrushSettingsPanel filters section', () => {
  const initialState = useAppStore.getInitialState();

  beforeAll(() => {
    global.ResizeObserver = class ResizeObserver {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
  });

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

  it('selects the single Filters library entry and shows its controls only in options', () => {
    render(<><div data-testid="library"><BrushLibrary /></div><div data-testid="options"><BrushSettingsPanel /></div></>);
    const library = within(screen.getByTestId('library'));
    const options = within(screen.getByTestId('options'));
    fireEvent.click(library.getByRole('button', { name: 'Effects' }));
    fireEvent.click(library.getByRole('button', { name: 'Filters' }));
    expect(library.getByRole('button', { name: 'Filters' })).toHaveAttribute('aria-pressed', 'true');
    expect(library.queryByLabelText('Noise enabled')).not.toBeInTheDocument();
    expect(options.getByLabelText('Noise enabled')).toBeInTheDocument();
    expect(screen.getAllByLabelText('Noise enabled')).toHaveLength(1);
  });

  it('opens Unresolve from Effects without selecting a brush and disposes its preview when leaving', () => {
    const previous = studioExtension.UnresolveSettings;
    const disposed = jest.fn();
    const UnresolveOptions = () => {
      React.useEffect(() => disposed, []);
      return <div>Set resolved frame</div>;
    };
    studioExtension.UnresolveSettings = UnresolveOptions;
    try {
      const brush = useAppStore.getState().currentBrushPreset;
      const tool = useAppStore.getState().tools.currentTool;
      render(<><div data-testid="library"><BrushLibrary /></div><div data-testid="options"><BrushSettingsPanel /></div></>);
      const library = within(screen.getByTestId('library'));
      const options = within(screen.getByTestId('options'));
      fireEvent.click(library.getByRole('button', { name: 'Brushes' }));
      expect(library.queryByRole('button', { name: 'Unresolve' })).not.toBeInTheDocument();
      fireEvent.click(library.getByRole('button', { name: 'Effects' }));
      fireEvent.click(library.getByRole('button', { name: 'Unresolve' }));
      expect(library.getByRole('button', { name: 'Unresolve' })).toHaveAttribute('aria-pressed', 'true');
      expect(options.getByText('Set resolved frame')).toBeVisible();
      expect(useAppStore.getState().currentBrushPreset).toBe(brush);
      expect(useAppStore.getState().tools.currentTool).toBe(tool);
      fireEvent.click(library.getByRole('button', { name: 'Filters' }));
      expect(options.queryByText('Set resolved frame')).not.toBeInTheDocument();
      expect(disposed).toHaveBeenCalledTimes(1);
    } finally {
      studioExtension.UnresolveSettings = previous;
    }
  });

  it('prioritizes the selected adjustment layer editor and exposes its target selector', () => {
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
    expect(screen.queryByText(/Layer opacity controls strength/)).not.toBeInTheDocument();
    expect(screen.getByText('Affects')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'All lower layers' })).toBeInTheDocument();
    expect(screen.getByLabelText('Strength adjustment')).toBeInTheDocument();
    expect(screen.getByText('Reset Effect')).toBeInTheDocument();
    expect(screen.queryByText('Pixelate')).not.toBeInTheDocument();

    act(() => { useAppStore.getState().setBrushPanelSection('filters'); });
    expect(screen.getByLabelText('Pixelate enabled')).toBeInTheDocument();
    expect(screen.queryByText('Reset Effect')).not.toBeInTheDocument();

  });
});
