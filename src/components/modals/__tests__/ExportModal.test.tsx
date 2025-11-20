import React from 'react';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { ExportModal } from '../ExportModal';

jest.mock('@/hooks/useKeyboardScope', () => ({
  useKeyboardScope: jest.fn(),
}));

jest.mock('@/lib/colorCycle/RecolorManager', () => ({
  RecolorManager: class {
    dispose() {}
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
  }],
  activeLayerId: 'l1',
  compositeLayersToCanvas: jest.fn(),
  setActiveLayer: jest.fn(),
  addNotification: jest.fn(),
  webglExportSettings: {
    includeHiddenLayers: false,
    embedCanvasFallback: false,
    minifyOutput: false,
    bundleFormat: 'zip' as const,
    enableGobletDiagnostics: false,
    htmlTitle: 'Goblet',
  },
  updateWebglExportSettings: jest.fn(),
});

let store = makeStore();

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: (selector: any) => selector(store),
}));

describe('ExportModal', () => {
  beforeEach(() => {
    store = makeStore();
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
});
