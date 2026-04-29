/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react';
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
  setSequentialFrame: jest.fn(),
  getLayerColorCycleBrush: jest.fn(() => null),
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
    runExportMock.mockResolvedValue({
      kind: 'webgl',
      filename: 'Demo',
      metadata: { layers: [] },
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

  it('applies the Goblet2 single-html preset', () => {
    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Single HTML$/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      gobletVersion: 'goblet2',
      bundleFormat: 'single-html',
      minifyOutput: true,
      enableGobletDiagnostics: false,
      embedCanvasFallback: false,
      includeHiddenLayers: false,
      htmlTitle: 'Goblet',
    });
  });

  it('toggles Goblet debug mode from the preset row', () => {
    store.webglExportSettings = {
      ...store.webglExportSettings,
      enableGobletDiagnostics: false,
      minifyOutput: true,
    };

    render(<ExportModal isOpen onClose={jest.fn()} />);
    act(() => {
      jest.runAllTimers();
    });

    fireEvent.click(screen.getByRole('button', { name: /^Debug mode$/i }));
    expect(store.updateWebglExportSettings).toHaveBeenCalledWith({
      enableGobletDiagnostics: true,
      minifyOutput: false,
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
});
