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

    await waitFor(() => {
      expect(estimateExportMock).toHaveBeenCalled();
    });

    const request = estimateExportMock.mock.calls[0]?.[0];
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

  it('shows a sequential export payload warning for high-frame Goblet exports', () => {
    (store as any).project = {
      ...store.project,
      width: 1024,
      height: 1024,
    };
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

    expect(screen.getByText(/Current sequential estimate:/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated sequential texture payload \(zip\):/i)).toBeInTheDocument();
    expect(screen.getByText(/Tip: `zip` \+ minify is estimated to save about/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Optimize now/i })).toBeInTheDocument();
  });

  it('does not show sequential payload warning for low-frame Goblet exports', () => {
    (store as any).project = {
      ...store.project,
      width: 64,
      height: 64,
    };
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-light',
      layerType: 'sequential',
      sequentialData: {
        frameCount: 12,
        fps: 12,
        durationMs: 1000,
        events: [],
      },
    }] as any;

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByText(/Current sequential estimate:/i)).toBeInTheDocument();
    expect(screen.queryByText(/Estimated sequential texture payload/i)).not.toBeInTheDocument();
  });

  it('updates sequential payload warning label when bundle format changes', () => {
    (store as any).project = {
      ...store.project,
      width: 1024,
      height: 1024,
    };
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-heavy-format',
      layerType: 'sequential',
      sequentialData: {
        frameCount: 220,
        fps: 18,
        durationMs: Math.round((220 * 1000) / 18),
        events: [],
      },
    }] as any;
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'single-html',
      minifyOutput: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByText(/Current sequential estimate: .*single-html, minified/i)).toBeInTheDocument();
    expect(screen.getByText(/Estimated sequential texture payload \(single-html\):/i)).toBeInTheDocument();
  });

  it('omits optimization tip when export is already zip + minify', () => {
    (store as any).project = {
      ...store.project,
      width: 1024,
      height: 1024,
    };
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-heavy-optimized',
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
      bundleFormat: 'zip',
      minifyOutput: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByText(/Estimated sequential texture payload \(zip\):/i)).toBeInTheDocument();
    expect(screen.queryByText(/Tip: `zip` \+ minify is estimated to save about/i)).not.toBeInTheDocument();
  });

  it('applies zip + minify when optimize now is clicked', () => {
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

    fireEvent.click(screen.getByRole('button', { name: /Optimize now/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      bundleFormat: 'zip',
      minifyOutput: true,
    });
  });

  it('reverts optimized settings back to previous packaging options', () => {
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

    const view = render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /Optimize now/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      bundleFormat: 'zip',
      minifyOutput: true,
    });

    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'zip',
      minifyOutput: true,
    };
    view.rerender(<ExportModal isOpen onClose={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: /Revert optimization/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      bundleFormat: 'single-html',
      minifyOutput: false,
    });
  });

  it('keeps revert action available after modal remount', () => {
    (store as any).project = {
      ...store.project,
      id: 'project-remount',
      width: 1024,
      height: 1024,
    };
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-heavy-remount',
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

    const first = render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });
    fireEvent.click(screen.getByRole('button', { name: /Optimize now/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      bundleFormat: 'zip',
      minifyOutput: true,
    });
    first.unmount();

    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'zip',
      minifyOutput: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByRole('button', { name: /Revert optimization/i })).toBeInTheDocument();
  });

  it('hides revert action after optimization backup TTL expires', () => {
    const baseNow = new Date('2026-02-09T10:00:00.000Z');
    jest.setSystemTime(baseNow);

    (store as any).project = {
      ...store.project,
      id: 'project-ttl',
      width: 1024,
      height: 1024,
    };
    (store as any).layers = [{
      ...store.layers[0],
      id: 'seq-heavy-ttl',
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

    const first = render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });
    fireEvent.click(screen.getByRole('button', { name: /Optimize now/i }));
    first.unmount();

    jest.setSystemTime(new Date(baseNow.getTime() + 11 * 60 * 1000));
    (store as any).webglExportSettings = {
      ...store.webglExportSettings,
      bundleFormat: 'zip',
      minifyOutput: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.queryByRole('button', { name: /Revert optimization/i })).not.toBeInTheDocument();
  });
});
