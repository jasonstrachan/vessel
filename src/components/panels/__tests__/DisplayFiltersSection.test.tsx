import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { DisplayFiltersSection } from '../DisplayFiltersSection';

const mockStore = {
  canvas: {
    displayFilters: [
      { id: 'pixelate', enabled: false, settings: { cellSize: 3 } },
      { id: 'bloom', enabled: true, settings: { blurRadius: 2, intensity: 0.18 } },
      { id: 'color-grade', enabled: false, settings: { brightness: -0.02, contrast: 0.08, saturation: 0.88 } },
      { id: 'lcd-mask', enabled: false, settings: { stripeOpacity: 0.16, scanlineOpacity: 0.05 } },
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
    expect(screen.getByText('Bloom')).toBeInTheDocument();
    expect(screen.getByText('Color Grade')).toBeInTheDocument();
    expect(screen.getByText('LCD Mask')).toBeInTheDocument();
    expect(screen.getByText('Noise')).toBeInTheDocument();
  });

  it('routes toggle changes through the store', () => {
    render(<DisplayFiltersSection />);

    fireEvent.click(screen.getByLabelText('Pixelate enabled'));

    expect(mockStore.setDisplayFilterEnabled).toHaveBeenCalledWith('pixelate', true);
  });

  it('routes slider changes through the store', () => {
    render(<DisplayFiltersSection />);

    fireEvent.change(screen.getByLabelText('Bloom blur radius'), { target: { value: '4.5' } });
    fireEvent.change(screen.getByLabelText('Noise scale'), { target: { value: '3' } });

    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('bloom', { blurRadius: 4.5 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('noise', { scale: 3 });
  });
});
