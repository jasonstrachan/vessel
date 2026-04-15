import { MIN_CANVAS_ZOOM, MAX_CANVAS_ZOOM } from '@/constants/canvas';
import { readLocalSettings } from '@/utils/localSettings';
import { useAppStore } from '@/stores/useAppStore';
import { getStoredDisplayFilterDefaults } from '@/stores/slices/canvasSlice';

describe('canvas slice invariants', () => {
  const reset = () => {
    localStorage.removeItem('vessel-settings');
    useAppStore.setState({
      canvas: {
        ...useAppStore.getState().canvas,
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        showRulers: false,
        showFPSMeter: true,
        transparencyBackgroundMode: 'checker',
      },
      canvasViewport: { left: 0, top: 0, width: 0, height: 0 },
    });
  };

  afterEach(() => {
    reset();
  });

  it('clamps zoom between MIN and MAX', () => {
    useAppStore.getState().setZoom(0.01);
    expect(useAppStore.getState().canvas.zoom).toBe(MIN_CANVAS_ZOOM);

    useAppStore.getState().setZoom(100);
    expect(useAppStore.getState().canvas.zoom).toBe(MAX_CANVAS_ZOOM);
  });

  it('avoids needless updates when offset is unchanged', () => {
    const before = useAppStore.getState().canvas;
    useAppStore.getState().setCanvasOffset(0, 0);
    expect(useAppStore.getState().canvas).toBe(before);

    useAppStore.getState().setCanvasOffset(10, -5);
    expect(useAppStore.getState().canvas).not.toBe(before);
    expect(useAppStore.getState().canvas.offsetX).toBe(10);
    expect(useAppStore.getState().canvas.offsetY).toBe(-5);
  });

  it('skips viewport updates when values match', () => {
    const before = useAppStore.getState().canvasViewport;
    useAppStore.getState().setCanvasViewport({ left: 0, top: 0, width: 0, height: 0 });
    expect(useAppStore.getState().canvasViewport).toBe(before);

    useAppStore.getState().setCanvasViewport({ left: 1, top: 2, width: 3, height: 4 });
    expect(useAppStore.getState().canvasViewport).not.toBe(before);
    expect(useAppStore.getState().canvasViewport).toEqual({ left: 1, top: 2, width: 3, height: 4 });
  });

  it('toggles rulers visibility', () => {
    expect(useAppStore.getState().canvas.showRulers).toBe(false);
    useAppStore.getState().toggleRulers();
    expect(useAppStore.getState().canvas.showRulers).toBe(true);
  });

  it('keeps fps meter setter idempotent when unchanged', () => {
    const before = useAppStore.getState().canvas;
    useAppStore.getState().setShowFPSMeter(true);
    expect(useAppStore.getState().canvas).toBe(before);

    useAppStore.getState().setShowFPSMeter(false);
    expect(useAppStore.getState().canvas.showFPSMeter).toBe(false);
  });

  it('keeps transparency background mode setter idempotent when unchanged', () => {
    const before = useAppStore.getState().canvas;
    useAppStore.getState().setTransparencyBackgroundMode('checker');
    expect(useAppStore.getState().canvas).toBe(before);

    useAppStore.getState().setTransparencyBackgroundMode('gray');
    expect(useAppStore.getState().canvas.transparencyBackgroundMode).toBe('gray');
  });

  it('toggles display filters and sanitizes updates', () => {
    useAppStore.getState().setDisplayFilterEnabled('pixelate', true);
    expect(
      useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'pixelate')?.enabled
    ).toBe(true);

    useAppStore.getState().updateDisplayFilter('round-pixels', { blurRadius: 99, threshold: -1, crush: 4, preserveColor: 9 });
    const roundPixels = useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'round-pixels');
    expect(roundPixels?.settings).toEqual({ blurRadius: 12, threshold: 0, crush: 1, preserveColor: 1 });

    useAppStore.getState().updateDisplayFilter('bloom', { blurRadius: 99, intensity: 4 });
    const bloom = useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'bloom');
    expect(bloom?.settings).toEqual({ blurRadius: 12, intensity: 2 });

    useAppStore.getState().updateDisplayFilter('crt', {
      cellSize: 99,
      scanlineIntensity: -1,
      maskIntensity: 3,
      barrelDistortion: 9,
      chromaticAberration: 99,
      beamFocus: 4,
      brightness: 9,
      shadowLift: -2,
      vignetteIntensity: 8,
      flickerIntensity: 7,
      signalArtifacts: -1,
      bloomIntensity: 8,
      bloomRadius: 99,
    });
    const crt = useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'crt');
    expect(crt?.settings).toEqual({
      cellSize: 32,
      scanlineIntensity: 0,
      maskIntensity: 1,
      barrelDistortion: 0.4,
      chromaticAberration: 8,
      beamFocus: 1,
      brightness: 1.5,
      shadowLift: 0,
      vignetteIntensity: 1,
      flickerIntensity: 1,
      signalArtifacts: 0,
      bloomIntensity: 4,
      bloomRadius: 32,
    });

    useAppStore.getState().updateDisplayFilter('crt-grid', {
      lineOpacity: 9,
      lineSpacing: 1,
      phosphorOpacity: 3,
      scanlineOpacity: -2,
    });
    const crtGrid = useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'crt-grid');
    expect(crtGrid?.settings).toEqual({
      lineOpacity: 1,
      lineSpacing: 1,
      phosphorOpacity: 1,
      scanlineOpacity: 0,
    });

    useAppStore.getState().updateDisplayFilter('chromatic-aberration', { offset: 9, intensity: -2 });
    const chromaticAberration = useAppStore
      .getState()
      .canvas
      .displayFilters
      .find((filter) => filter.id === 'chromatic-aberration');
    expect(chromaticAberration?.settings).toEqual({ offset: 9, intensity: 0 });

    useAppStore.getState().updateDisplayFilter('chromatic-aberration', { offset: 40 });
    expect(
      useAppStore.getState().canvas.displayFilters.find((filter) => filter.id === 'chromatic-aberration')?.settings
    ).toEqual({ offset: 12, intensity: 0 });

    const persistedDefaults = readLocalSettings().canvas?.displayFilterDefaults;
    expect(persistedDefaults?.every((filter) => filter.enabled === false)).toBe(true);
    expect(persistedDefaults?.find((filter) => filter.id === 'crt')?.settings).toEqual({
      cellSize: 32,
      scanlineIntensity: 0,
      maskIntensity: 1,
      barrelDistortion: 0.4,
      chromaticAberration: 8,
      beamFocus: 1,
      brightness: 1.5,
      shadowLift: 0,
      vignetteIntensity: 1,
      flickerIntensity: 1,
      signalArtifacts: 0,
      bloomIntensity: 4,
      bloomRadius: 32,
    });
    expect(persistedDefaults?.find((filter) => filter.id === 'crt-grid')?.settings).toEqual({
      lineOpacity: 1,
      lineSpacing: 1,
      phosphorOpacity: 1,
      scanlineOpacity: 0,
    });
    expect(persistedDefaults?.find((filter) => filter.id === 'round-pixels')?.settings).toEqual({
      blurRadius: 12,
      threshold: 0,
      crush: 1,
      preserveColor: 1,
    });
    expect(persistedDefaults?.find((filter) => filter.id === 'chromatic-aberration')?.settings).toEqual({
      offset: 12,
      intensity: 0,
    });
  });

  it('restores locally remembered filter settings with every filter disabled', () => {
    localStorage.setItem('vessel-settings', JSON.stringify({
      canvas: {
        displayFilterDefaults: [
          { id: 'pixelate', enabled: true, settings: { cellSize: 7 } },
          { id: 'round-pixels', enabled: true, settings: { blurRadius: 2.5, threshold: 0.42, crush: 0.61, preserveColor: 0.73 } },
          { id: 'bloom', enabled: true, settings: { blurRadius: 4, intensity: 0.33 } },
          { id: 'crt', enabled: true, settings: { cellSize: 14, barrelDistortion: 0.2 } },
        ],
      },
    }));

    expect(getStoredDisplayFilterDefaults().find((filter) => filter.id === 'pixelate')).toEqual({
      id: 'pixelate',
      enabled: false,
      settings: { cellSize: 7 },
    });
    expect(getStoredDisplayFilterDefaults().find((filter) => filter.id === 'bloom')).toEqual({
      id: 'bloom',
      enabled: false,
      settings: { blurRadius: 4, intensity: 0.33 },
    });
    expect(getStoredDisplayFilterDefaults().find((filter) => filter.id === 'crt')).toEqual({
      id: 'crt',
      enabled: false,
      settings: {
        cellSize: 14,
        scanlineIntensity: 0.08,
        maskIntensity: 0.07,
        barrelDistortion: 0.2,
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
    });
    expect(getStoredDisplayFilterDefaults().find((filter) => filter.id === 'round-pixels')).toEqual({
      id: 'round-pixels',
      enabled: false,
      settings: { blurRadius: 2.5, threshold: 0.42, crush: 0.61, preserveColor: 0.73 },
    });
  });
});
