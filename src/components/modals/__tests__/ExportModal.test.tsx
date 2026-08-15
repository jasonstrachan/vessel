/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

import { registerGobletPublisher } from '@/utils/export/goblet/gobletPublisherRegistry';

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

jest.mock('@/utils/export/goblet/gobletPublisherManifest', () => ({
  hydrateHostGobletPublishers: jest.fn(async () => []),
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
  colorCyclePlayback: {
    desiredPlaying: false,
    suspendDepth: 0,
    playbackSpeedScale: 1,
  },
  sequentialRecord: {
    currentFrame: 0,
  },
  compositeLayersToCanvas: jest.fn(),
  setActiveLayer: jest.fn(),
  addNotification: jest.fn(),
  setSequentialFrame: jest.fn(),
  updateLayer: jest.fn(),
  tools: {
    brushSettings: {
      colorCycleFPS: 30,
      colorCycleLayerSpeedScale: 1,
      colorCycleSpeed: 0.1,
    },
  },
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

const makeWebglResult = (layers: any[], sizeReport: any) => {
  const metadata = {
    layers,
    viewport: { designWidth: 10, designHeight: 10 },
    animation: { totalFrames: 1, fps: 60 },
  };
  return {
    kind: 'webgl' as const,
    filename: 'Demo-goblet.zip',
    metadata,
    artifact: {
      blob: new Blob(['zip'], { type: 'application/zip' }),
      filename: 'Demo-goblet.zip',
      metadata,
      sizeReport,
    },
  };
};

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

  it('cancels a pending close timer when reopened immediately', () => {
    const { rerender } = render(<ExportModal isOpen={false} onClose={jest.fn()} />);

    rerender(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByText('Packaging')).toBeInTheDocument();
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

  it('captures the live global playback rate when exporting Goblet JSON', async () => {
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'json',
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    // Reproduce a control update after the modal rendered but before Export.
    // The export boundary must read the authoritative value, not the old render.
    (store as any).colorCyclePlayback.playbackSpeedScale = 1.3;

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });

    const request = runExportMock.mock.calls[0]?.[0];
    expect(request.kind).toBe('webgl');
    expect(request.options.request.bundleFormat).toBe('json');
    expect(request.options.request.colorCyclePlaybackSpeedScale).toBe(1.3);
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

  it('shows an exact Single HTML size breakdown and clears it before the next export', async () => {
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'single-html',
    };
    const sizeReport = {
      format: 'single-html' as const,
      totalBytes: 1000,
      metadataBytes: 500,
      runtimeBytes: 300,
      htmlBytes: 200,
      ccBufferBytes: 80,
      maskBytes: 10,
      textureBytes: 40,
      sequentialFrameBytes: 20,
      previewBytes: 10,
      fallbackBytes: 0,
      binarySidecarBytes: 0,
      binarySidecarCount: 0,
      duplicatedMetadataBytes: 0,
      singleHtmlBreakdown: {
        runtimeBytes: 300,
        ccBufferBytes: 200,
        maskBytes: 50,
        textureBytes: 150,
        sequentialFrameBytes: 100,
        previewBytes: 50,
        fallbackBytes: 0,
        otherBytes: 150,
      },
    };
    runExportMock.mockImplementation(async (request) => {
      request.options.request.onSizeReport?.(sizeReport);
      return makeWebglResult(store.layers, sizeReport);
    });

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    expect(await screen.findByTestId('single-html-size-breakdown')).toBeInTheDocument();
    expect(screen.getByText('1,000 B')).toBeInTheDocument();
    expect(screen.getByText('CC buffers')).toBeInTheDocument();
    expect(screen.queryByText('Fallback')).not.toBeInTheDocument();
    const sizeRows = screen.getAllByTestId(/^single-html-size-.*Bytes$/);
    const exactByteTotal = sizeRows.reduce(
      (sum, row) => sum + Number(row.getAttribute('data-bytes')),
      0,
    );
    const percentageTotal = sizeRows.reduce(
      (sum, row) => sum + Number(row.getAttribute('data-percentage')),
      0,
    );
    expect(exactByteTotal).toBe(1000);
    expect(percentageTotal).toBeCloseTo(100, 8);

    const closeButtons = screen.getAllByRole('button', { name: 'Close' });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    runExportMock.mockRejectedValueOnce(new Error('Second export failed'));
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });
    await waitFor(() => {
      expect(screen.getAllByText('Export failed').length).toBeGreaterThan(0);
    });
    expect(screen.queryByTestId('single-html-size-breakdown')).not.toBeInTheDocument();
  });

  it('does not show a Single HTML report for ZIP exports', async () => {
    const sizeReport = {
      format: 'single-html' as const,
      totalBytes: 100,
      metadataBytes: 40,
      runtimeBytes: 20,
      htmlBytes: 40,
      ccBufferBytes: 0,
      maskBytes: 0,
      textureBytes: 0,
      sequentialFrameBytes: 0,
      previewBytes: 0,
      fallbackBytes: 0,
      binarySidecarBytes: 0,
      binarySidecarCount: 0,
      duplicatedMetadataBytes: 0,
      singleHtmlBreakdown: {
        runtimeBytes: 20,
        ccBufferBytes: 0,
        maskBytes: 0,
        textureBytes: 0,
        sequentialFrameBytes: 0,
        previewBytes: 0,
        fallbackBytes: 0,
        otherBytes: 80,
      },
    };
    runExportMock.mockImplementation(async (request) => {
      request.options.request.onSizeReport?.(sizeReport);
      return makeWebglResult(store.layers, {
        ...sizeReport,
        format: 'zip',
        singleHtmlBreakdown: undefined,
      });
    });

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    await waitFor(() => {
      expect(runExportMock).toHaveBeenCalled();
    });
    expect(screen.queryByTestId('single-html-size-breakdown')).not.toBeInTheDocument();
  });

  it('hides publishing when the host has no publisher manifest', async () => {
    const sizeReport = {
      format: 'single-html' as const,
      totalBytes: 4,
      metadataBytes: 0,
      runtimeBytes: 0,
      htmlBytes: 4,
      ccBufferBytes: 0,
      maskBytes: 0,
      textureBytes: 0,
      sequentialFrameBytes: 0,
      previewBytes: 0,
      fallbackBytes: 0,
      binarySidecarBytes: 0,
      binarySidecarCount: 0,
      duplicatedMetadataBytes: 0,
    };
    runExportMock.mockResolvedValue(makeWebglResult(store.layers, sizeReport));

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    expect(await screen.findByRole('button', { name: 'Download' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Publish/ })).not.toBeInTheDocument();
  });

  it('keeps release actions visible and locked while publishing', async () => {
    let resolvePublish: ((value: { message: string }) => void) | undefined;
    const publish = jest.fn(() => new Promise<{ message: string }>((resolve) => {
      resolvePublish = resolve;
    }));
    const unregister = registerGobletPublisher({
      id: 'test-archive',
      label: 'Test archive',
      publish,
    });
    const sizeReport = {
      format: 'single-html' as const,
      totalBytes: 4,
      metadataBytes: 0,
      runtimeBytes: 0,
      htmlBytes: 4,
      ccBufferBytes: 0,
      maskBytes: 0,
      textureBytes: 0,
      sequentialFrameBytes: 0,
      previewBytes: 0,
      fallbackBytes: 0,
      binarySidecarBytes: 0,
      binarySidecarCount: 0,
      duplicatedMetadataBytes: 0,
    };
    runExportMock.mockResolvedValue(makeWebglResult(store.layers, sizeReport));

    try {
      render(<ExportModal isOpen onClose={jest.fn()} />);
      act(() => {
        jest.runAllTimers();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Publish to Test archive' }));

      const progressModal = within(screen.getByTestId('export-progress-backdrop'));
      expect(await progressModal.findByRole('button', { name: 'Publishing...' })).toBeDisabled();
      expect(progressModal.getByRole('button', { name: 'Download' })).toBeDisabled();
      expect(progressModal.getByRole('button', { name: 'Close' })).toBeDisabled();
      expect(progressModal.queryByRole('button', { name: 'Cancel' })).not.toBeInTheDocument();

      await act(async () => {
        resolvePublish?.({ message: 'Stored' });
        resolvePublish = undefined;
        await Promise.resolve();
      });
      await waitFor(() => {
        expect(screen.getByRole('button', { name: 'Publish to Test archive' })).toBeEnabled();
      });
    } finally {
      await act(async () => {
        resolvePublish?.({ message: 'Stored' });
        resolvePublish = undefined;
        unregister();
        await Promise.resolve();
      });
    }
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
