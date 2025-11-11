import { render, screen } from '@testing-library/react';
import Home from '../page';

jest.mock('@/components/LeftToolbar', () => () => <div data-testid="left-toolbar" />);
jest.mock('@/components/panels/ColorPickerPanel', () => () => <div data-testid="color-picker" />);
jest.mock('@/components/panels/LayersPanel', () => () => <div data-testid="layers-panel" />);
jest.mock('@/components/panels/AlignmentPanel', () => () => <div data-testid="alignment-panel" />);
jest.mock('@/components/panels/AnimationControlsPanel', () => () => <div data-testid="animation-panel" />);
jest.mock('@/components/panels/BrushLibraryPanel', () => () => <div data-testid="brush-library" />);
jest.mock('@/components/panels/BrushSettingsPanel', () => () => <div data-testid="brush-settings" />);
jest.mock('@/components/canvas/DrawingCanvas', () => {
  const React = require('react');
  return ({ showFeedback }: { showFeedback: (msg: string) => void }) => {
    React.useEffect(() => {
      showFeedback('test');
    }, [showFeedback]);
    return <div data-testid="drawing-canvas" />;
  };
});
jest.mock('@/components/dev/ConsoleSilencer', () => () => null);
jest.mock('@/components/dev/FPSMeter', () => () => <div data-testid="fps-meter" />);
jest.mock('@/components/FeedbackStrip', () => ({ message, onClose }: { message: string; onClose: () => void }) => (
  <div data-testid="feedback-strip" onClick={onClose}>{message}</div>
));
jest.mock('@/components/modals/DocumentModal', () => ({ DocumentModal: () => <div data-testid="document-modal" /> }));
jest.mock('@/components/modals/ExportModal', () => ({ ExportModal: () => <div data-testid="export-modal" /> }));
jest.mock('@/components/modals/SettingsModal', () => ({ SettingsModal: () => <div data-testid="settings-modal" /> }));
jest.mock('@/components/modals/LoadProjectModal', () => () => <div data-testid="load-modal" />);

jest.mock('@/utils/autosave', () => {
  const service = {
    start: jest.fn(),
    stop: jest.fn(),
    setInterval: jest.fn(),
    isRunning: jest.fn(() => false),
  };
  return {
    autosaveService: service,
    __autosaveService: service,
  };
});

const { __autosaveService: mockAutosaveService } = require('@/utils/autosave') as { __autosaveService: {
  start: jest.Mock;
  stop: jest.Mock;
  setInterval: jest.Mock;
  isRunning: jest.Mock;
}; };

jest.mock('@/utils/risographTexture', () => ({
  preloadRisographTexture: jest.fn(),
}));

jest.mock('@/utils/perf/ccPerfProbe', () => ({
  enableCCPerfProbe: jest.fn(),
}));

jest.mock('@/history/helpers/layerHistory', () => ({
  commitLayerHistory: jest.fn(),
}));

jest.mock('@/history/helpers/colorCycle', () => ({
  captureColorCycleBrushState: jest.fn(),
}));

function createMockStore() {
  return {
    toggleModal: jest.fn(),
    autosave: { isEnabled: true, interval: 5 },
    canvas: { showRulers: false },
    setAutosaveEnabled: jest.fn(),
    setAutosaveInterval: jest.fn(),
    toggleRulers: jest.fn(),
    setHistorySize: jest.fn(),
    newProject: jest.fn(),
    ensureCustomBrushHydrated: jest.fn().mockResolvedValue(undefined),
    layers: [],
    palette: { activeSlot: 'foreground', foregroundColor: '#000000', backgroundColor: '#ffffff' },
    ui: { modals: { document: false, settings: false, export: false, loadProject: false } },
  };
}

jest.mock('@/stores/useAppStore', () => {
  const store = createMockStore();
  const mock = jest.fn((selector?: (state: typeof store) => unknown) => {
    if (selector) {
      return selector(store as never);
    }
    return store;
  });
  (mock as any).getState = () => store;
  (mock as any).setState = jest.fn();
  (mock as any).subscribe = jest.fn(() => () => {});
  return {
    useAppStore: mock,
    __mockStore: store,
  };
});

const { useAppStore: useAppStoreMock, __mockStore: mockStore } = require('@/stores/useAppStore') as {
  useAppStore: jest.Mock;
  __mockStore: ReturnType<typeof createMockStore>;
};

describe('Home page client rendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders primary panels and toolbars', () => {
    render(<Home />);

    expect(screen.getByTestId('left-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('layers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('brush-settings')).toBeInTheDocument();
  });

  it('starts the autosave service when enabled', () => {
    render(<Home />);
    expect(mockAutosaveService.start).toHaveBeenCalled();
  });

  it('hydrates custom brushes on mount', () => {
    render(<Home />);
    expect(mockStore.ensureCustomBrushHydrated).toHaveBeenCalled();
  });
});
