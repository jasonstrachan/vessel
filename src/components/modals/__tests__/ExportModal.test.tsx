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
    expect(screen.getByText(/Warning: High sequential payload estimate/i)).toBeInTheDocument();
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
    expect(screen.queryByText(/Warning: High sequential payload estimate/i)).not.toBeInTheDocument();
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
    expect(screen.getByText(/Warning: High sequential payload estimate/i)).toBeInTheDocument();
  });

  it('shows high-payload preflight warning with zip + minify when estimate is still high', () => {
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

    expect(screen.getByText(/Current sequential estimate: .*zip, minified/i)).toBeInTheDocument();
    expect(screen.getByText(/Warning: High sequential payload estimate/i)).toBeInTheDocument();
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
});
