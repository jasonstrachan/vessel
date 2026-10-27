/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, renderHook, screen, fireEvent, act, waitFor, within } from '@testing-library/react';

import { registerGobletPublisher } from '@/utils/export/goblet/gobletPublisherRegistry';
import { registerGobletTester } from '@/utils/export/goblet/gobletTesterRegistry';
import {
  getSequentialLayerRenderFrame,
  setSequentialFrameCursor,
} from '@/runtime/playback/sequentialFrameCursor';
import type { AppState } from '@/stores/useAppStore';

import { ExportModal } from '../ExportModal';
import { useExportFrameProvider } from '../export/useExportFrameProvider';

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
  compositeLayersToCanvasSync: jest.fn<boolean, [HTMLCanvasElement, { includeBackground?: boolean }]>(() => true),
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


  it('names Design scale contextually and associates its visible label without changing the settings callback', async () => {
    Object.assign(store.webglExportSettings, { viewportPreset: 'fixed', designScalePercent: 100 });
    const user = userEvent.setup({ advanceTimers: jest.advanceTimersByTime });
    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => { jest.runAllTimers(); });
    const input = screen.getByRole('spinbutton', { name: 'Design scale (%)' }) as HTMLInputElement;
    const label = input.labels?.[0];
    expect(label).toBeDefined();
    expect(label).toHaveTextContent('Design scale');
    expect(label?.control).toBe(input);
    await user.click(label!);
    expect(input).toHaveFocus();
    fireEvent.change(input, { target: { value: '200' } });
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({ designScalePercent: 200 });
    expect(runExportMock).not.toHaveBeenCalled();
  });

  it.each([false, true])('captures PNG synchronously with background option %s before consuming pixels', async (includeBackground) => {
    const target = document.createElement('canvas');
    const capture = jest.fn((canvas: HTMLCanvasElement, options: { includeBackground?: boolean }) => {
      expect(canvas).toBe(target);
      expect(options).toEqual({ includeBackground: false });
      canvas.width = 23;
      return true;
    });
    store.compositeLayersToCanvasSync = capture;
    runExportMock.mockImplementation(async (request) => {
      expect(request.options.includeBackground).toBe(includeBackground);
      request.frameProvider.compositeToCanvas(target);
      expect(target.width).toBe(23);
      return { kind: 'png', filename: 'Demo.png', blob: new Blob(['png'], { type: 'image/png' }) };
    });
    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => { jest.runAllTimers(); });
    fireEvent.click(screen.getByText('PNG'));
    const checkbox = screen.getByRole('checkbox', { name: 'Include background' });
    if ((checkbox as HTMLInputElement).checked !== includeBackground) fireEvent.click(checkbox);
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Export$/i })); });
    expect(capture).toHaveBeenCalledTimes(1);
    expect(store.compositeLayersToCanvas).not.toHaveBeenCalled();
  });

  it('reports synchronous compositor failure instead of consuming a blank frame', async () => {
    store.compositeLayersToCanvasSync.mockReturnValue(false);
    runExportMock.mockImplementation(async (request) => {
      request.frameProvider.compositeToCanvas(document.createElement('canvas'));
      throw new Error('Encoder must not run');
    });
    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => { jest.runAllTimers(); });
    fireEvent.click(screen.getByText('PNG'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Export$/i })); });
    expect(screen.getAllByText('Failed to composite export frame').length).toBeGreaterThan(0);
    expect(store.compositeLayersToCanvasSync).toHaveBeenCalledTimes(1);
  });

  it('retains project background for GIF frame capture', async () => {
    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => { jest.runAllTimers(); });
    fireEvent.click(screen.getByText('GIF'));
    await act(async () => { fireEvent.click(screen.getByRole('button', { name: /^Export$/i })); });
    const request = runExportMock.mock.calls[0][0];
    const target = document.createElement('canvas');
    request.frameProvider.compositeToCanvas(target);
    expect(store.compositeLayersToCanvasSync).toHaveBeenCalledWith(target, { includeBackground: true });
    expect(store.compositeLayersToCanvas).not.toHaveBeenCalled();
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

    expect(screen.getByRole('heading', { name: 'File' })).toBeInTheDocument();
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

  it('drives an isolated sequential export timeline and restores on finish', async () => {
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
    setSequentialFrameCursor({ nextFrame: 2, nextFrameCount: 12, nextFps: 12 });

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
    const sequenceLayer = store.layers[0] as Parameters<typeof getSequentialLayerRenderFrame>[1];
    expect(getSequentialLayerRenderFrame(store as unknown as AppState, sequenceLayer)).toBe(7);
    expect(store.setSequentialFrame).not.toHaveBeenCalled();

    session.finish?.();
    expect(getSequentialLayerRenderFrame(store as unknown as AppState, sequenceLayer)).toBe(2);
  });

  it('keeps file controls available for sequential exports without duplicating alignment editing', () => {
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

    expect(screen.getByRole('heading', { name: 'File' })).toBeInTheDocument();
    expect(screen.queryByTestId('alignment-controls')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    expect(screen.getByText('Goblet runtime')).toBeInTheDocument();
  });

  it('keeps hidden-layer inclusion off by default inside Advanced', () => {
    (store as any).layers = [
      store.layers[0],
      {
        ...store.layers[0],
        id: 'hidden-layer',
        name: 'Hidden layer',
        visible: false,
        order: 1,
      },
    ];

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.queryByLabelText('Include hidden layers')).not.toBeInTheDocument();
    expect(screen.getByText('1 visible · 1 hidden excluded')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    const includeHidden = screen.getByLabelText('Include hidden layers');
    expect(includeHidden).not.toBeChecked();

    fireEvent.click(includeHidden);
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      includeHiddenLayers: true,
    });
  });

  it('updates bundle format from the consolidated file selector', () => {
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

    fireEvent.click(screen.getByRole('button', { name: 'Smaller ZIP' }));

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

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.click(screen.getByLabelText(/Minify output/i));
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

  it('keeps the preview tab open and shows the renderer error when a test fails', async () => {
    const sizeReport = {
      format: 'json' as const,
      totalBytes: 4,
      metadataBytes: 4,
      runtimeBytes: 0,
      htmlBytes: 0,
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
    const unregister = registerGobletTester({
      id: 'failing-renderer',
      label: 'Failing renderer',
      test: jest.fn(async () => {
        throw new Error('Preview package could not be reconstructed');
      }),
    });
    const previewDocument = document.implementation.createHTMLDocument();
    const closePreview = jest.fn();
    const previewWindow = {
      closed: false,
      close: closePreview,
      document: previewDocument,
      location: { replace: jest.fn() },
      opener: window,
    } as unknown as Window;
    const openPreview = jest.spyOn(window, 'open').mockReturnValue(previewWindow);

    try {
      render(<ExportModal isOpen onClose={jest.fn()} />);
      act(() => {
        jest.runAllTimers();
      });
      await act(async () => {
        fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
      });

      fireEvent.click(await screen.findByRole('button', { name: 'Failing renderer' }));

      await waitFor(() => {
        expect(previewDocument.title).toBe('Test with Failing renderer failed');
      });
      expect(previewDocument.body.textContent).toContain('Preview package could not be reconstructed');
      expect(closePreview).not.toHaveBeenCalled();
      expect(openPreview).toHaveBeenCalledWith('about:blank', '_blank');
      expect(store.addNotification).toHaveBeenCalledWith(expect.objectContaining({
        type: 'error',
        title: 'Test with Failing renderer failed',
        message: 'Preview package could not be reconstructed',
      }));
    } finally {
      openPreview.mockRestore();
      act(() => unregister());
    }
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

      fireEvent.click(await screen.findByRole('button', { name: 'Test archive' }));

      const progressModal = within(screen.getByRole('dialog', { name: 'Goblet ready' }));
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
        expect(screen.getByRole('button', { name: 'Test archive' })).toBeEnabled();
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


describe('export frame canvas-shape presentation', () => {
  it.each(['png', 'gif', 'video'] as const)('masks %s frames after composition without changing source pixels or context state', kind => {
    store = makeStore();
    Object.assign(store.project, { width: 256, height: 256, canvasShape: { kind: 'rectangle', bounds: { x: 48, y: 64, width: 64, height: 64 } } });
    const pixels = new Uint8ClampedArray(256 * 256 * 4);
    for (let x = 28; x < 36; x += 1) pixels.set([255, 0, 0, 255], (96 * 256 + x) * 4);
    const sourceImage = new ImageData(pixels.slice(), 256, 256);
    Object.assign(store.layers[0], { imageData: sourceImage });
    const projectBefore = JSON.stringify(store.project), pixelsBefore = pixels.slice(), layerBefore = store.layers[0];
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 0.6; ctx.fillStyle = '#123456';
    const fillStyleBefore = ctx.fillStyle;
    // The shared canvas I/O mock has no save/restore state stack; model that native boundary here.
    const states: Array<{ composite: GlobalCompositeOperation; alpha: number; fill: string | CanvasGradient | CanvasPattern }> = [];
    const save = jest.spyOn(ctx, 'save').mockImplementation(() => { states.push({ composite: ctx.globalCompositeOperation, alpha: ctx.globalAlpha, fill: ctx.fillStyle }); });
    const restore = jest.spyOn(ctx, 'restore').mockImplementation(() => { const saved = states.pop(); if (!saved) throw new Error('Unbalanced canvas restore'); ctx.globalCompositeOperation = saved.composite; ctx.globalAlpha = saved.alpha; ctx.fillStyle = saved.fill; });
    const trace: unknown[] = [];
    const fill = jest.spyOn(ctx, 'fill').mockImplementation(() => { trace.push({ operation: 'mask', composite: ctx.globalCompositeOperation, alpha: ctx.globalAlpha }); });
    const rect = jest.spyOn(ctx, 'rect');
    const composite = jest.fn(() => { trace.push({ operation: 'compose' }); return true; });
    const includeBackground = kind !== 'png';
    const { result } = renderHook(() => useExportFrameProvider({ width: 256, height: 256, compositeLayersToCanvasSync: composite, includeBackground }));
    result.current.compositeToCanvas(canvas);
    expect(composite).toHaveBeenCalledWith(canvas, { includeBackground });
    expect(trace).toEqual([{ operation: 'compose' }, { operation: 'mask', composite: 'destination-in', alpha: 1 }]);
    expect(rect).toHaveBeenCalledWith(48, 64, 64, 64);
    expect(fill).toHaveBeenCalledTimes(1);
    expect(ctx.globalCompositeOperation).toBe('source-over'); expect(ctx.globalAlpha).toBe(0.6); expect(ctx.fillStyle).toBe(fillStyleBefore);
    expect(JSON.stringify(store.project)).toBe(projectBefore); expect(store.layers[0]).toBe(layerBefore);
    expect(Reflect.get(store.layers[0], 'imageData')).toBe(sourceImage);
    expect(sourceImage.data).toEqual(pixelsBefore);
    expect(save).toHaveBeenCalledTimes(1); expect(restore).toHaveBeenCalledTimes(1); expect(states).toEqual([]);
    fill.mockRestore(); rect.mockRestore(); save.mockRestore(); restore.mockRestore();
  });

  it('normalizes a missing shape to full export bounds without changing composition success', () => {
    store = makeStore();
    const canvas = document.createElement('canvas'); canvas.width = canvas.height = 10;
    const ctx = canvas.getContext('2d')!, rect = jest.spyOn(ctx, 'rect'), fill = jest.spyOn(ctx, 'fill');
    const { result } = renderHook(() => useExportFrameProvider({ width: 10, height: 10, compositeLayersToCanvasSync: () => true, includeBackground: false }));
    result.current.compositeToCanvas(canvas);
    expect(rect).toHaveBeenCalledWith(0, 0, 10, 10); expect(fill).toHaveBeenCalledTimes(1);
    rect.mockRestore(); fill.mockRestore();
  });

  it('does not apply a shape mask to a failed compositor frame', () => {
    store = makeStore();
    const canvas = document.createElement('canvas'), ctx = canvas.getContext('2d')!, fill = jest.spyOn(ctx, 'fill');
    const { result } = renderHook(() => useExportFrameProvider({ width: 10, height: 10, compositeLayersToCanvasSync: () => false, includeBackground: false }));
    expect(() => result.current.compositeToCanvas(canvas)).toThrow('Failed to composite export frame');
    expect(fill).not.toHaveBeenCalled(); fill.mockRestore();
  });
});
