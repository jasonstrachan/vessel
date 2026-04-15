import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DisplayFiltersSection } from '../DisplayFiltersSection';

const mockStore = {
  canvas: {
    displayFilters: [
      { id: 'pixelate', enabled: false, settings: { cellSize: 3 } },
      { id: 'round-pixels', enabled: true, settings: { blurRadius: 2, threshold: 0.48, crush: 0.4, preserveColor: 0.85 } },
      { id: 'bloom', enabled: true, settings: { blurRadius: 2, intensity: 0.18 } },
      { id: 'color-grade', enabled: false, settings: { brightness: -0.02, contrast: 0.08, saturation: 0.88 } },
      { id: 'lcd-mask', enabled: false, settings: { stripeOpacity: 0.16, scanlineOpacity: 0.05 } },
      {
        id: 'crt-grid',
        enabled: true,
        settings: { lineOpacity: 0.14, lineSpacing: 4, phosphorOpacity: 0.12, scanlineOpacity: 0.18 },
      },
      { id: 'chromatic-aberration', enabled: true, settings: { offset: 2, intensity: 0.38 } },
      { id: 'noise', enabled: true, settings: { opacity: 0.08, scale: 2 } },
    ],
  },
  setDisplayFilterEnabled: jest.fn(),
  updateDisplayFilter: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  __esModule: true,
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe('DisplayFiltersSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders the filter controls stack', () => {
    render(<DisplayFiltersSection />);

    expect(screen.getByText('Pixelate')).toBeInTheDocument();
    expect(screen.getByText('Round Pixels')).toBeInTheDocument();
    expect(screen.getByText('Bloom')).toBeInTheDocument();
    expect(screen.getByText('Color Grade')).toBeInTheDocument();
    expect(screen.getByText('LCD Mask')).toBeInTheDocument();
    expect(screen.getByText('CRT Grid')).toBeInTheDocument();
    expect(screen.getByText('Chromatic Aberration')).toBeInTheDocument();
    expect(screen.getByText('Noise')).toBeInTheDocument();
  });

  it('routes toggle changes through the store', () => {
    render(<DisplayFiltersSection />);

    fireEvent.click(screen.getByLabelText('Pixelate enabled'));

    expect(mockStore.setDisplayFilterEnabled).toHaveBeenCalledWith('pixelate', true);
  });

  it('keeps disabled filter controls collapsed', () => {
    render(<DisplayFiltersSection />);

    expect(screen.queryByLabelText('Pixelate cell size')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('LCD mask stripe opacity')).not.toBeInTheDocument();
    expect(screen.getByLabelText('Round pixels threshold')).toBeInTheDocument();
  });

  it('routes slider changes through the store', () => {
    render(<DisplayFiltersSection />);

    fireEvent.change(screen.getByLabelText('Round pixels blur radius'), { target: { value: '3.25' } });
    fireEvent.change(screen.getByLabelText('Round pixels threshold'), { target: { value: '0.62' } });
    fireEvent.change(screen.getByLabelText('Round pixels levels crush'), { target: { value: '0.58' } });
    fireEvent.change(screen.getByLabelText('Round pixels preserve color'), { target: { value: '0.91' } });
    fireEvent.change(screen.getByLabelText('Bloom blur radius'), { target: { value: '4.5' } });
    fireEvent.change(screen.getByLabelText('CRT grid line spacing'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('CRT grid phosphor glow'), { target: { value: '0.24' } });
    fireEvent.change(screen.getByLabelText('Chromatic aberration offset'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Noise scale'), { target: { value: '3' } });

    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { blurRadius: 3.25 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { threshold: 0.62 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { crush: 0.58 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { preserveColor: 0.91 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('bloom', { blurRadius: 4.5 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('crt-grid', { lineSpacing: 6 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('crt-grid', { phosphorOpacity: 0.24 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('chromatic-aberration', { offset: 1.5 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('noise', { scale: 3 });
  });
});
