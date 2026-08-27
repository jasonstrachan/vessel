/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
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

const runExportMock = jest.fn();
const estimateExportMock = jest.fn();

const makeWebglResult = () => {
  const metadata = {
    layers: [],
    viewport: { designWidth: 64, designHeight: 64 },
    animation: { totalFrames: 1, fps: 60 },
  };
  const sizeReport = {
    format: 'zip' as const,
    totalBytes: 3,
    metadataBytes: 0,
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

jest.mock('@/utils/export/exportService', () => ({
  runExport: (...args: unknown[]) => runExportMock(...args),
  estimateExport: (...args: unknown[]) => estimateExportMock(...args),
}));

const makeStore = () => ({
  project: {
    id: 'p1',
    name: 'Demo',
    width: 64,
    height: 64,
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
  sequentialRecord: { currentFrame: 0 },
  compositeLayersToCanvas: jest.fn(),
  setActiveLayer: jest.fn(),
  addNotification: jest.fn(),
  toggleModal: jest.fn(),
  setSequentialFrame: jest.fn(),
  updateLayer: jest.fn(),
  tools: { brushSettings: { colorCycleFPS: 30 } },
  webglExportSettings: {
    includeHiddenLayers: true,
    embedCanvasFallback: true,
    minifyOutput: false,
    bundleFormat: 'zip' as const,
    gobletVersion: 'goblet1' as const,
    enableGobletDiagnostics: true,
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

describe('ExportModal webgl preflight', () => {
  beforeEach(() => {
    store = makeStore();
    runExportMock.mockReset();
    estimateExportMock.mockReset();
    runExportMock.mockResolvedValue(makeWebglResult());
    estimateExportMock.mockResolvedValue({
      paletteSize: null,
      estimatedBytes: null,
    });
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('selects Single HTML without resetting independent advanced settings', () => {
    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Single HTML$/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      bundleFormat: 'single-html',
    });
  });

  it('does not reset hidden-layer export when applying a Goblet preset', () => {
    store.webglExportSettings = {
      ...store.webglExportSettings,
      includeHiddenLayers: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Single HTML$/i }));
    expect(store.updateWebglExportSettings).not.toHaveBeenCalledWith(
      expect.objectContaining({ includeHiddenLayers: false })
    );
  });

  it('keeps diagnostics as an independent advanced setting', () => {
    store.webglExportSettings = {
      ...store.webglExportSettings,
      enableGobletDiagnostics: false,
      minifyOutput: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: 'Advanced' }));
    fireEvent.click(screen.getByLabelText('Diagnostics helpers'));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      enableGobletDiagnostics: true,
    });
  });

  it('blocks webgl export when preflight has errors', () => {
    store.layers = store.layers.map((layer) => ({ ...layer, visible: false })) as any;
    store.webglExportSettings = {
      ...store.webglExportSettings,
      includeHiddenLayers: false,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    expect(store.addNotification).toHaveBeenCalledWith(expect.objectContaining({
      type: 'error',
      title: 'Export blocked by preflight',
    }));
    expect(runExportMock).not.toHaveBeenCalled();
  });

  it('passes includeHiddenLayers through to the Goblet export request', async () => {
    store.layers = [{
      ...store.layers[0],
      visible: false,
    }] as any;
    store.webglExportSettings = {
      ...store.webglExportSettings,
      includeHiddenLayers: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    await act(async () => {});

    expect(runExportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: 'webgl',
        options: expect.objectContaining({
          request: expect.objectContaining({
            includeHiddenLayers: true,
          }),
        }),
      }),
      expect.any(Function),
      expect.any(AbortSignal)
    );
  });

  it('keeps full layer ownership for export while omitting hidden layers from progress', async () => {
    store.layers = [
      {
        ...store.layers[0],
        id: 'visible-layer',
        name: 'Visible layer',
        visible: true,
      },
      {
        ...store.layers[0],
        id: 'hidden-layer',
        name: 'Hidden layer',
        visible: false,
      },
    ] as any;
    store.webglExportSettings = {
      ...store.webglExportSettings,
      includeHiddenLayers: false,
    };
    runExportMock.mockImplementation(async (_request, onProgress) => {
      onProgress({
        phase: 'layers',
        percent: 50,
        message: 'Hidden layer excluded',
        webgl: {
          phase: 'layers',
          percent: 50,
          message: 'Hidden layer excluded',
          layer: {
            id: 'hidden-layer',
            name: 'Hidden layer',
            status: 'skipped-hidden',
            message: 'Hidden layer excluded',
          },
        },
      });
      return makeWebglResult();
    });

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.getByText('1 visible · 1 hidden excluded')).toBeInTheDocument();
    const setupDialog = screen.getByRole('dialog', { name: 'Export' });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });

    const readyDialog = await screen.findByRole('dialog', { name: 'Goblet ready' });
    expect(readyDialog).toBe(setupDialog);
    expect(screen.getAllByRole('dialog')).toHaveLength(1);
    expect(screen.getByTestId('excluded-hidden-layer-summary')).toHaveTextContent(
      '1 hidden layer excluded',
    );
    const layerList = within(screen.getByTestId('export-progress-layer-list'));
    expect(layerList.getByText('Visible layer')).toBeInTheDocument();
    expect(layerList.queryByText('Hidden layer')).not.toBeInTheDocument();
    expect(runExportMock).toHaveBeenCalledWith(
      expect.objectContaining({
        options: expect.objectContaining({
          request: expect.objectContaining({
            layers: [
              expect.objectContaining({ id: 'visible-layer' }),
              expect.objectContaining({ id: 'hidden-layer' }),
            ],
          }),
        }),
      }),
      expect.any(Function),
      expect.any(AbortSignal),
    );
  });

  it('shows Goblet layer progress and export errors in the progress modal', async () => {
    store.layers = [{
      ...store.layers[0],
      id: 'cc1',
      name: 'Damaged CC',
      layerType: 'color-cycle',
      colorCycleData: {
        repairStatus: {
          ok: false,
          reason: 'missing-canonical-paint',
        },
      },
    }] as any;
    runExportMock.mockImplementation(async (_request, onProgress) => {
      onProgress({
        phase: 'prepare',
        percent: 5,
        message: 'Preparing Goblet export...',
        webgl: {
          phase: 'preparing',
          percent: 5,
          message: 'Preparing Goblet export...',
        },
      });
      onProgress({
        phase: 'prepare',
        percent: 25,
        message: 'Damaged CC is static preview only',
        webgl: {
          phase: 'layers',
          percent: 25,
          message: 'Damaged CC is static preview only',
          layer: {
            id: 'cc1',
            name: 'Damaged CC',
            status: 'static-preview',
            message: 'missing-canonical-paint',
          },
        },
      });
      throw new Error('Goblet exploded');
    });

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });
    expect(await screen.findByText('Continue anyway')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByText('Continue anyway'));
    });

    expect(await screen.findByRole('dialog', { name: 'Export failed' })).toBeInTheDocument();
    expect(screen.getByText('Damaged CC')).toBeInTheDocument();
    expect(screen.getByText('Static preview')).toBeInTheDocument();
    expect(screen.getAllByText('Goblet exploded').length).toBeGreaterThan(0);
  });

  it('stops Goblet export on static-preview issues and can open repair flow', async () => {
    const onClose = jest.fn();
    store.layers = [{
      ...store.layers[0],
      id: 'cc1',
      name: 'Damaged CC',
      layerType: 'color-cycle',
      colorCycleData: {
        repairStatus: {
          ok: false,
          reason: 'missing-canonical-paint',
        },
      },
    }] as any;

    render(<ExportModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));

    expect(await screen.findByText('Goblet export stopped before starting.')).toBeInTheDocument();
    expect(screen.getByText('Damaged CC: missing-canonical-paint')).toBeInTheDocument();
    expect(runExportMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText('Repair...'));

    expect(onClose).toHaveBeenCalled();
    expect(store.toggleModal).toHaveBeenCalledWith('loadProject');
  });

  it('clears progress state when the parent modal closes', async () => {
    runExportMock.mockResolvedValue(makeWebglResult());

    const { rerender } = render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });
    expect(await screen.findByRole('dialog', { name: 'Goblet ready' })).toBeInTheDocument();

    rerender(<ExportModal isOpen={false} onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });
    rerender(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    expect(screen.queryByRole('dialog', { name: 'Goblet ready' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Export' })).toBeInTheDocument();
  });

  it('dismisses completed export progress and parent export modal from the progress backdrop', async () => {
    const onClose = jest.fn();
    runExportMock.mockResolvedValue(makeWebglResult());

    render(<ExportModal isOpen onClose={onClose} />);
    act(() => {
      jest.runAllTimers();
    });

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^Export$/i }));
    });
    expect(await screen.findByRole('dialog', { name: 'Goblet ready' })).toBeInTheDocument();

    fireEvent.click(screen.getByTestId('export-modal-backdrop'));

    expect(onClose).toHaveBeenCalled();
    expect(screen.queryByRole('dialog', { name: 'Goblet ready' })).not.toBeInTheDocument();
  });
});
