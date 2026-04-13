import React from 'react';
import { render, screen } from '@testing-library/react';
import { autosaveService as mockAutosaveService } from '@/utils/autosave';
import type { DisplayFilterConfig } from '@/types';
import Home from '../HomeClient';

function createMockComponent<P extends Record<string, unknown> = Record<string, never>>(
  testId: string,
  name: string,
  renderFn?: (props: P) => React.ReactElement | null
): React.FC<P> {
  const MockComponent: React.FC<P> = (props) => {
    if (renderFn) {
      return renderFn(props);
    }
    return <div data-testid={testId} />;
  };
  MockComponent.displayName = name;
  return MockComponent;
}

function createModalMock(testId: string, label: string) {
  return createMockComponent<{ isOpen?: boolean; onClose?: () => void }>(testId, label, ({ isOpen }) =>
    isOpen ? <div data-testid={testId} /> : null
  );
}

function createDrawingCanvasMock() {
  const MockDrawingCanvas: React.FC<{ showFeedback: (msg: string) => void }> = ({ showFeedback }) => {
    React.useEffect(() => {
      showFeedback('test');
    }, [showFeedback]);
    return <div data-testid="drawing-canvas" />;
  };
  MockDrawingCanvas.displayName = 'MockDrawingCanvas';
  return MockDrawingCanvas;
}

jest.mock('@/components/LeftToolbar', () => ({
  __esModule: true,
  default: createMockComponent('left-toolbar', 'MockLeftToolbar'),
}));
jest.mock('@/components/panels/ColorPickerPanel', () => ({
  __esModule: true,
  default: createMockComponent('color-picker', 'MockColorPickerPanel'),
}));
jest.mock('@/components/panels/LayersPanel', () => ({
  __esModule: true,
  default: createMockComponent('layers-panel', 'MockLayersPanel'),
}));
jest.mock('@/components/panels/AlignmentPanel', () => ({
  __esModule: true,
  default: createMockComponent('alignment-panel', 'MockAlignmentPanel'),
}));
jest.mock('@/components/panels/AnimationControlsPanel', () => ({
  __esModule: true,
  default: createMockComponent('animation-panel', 'MockAnimationControlsPanel'),
}));
jest.mock('@/components/panels/BrushLibraryPanel', () => ({
  __esModule: true,
  default: createMockComponent('brush-library', 'MockBrushLibraryPanel'),
}));
jest.mock('@/components/panels/BrushSettingsPanel', () => ({
  __esModule: true,
  default: createMockComponent('brush-settings', 'MockBrushSettingsPanel'),
}));
jest.mock('@/components/canvas/DrawingCanvas', () => ({
  __esModule: true,
  default: createDrawingCanvasMock(),
}));
jest.mock('@/components/dev/ConsoleSilencer', () => ({
  __esModule: true,
  default: createMockComponent('console-silencer', 'MockConsoleSilencer', () => null),
}));
jest.mock('@/components/dev/FPSMeter', () => ({
  __esModule: true,
  default: createMockComponent('fps-meter', 'MockFPSMeter'),
}));
jest.mock('@/components/FeedbackStrip', () => ({
  __esModule: true,
  default: createMockComponent<{ message: string; onClose: () => void }>(
    'feedback-strip',
    'MockFeedbackStrip',
    ({ message, onClose }) => (
      <div data-testid="feedback-strip" onClick={onClose}>
        {message}
      </div>
    )
  ),
}));
jest.mock('@/components/SelectionConstraintStrip', () => ({
  __esModule: true,
  default: createMockComponent('selection-constraint-strip', 'MockSelectionConstraintStrip', () => null),
}));
jest.mock('@/components/modals/DocumentModal', () => ({
  __esModule: true,
  DocumentModal: createModalMock('document-modal', 'MockDocumentModal'),
}));
jest.mock('@/components/modals/ExportModal', () => ({
  __esModule: true,
  ExportModal: createModalMock('export-modal', 'MockExportModal'),
}));
jest.mock('@/components/modals/SettingsModal', () => ({
  __esModule: true,
  SettingsModal: createModalMock('settings-modal', 'MockSettingsModal'),
}));
jest.mock('@/components/modals/LoadProjectModal', () => ({
  __esModule: true,
  default: createModalMock('load-modal', 'MockLoadProjectModal'),
}));

jest.mock('@/utils/autosave', () => {
  const autosaveMock = {
    start: jest.fn(),
    stop: jest.fn(),
    setInterval: jest.fn(),
    isRunning: jest.fn(() => false),
  };
  return {
    __esModule: true,
    autosaveService: autosaveMock,
    useAutosave: () => autosaveMock,
  };
});

jest.mock('@/utils/risographTexture', () => ({
  preloadRisographTexture: jest.fn(),
}));

function createMockStore() {
  const store = {
    toggleModal: jest.fn(),
    autosave: {
      isEnabled: true,
      isRunning: false,
      hasUnsavedChanges: false,
      lastSaveTime: null,
      interval: 5,
      lastDirtyReason: null,
      lastDirtyAt: null,
      saveStatus: {
        phase: 'idle' as 'idle' | 'saving' | 'saved' | 'error',
        source: null as 'manual' | 'autosave' | null,
        message: null as string | null,
        updatedAt: null as Date | null,
      },
      fileBackup: {
        enabled: false,
        mode: 'single-file' as const,
        fileHandle: null,
        directoryHandle: null,
        backupPath: null,
        lastBackupTime: null,
      },
    },
    canvas: {
      showRulers: false,
      showFPSMeter: true,
      transparencyBackgroundMode: 'checker',
      displayFilters: [] as DisplayFilterConfig[],
    },
    setAutosaveEnabled: jest.fn(),
    setAutosaveInterval: jest.fn(),
    clearSaveStatus: jest.fn(),
    toggleRulers: jest.fn(),
    setShowFPSMeter: jest.fn((visible: boolean) => {
      store.canvas.showFPSMeter = visible;
    }),
    setTransparencyBackgroundMode: jest.fn((mode: 'checker' | 'gray') => {
      store.canvas.transparencyBackgroundMode = mode;
    }),
    setHistorySize: jest.fn(),
    newProject: jest.fn(),
    ensureCustomBrushHydrated: jest.fn().mockResolvedValue(undefined),
    layers: [],
    palette: { activeSlot: 'foreground', foregroundColor: '#000000', backgroundColor: '#ffffff' },
    setDisplayFilters: jest.fn((filters: DisplayFilterConfig[]) => {
      store.canvas.displayFilters = filters;
    }),
    ui: {
      modals: { document: false, settings: false, export: false, loadProject: false },
      brushPanelSection: 'tool',
      settingsSection: 'display',
    },
  };
  return store;
}

type MockStore = ReturnType<typeof createMockStore>;
const mockStore: MockStore = createMockStore();

const resetMockStore = () => {
  Object.assign(mockStore, createMockStore());
};

jest.mock('@/stores/useAppStore', () => {
  const useAppStore = Object.assign(
    jest.fn((selector?: (state: MockStore) => unknown) => {
      if (selector) {
        return selector(mockStore as never);
      }
      return mockStore;
    }) as jest.Mock,
    {
      getState: () => mockStore,
      setState: jest.fn(),
      subscribe: jest.fn(() => () => {}),
    }
  );

  return {
    __esModule: true,
    useAppStore,
  };
});

describe('Home page client rendering', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    resetMockStore();
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

  it('renders FPS meter after settings hydration when enabled', () => {
    render(<Home />);
    expect(screen.getByTestId('fps-meter')).toBeInTheDocument();
  });

  it('renders save status strip while saving', () => {
    mockStore.autosave.saveStatus = {
      phase: 'saving',
      source: 'manual',
      message: 'Saving project...',
      updatedAt: new Date('2026-03-03T12:00:00.000Z'),
    };

    render(<Home />);

    expect(screen.getByRole('status')).toHaveTextContent('Saving project...');
  });

  it('applies persisted FPS visibility preference from settings', () => {
    localStorage.setItem(
      'vessel-settings',
      JSON.stringify({
        canvas: { showFPSMeter: false },
      })
    );

    render(<Home />);

    expect(mockStore.setShowFPSMeter).toHaveBeenCalledWith(false);
  });

  it('applies persisted transparency background preference from settings', () => {
    localStorage.setItem(
      'vessel-settings',
      JSON.stringify({
        canvas: { transparencyBackgroundMode: 'gray' },
      })
    );

    render(<Home />);

    expect(mockStore.setTransparencyBackgroundMode).toHaveBeenCalledWith('gray');
  });

});
