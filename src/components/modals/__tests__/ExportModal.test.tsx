/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { ExportModal } from '../ExportModal';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

jest.mock('@/lib/colorCycle/RecolorManager', () => ({
  RecolorManager: {
    getInstance: () => ({
      setPhase: jest.fn(),
      updateAnimation: jest.fn(),
      setFPS: jest.fn(),
      dispose: jest.fn(),
    }),
  },
}));

jest.mock('@/components/panels/AlignmentPanel', () => ({
  LayerAlignmentControls: () => <div data-testid="alignment-controls" />,
}));

jest.mock('@/components/MinimalLayerList', () => ({
  LayerColorSwatches: () => <div data-testid="layer-swatches" />,
  LAYER_TAG_CLASS: 'layer-tag',
}));

jest.mock('@/utils/export/webglExporter', () => ({
  exportProjectAsWebGL: jest.fn(),
}));

const runExportMock = jest.fn();
const estimateExportMock = jest.fn();

jest.mock('@/utils/export/exportService', () => ({
  runExport: (...args: unknown[]) => runExportMock(...args),
  estimateExport: (...args: unknown[]) => estimateExportMock(...args),
}));

const makeStore = () => ({
  project: {
    id: 'p1',
    name: 'Demo',
    width: 10,
    height: 10,
    backgroundColor: '#000000',
    layers: [],
    customBrushes: [],
    createdAt: new Date(),
    updatedAt: new Date(),
  },
  layers: [{
    id: 'l1',
    name: 'Layer 1',
    visible: true,
    opacity: 1,
    blendMode: 'normal',
    locked: false,
    order: 0,
    alignment: {
      fit: 'contain',
      horizontal: 'center',
      vertical: 'center',
      offsetPx: { x: 0, y: 0 },
      positioning: 'auto',
    },
    layerType: 'normal' as const,
    sequentialData: undefined,
  }],
  activeLayerId: 'l1',
  canvas: {
    transparencyBackgroundMode: 'checker' as const,
    displayFilters: [],
  },
  sequentialRecord: {
    currentFrame: 0,
  },
  compositeLayersToCanvas: jest.fn(),
  setActiveLayer: jest.fn(),
  addNotification: jest.fn(),
  setSequentialFrame: jest.fn(),
  getLayerColorCycleBrush: jest.fn(() => null),
  updateLayer: jest.fn(),
  tools: { brushSettings: { colorCycleFPS: 30 } },
  webglExportSettings: {
    includeHiddenLayers: false,
    embedCanvasFallback: false,
    minifyOutput: false,
    bundleFormat: 'zip' as const,
    gobletVersion: 'goblet2' as const,
    enableGobletDiagnostics: false,
    htmlTitle: 'Goblet',
    htmlBackgroundColor: '#000000',
    transparencyBackgroundMode: 'checker' as const,
    viewportPreset: 'default' as const,
    designScalePercent: 100,
  },
  updateWebglExportSettings: jest.fn(),
});

let store = makeStore();

jest.mock('@/stores/useAppStore', () => {
  const useAppStore = (selector: any) => selector(store);
  useAppStore.getState = () => store;
  return { useAppStore };
});

describe('ExportModal', () => {
  beforeEach(() => {
    store = makeStore();
    runExportMock.mockReset();
    estimateExportMock.mockReset();
    runExportMock.mockResolvedValue({
      kind: 'png',
      filename: 'Demo@1x.png',
      blob: new Blob(['png'], { type: 'image/png' }),
    });
    estimateExportMock.mockResolvedValue({
      paletteSize: null,
      estimatedBytes: null,
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('renders when open and closes on overlay click', () => {
    const onClose = jest.fn();
    const { container } = render(<ExportModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getAllByText('Export')[0]).toBeInTheDocument();

    fireEvent.click(container.firstElementChild as HTMLElement);
    expect(onClose).toHaveBeenCalled();
  });

  it('switches export type to GIF and shows scale controls', () => {
    const { getByText, queryByText } = render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(queryByText('Scale')).not.toBeInTheDocument();
    fireEvent.click(getByText('GIF'));
    expect(getByText('Scale')).toBeInTheDocument();
  });

  it('passes fractional GIF scale options through export requests', async () => {
    runExportMock.mockResolvedValue({
      kind: 'gif',
      filename: 'Demo@0.5x.gif',
      blob: new Blob(['gif'], { type: 'image/gif' }),
      paletteSize: 16,
    });

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('GIF'));
    expect(screen.getByRole('button', { name: '50%' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '20%' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '50%' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });

    const request = runExportMock.mock.calls[0]?.[0];
    expect(request.kind).toBe('gif');
    expect(request.scale).toBe(0.5);
  });

  it('resets hidden fractional scale when switching from GIF to PNG', async () => {
    runExportMock.mockResolvedValue({
      kind: 'png',
      filename: 'Demo@1x.png',
      blob: new Blob(['png'], { type: 'image/png' }),
    });

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('GIF'));
    fireEvent.click(screen.getByRole('button', { name: '50%' }));
    fireEvent.click(screen.getByText('PNG'));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });

    const request = runExportMock.mock.calls[0]?.[0];
    expect(request.kind).toBe('png');
    expect(request.scale).toBe(1);
  });

  it('applies GIF FPS preset buttons to the export request', async () => {
    runExportMock.mockResolvedValue({
      kind: 'gif',
      filename: 'Demo@1x.gif',
      blob: new Blob(['gif'], { type: 'image/gif' }),
      paletteSize: 16,
    });

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByText('GIF'));
    fireEvent.click(screen.getByRole('button', { name: '24' }));

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });

    const request = runExportMock.mock.calls[0]?.[0];
    expect(request.kind).toBe('gif');
    expect(request.options.fps).toBe(24);
  });

  it('drives sequential frame index during animation sessions and restores on finish', async () => {
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-1',
      layerType: 'sequential',
      sequentialData: {
        frameCount: 12,
        fps: 12,
        durationMs: 1000,
        events: [],
      },
    }] as any;
    (store as any).activeLayerId = 'seq-1';
    (store as any).sequentialRecord.currentFrame = 2;

    render(<ExportModal isOpen onClose={jest.fn()} />);
    fireEvent.click(screen.getByText('GIF'));

    await act(async () => {
      jest.runOnlyPendingTimers();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });

    const request = runExportMock.mock.calls[0]?.[0];
    const frameProvider = request?.frameProvider;
    expect(frameProvider).toBeDefined();

    const session = frameProvider.beginAnimationSession({
      fps: 12,
      totalFrames: 24,
      kind: 'estimate',
      useAbsolutePhase: true,
    });
    session.stepFrame({ frameIndex: 7, totalFrames: 24, useAbsolutePhase: true });
    expect(store.setSequentialFrame).toHaveBeenCalledWith(7);

    session.finish?.();
    expect(store.setSequentialFrame).toHaveBeenLastCalledWith(2);
  });

  it('keeps packaging controls available for sequential exports', () => {
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-heavy',
      layerType: 'sequential',
      sequentialData: {
        frameCount: 320,
        fps: 18,
        durationMs: Math.round((320 * 1000) / 18),
        events: [],
      },
    }] as any;

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByText('Packaging')).toBeInTheDocument();
    expect(screen.getByText('Goblet runtime')).toBeInTheDocument();
  });

  it('updates bundle format from packaging select', () => {
    (store as any).project = {
      ...store.project,
      width: 1024,
      height: 1024,
    };
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-heavy-opt-click',
      layerType: 'sequential',
      sequentialData: {
        frameCount: 320,
        fps: 18,
        durationMs: Math.round((320 * 1000) / 18),
        events: [],
      },
    }] as any;
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'single-html',
      minifyOutput: false,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    const packagingSelect = screen.getAllByRole('combobox')[0];
    fireEvent.change(packagingSelect, { target: { value: 'zip' } });

    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      bundleFormat: 'zip',
    });
  });

  it('maps embed fill preset to fixed viewport mode with embed presentation metadata', async () => {
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      viewportPreset: 'embed-fill',
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /Embed fill/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      viewportPreset: 'embed-fill',
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });

    const request = runExportMock.mock.calls[0]?.[0];
    expect(request.options.request.viewport.mode).toBe('fixed');
    expect(request.options.request.viewportPreset).toBe('embed-fill');
    expect(request.options.request.pixelPerfectStack).toBe(false);
  });

  it('maps embed fit preset to fixed viewport mode with embed presentation metadata', async () => {
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      viewportPreset: 'embed-fit',
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /Embed fit/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      viewportPreset: 'embed-fit',
    });
    fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });

    const request = runExportMock.mock.calls[0]?.[0];
    expect(request.options.request.viewport.mode).toBe('fixed');
    expect(request.options.request.viewportPreset).toBe('embed-fit');
    expect(request.options.request.pixelPerfectStack).toBe(false);
  });

  it('updates minify setting from checkbox', () => {
    (store as any).project = {
      ...store.project,
      width: 1024,
      height: 1024,
    };
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-heavy-revert',
      layerType: 'sequential',
      sequentialData: {
        frameCount: 320,
        fps: 18,
        durationMs: Math.round((320 * 1000) / 18),
        events: [],
      },
    }] as any;
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'single-html',
      minifyOutput: false,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByLabelText(/Minify bundle output/i));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      minifyOutput: true,
    });
  });

  it('does not render optimize/revert shortcut actions', () => {
    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.queryByRole('button', { name: /Optimize now/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Revert optimization/i })).not.toBeInTheDocument();
  });

  it('shows a warning when MP4 request falls back to WebM output', async () => {
    const onClose = jest.fn();
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    try {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: jest.fn(() => 'blob:video'),
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: jest.fn(),
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: jest.fn(),
      });

      runExportMock.mockResolvedValue({
        kind: 'video',
        filename: 'Demo@1x.webm',
        blob: new Blob(['video'], { type: 'video/webm' }),
        mimeType: 'video/webm;codecs=vp8',
      });

      render(<ExportModal isOpen onClose={onClose} />);
      act(() => {
        jest.runAllTimers();
      });

      fireEvent.click(screen.getByText('Video'));
      const formatSelect = screen.getByDisplayValue('WebM');
      fireEvent.change(formatSelect, { target: { value: 'video/mp4' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
      });

      await waitFor(() => {
        expect(runExportMock).toHaveBeenCalled();
      });

      expect(store.addNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'warning',
        title: 'Exported as WebM',
      }));
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: originalAnchorClick,
      });
    }
  });

  it('uses loop-matched video duration when perfect loop is enabled', async () => {
    (store as any).layers = [{
      ...store.layers[0],
      id: 'cc-video',
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'recolor',
        recolorSettings: {
          animation: { speed: 0.5 },
        },
      },
    }] as any;

    runExportMock.mockResolvedValue({
      kind: 'video',
      filename: 'Demo@1x.webm',
      blob: new Blob(['video'], { type: 'video/webm' }),
      mimeType: 'video/webm;codecs=vp8',
    });

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    try {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: jest.fn(() => 'blob:video'),
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: jest.fn(),
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: jest.fn(),
      });

      render(<ExportModal isOpen onClose={jest.fn()} />);
      act(() => {
        jest.runAllTimers();
      });

      fireEvent.click(screen.getByText('Video'));
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
      });

      await waitFor(() => {
        expect(runExportMock).toHaveBeenCalled();
      });

      const request = runExportMock.mock.calls[0]?.[0];
      expect(request.kind).toBe('video');
      expect(request.options.durationSeconds).toBeCloseTo(2, 4);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: originalAnchorClick,
      });
    }
  });

  it('maps the video compression slider to bitrate for export requests', async () => {
    runExportMock.mockResolvedValue({
      kind: 'video',
      filename: 'Demo@1x.webm',
      blob: new Blob(['video'], { type: 'video/webm' }),
      mimeType: 'video/webm;codecs=vp8',
    });

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    try {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: jest.fn(() => 'blob:video'),
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: jest.fn(),
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: jest.fn(),
      });

      render(<ExportModal isOpen onClose={jest.fn()} />);
      act(() => {
        jest.runAllTimers();
      });

      fireEvent.click(screen.getByText('Video'));
      fireEvent.change(screen.getByLabelText('Video compression'), { target: { value: '100' } });

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
      });

      await waitFor(() => {
        expect(runExportMock).toHaveBeenCalled();
      });

      const request = runExportMock.mock.calls[0]?.[0];
      expect(request.kind).toBe('video');
      expect(request.options.bitrateKbps).toBe(1000);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: originalAnchorClick,
      });
    }
  });

  it('passes fractional video scale options through export requests', async () => {
    runExportMock.mockResolvedValue({
      kind: 'video',
      filename: 'Demo@0.5x.webm',
      blob: new Blob(['video'], { type: 'video/webm' }),
      mimeType: 'video/webm;codecs=vp8',
    });

    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    try {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: jest.fn(() => 'blob:video'),
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: jest.fn(),
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: jest.fn(),
      });

      render(<ExportModal isOpen onClose={jest.fn()} />);
      act(() => {
        jest.runAllTimers();
      });

      fireEvent.click(screen.getByText('Video'));
      expect(screen.getByRole('button', { name: '50%' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: '20%' })).toBeInTheDocument();
      fireEvent.click(screen.getByRole('button', { name: '50%' }));

      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: 'Export' }));
      });

      await waitFor(() => {
        expect(runExportMock).toHaveBeenCalled();
      });

      const request = runExportMock.mock.calls[0]?.[0];
      expect(request.kind).toBe('video');
      expect(request.scale).toBe(0.5);
    } finally {
      Object.defineProperty(URL, 'createObjectURL', {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, 'revokeObjectURL', {
        configurable: true,
        value: originalRevokeObjectURL,
      });
      Object.defineProperty(HTMLAnchorElement.prototype, 'click', {
        configurable: true,
        value: originalAnchorClick,
      });
    }
  });
});
