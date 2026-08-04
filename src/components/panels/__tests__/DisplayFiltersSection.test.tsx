import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { sanitizeDisplayFilters } from '@/lib/displayFilters';
import type { DisplayFilterConfig } from '@/types';

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
        id: 'crt',
        enabled: true,
        settings: {
          cellSize: 12,
          scanlineIntensity: 0.08,
          maskIntensity: 0.07,
          barrelDistortion: 0.15,
          chromaticAberration: 2,
          beamFocus: 0.51,
          brightness: 0.5,
          shadowLift: 0.16,
          vignetteIntensity: 0.45,
          flickerIntensity: 0.2,
          signalArtifacts: 0.45,
          bloomIntensity: 1.93,
          bloomRadius: 24,
        },
      },
      {
        id: 'ntse-crt',
        enabled: true,
        settings: {
          signalSmear: 0.82,
          signalNoise: 0.18,
          scanlineSize: 1,
          scanlineStrength: 0.64,
          glowStrength: 0.32,
        },
      },
      {
        id: 'crt-grid',
        enabled: true,
        settings: { lineOpacity: 0.14, lineSpacing: 4, phosphorOpacity: 0.12, scanlineOpacity: 0.18 },
      },
      { id: 'chromatic-aberration', enabled: true, settings: { offset: 2, intensity: 0.38 } },
      { id: 'noise', enabled: true, settings: { opacity: 0.08, scale: 2 } },
      { id: 'film-noise', enabled: true, settings: { opacity: 0.16, scale: 1.5, tone: 0, shadowBias: 0.62 } },
    ],
  },
  activeLayerId: null as string | null,
  layers: [] as Array<{
    id: string;
    layerType: string;
    colorCycleData?: {
      softEdgeMaskImageData?: ImageData;
      softEdgeMaskEnabled?: boolean;
    };
  }>,
  setDisplayFilterEnabled: jest.fn(),
  updateDisplayFilter: jest.fn(),
  applyColorCycleSoftEdgeMask: jest.fn(),
  setColorCycleSoftEdgeMaskEnabled: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => ({
  __esModule: true,
  useAppStore: (selector: (state: typeof mockStore) => unknown) => selector(mockStore),
}));

describe('DisplayFiltersSection', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.activeLayerId = null;
    mockStore.layers = [];
    mockStore.applyColorCycleSoftEdgeMask.mockResolvedValue(true);
  });

  it('renders the filter controls stack', () => {
    render(<DisplayFiltersSection />);

    expect(screen.getByText('Pixelate')).toBeInTheDocument();
    expect(screen.getByText('Round Pixels')).toBeInTheDocument();
    expect(screen.getByText('Bloom')).toBeInTheDocument();
    expect(screen.getByText('Color Grade')).toBeInTheDocument();
    expect(screen.getByText('LCD Mask')).toBeInTheDocument();
    expect(screen.getByText('CRT')).toBeInTheDocument();
    expect(screen.getByText('NTSE CRT')).toBeInTheDocument();
    expect(screen.getByText('CRT Grid')).toBeInTheDocument();
    expect(screen.getByText('Chromatic Aberration')).toBeInTheDocument();
    expect(screen.getByText('Noise')).toBeInTheDocument();
    expect(screen.getByText('Film Noise')).toBeInTheDocument();
    expect(screen.getByLabelText('Film noise amount')).toBeInTheDocument();
    expect(screen.getByLabelText('Film noise grain tone')).toBeInTheDocument();
    expect(screen.queryByLabelText('Film noise opacity')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Film noise shadow bias')).not.toBeInTheDocument();
  });

  it('places Noise and Film Noise at the top of the filter list', () => {
    render(<DisplayFiltersSection />);

    const filterTitles = screen.getAllByRole('heading', { level: 4 })
      .map((heading) => heading.textContent);

    expect(filterTitles.slice(0, 3)).toEqual(['Noise', 'Film Noise', 'Pixelate']);
  });

  it('routes toggle changes through the store', () => {
    render(<DisplayFiltersSection />);

    fireEvent.click(screen.getByLabelText('Pixelate enabled'));

    expect(mockStore.setDisplayFilterEnabled).toHaveBeenCalledWith('pixelate', true);
  });

  it('expands and collapses settings from the header without toggling the filter', () => {
    render(<DisplayFiltersSection />);

    const pixelateHeader = screen.getByRole('button', { name: 'Pixelate settings' });
    const roundPixelsHeader = screen.getByRole('button', { name: 'Round Pixels settings' });

    expect(pixelateHeader).toHaveAttribute('aria-expanded', 'false');
    expect(roundPixelsHeader).toHaveAttribute('aria-expanded', 'true');

    fireEvent.click(pixelateHeader);
    expect(pixelateHeader).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Pixelate cell size')).toBeInTheDocument();

    fireEvent.click(roundPixelsHeader);
    expect(roundPixelsHeader).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Round pixels threshold')).not.toBeInTheDocument();

    expect(mockStore.setDisplayFilterEnabled).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Pixelate enabled')).not.toBeChecked();
    expect(screen.getByLabelText('Round Pixels enabled')).toBeChecked();
  });

  it('expands and collapses CC Edge Mask settings from its header', () => {
    mockStore.activeLayerId = 'cc-layer';
    mockStore.layers = [{
      id: 'cc-layer',
      layerType: 'color-cycle',
      colorCycleData: {
        softEdgeMaskImageData: new ImageData(1, 1),
        softEdgeMaskEnabled: true,
      },
    }];
    render(<DisplayFiltersSection />);

    const header = screen.getByRole('button', { name: 'CC Edge Mask settings' });

    expect(header).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByLabelText('Color cycle dither edge mask width')).toBeInTheDocument();

    fireEvent.click(header);

    expect(header).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByLabelText('Color cycle dither edge mask width')).not.toBeInTheDocument();
    expect(screen.getByLabelText('CC soft edge enabled')).toBeChecked();
    expect(mockStore.setColorCycleSoftEdgeMaskEnabled).not.toHaveBeenCalled();
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
    fireEvent.change(screen.getByLabelText('CRT distortion'), { target: { value: '0.22' } });
    fireEvent.change(screen.getByLabelText('CRT bloom radius'), { target: { value: '18' } });
    fireEvent.change(screen.getByLabelText('NTSE CRT signal smear'), { target: { value: '0.91' } });
    fireEvent.change(screen.getByLabelText('NTSE CRT scanline size'), { target: { value: '1.75' } });
    fireEvent.change(screen.getByLabelText('CRT grid line spacing'), { target: { value: '6' } });
    fireEvent.change(screen.getByLabelText('CRT grid phosphor glow'), { target: { value: '0.24' } });
    fireEvent.change(screen.getByLabelText('Chromatic aberration offset'), { target: { value: '1.5' } });
    fireEvent.change(screen.getByLabelText('Noise scale'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('Film noise amount'), { target: { value: '0.35' } });
    const filmNoiseTone = screen.getByLabelText('Film noise grain tone');
    expect(filmNoiseTone).toHaveAttribute('min', '-1');
    expect(filmNoiseTone).toHaveAttribute('max', '1');
    expect(filmNoiseTone).toHaveAttribute('step', '0.01');
    fireEvent.change(filmNoiseTone, { target: { value: '0.75' } });
    const filmNoiseGrainSize = screen.getByLabelText('Film noise grain size');
    expect(filmNoiseGrainSize).toHaveAttribute('min', '1');
    expect(filmNoiseGrainSize).toHaveAttribute('max', '2.65');
    expect(filmNoiseGrainSize).toHaveAttribute('step', '0.05');
    fireEvent.change(filmNoiseGrainSize, { target: { value: '1.05' } });

    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { blurRadius: 3.25 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { threshold: 0.62 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { crush: 0.58 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('round-pixels', { preserveColor: 0.91 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('bloom', { blurRadius: 4.5 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('crt', { barrelDistortion: 0.22 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('crt', { bloomRadius: 18 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('ntse-crt', { signalSmear: 0.91 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('ntse-crt', { scanlineSize: 1.75 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('crt-grid', { lineSpacing: 6 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('crt-grid', { phosphorOpacity: 0.24 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('chromatic-aberration', { offset: 1.5 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('noise', { scale: 3 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('film-noise', { opacity: 0.35 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('film-noise', { tone: 0.75 });
    expect(mockStore.updateDisplayFilter).toHaveBeenCalledWith('film-noise', { scale: 1.05 });

    const persistedFilmNoise = sanitizeDisplayFilters([{
      id: 'film-noise',
      enabled: true,
      settings: { opacity: 0.16, scale: 1.05, shadowBias: 0.62 },
    } as Extract<DisplayFilterConfig, { id: 'film-noise' }>])
      .find((filter) => filter.id === 'film-noise');
    expect(persistedFilmNoise?.settings.scale).toBe(1.05);
    expect(persistedFilmNoise?.settings.tone).toBe(0);

    const clampedFilmNoise = sanitizeDisplayFilters([{
      id: 'film-noise',
      enabled: true,
      settings: { opacity: 0.16, scale: 8, tone: 4, shadowBias: 0.62 },
    } as Extract<DisplayFilterConfig, { id: 'film-noise' }>])
      .find((filter) => filter.id === 'film-noise');
    expect(clampedFilmNoise?.settings.scale).toBe(2.65);
    expect(clampedFilmNoise?.settings.tone).toBe(1);
  });

  it('rebakes an existing CC soft-edge mask when edge width is committed', async () => {
    mockStore.activeLayerId = 'cc-layer';
    mockStore.layers = [{
      id: 'cc-layer',
      layerType: 'color-cycle',
      colorCycleData: {
        softEdgeMaskImageData: new ImageData(1, 1),
        softEdgeMaskEnabled: true,
      },
    }];
    render(<DisplayFiltersSection />);

    const slider = screen.getByLabelText('Color cycle dither edge mask width');
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '32' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(mockStore.applyColorCycleSoftEdgeMask).toHaveBeenCalledWith('cc-layer', 32, 1, 'sierra-lite');
    });
  });

  it('rebakes an existing CC soft-edge mask when dither size is committed', async () => {
    mockStore.activeLayerId = 'cc-layer';
    mockStore.layers = [{
      id: 'cc-layer',
      layerType: 'color-cycle',
      colorCycleData: {
        softEdgeMaskImageData: new ImageData(1, 1),
        softEdgeMaskEnabled: true,
      },
    }];
    render(<DisplayFiltersSection />);

    const slider = screen.getByLabelText('Color cycle soft edge dither size');
    fireEvent.pointerDown(slider);
    fireEvent.change(slider, { target: { value: '6' } });
    fireEvent.pointerUp(slider);

    await waitFor(() => {
      expect(mockStore.applyColorCycleSoftEdgeMask).toHaveBeenCalledWith('cc-layer', 16, 6, 'sierra-lite');
    });
  });
});
