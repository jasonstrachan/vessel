import React from 'react';
import { act, render, screen, waitFor } from '@testing-library/react';
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
      showPixelGridAtMaxZoom: true,
      transparencyBackgroundMode: 'checker',
      displayFilters: [] as DisplayFilterConfig[],
    },
    setAutosaveEnabled: jest.fn(),
    setAutosaveInterval: jest.fn(),
    clearSaveStatus: jest.fn(),
    toggleRulers: jest.fn(() => {
      store.canvas.showRulers = !store.canvas.showRulers;
    }),
    setShowFPSMeter: jest.fn((visible: boolean) => {
      store.canvas.showFPSMeter = visible;
    }),
    setShowPixelGridAtMaxZoom: jest.fn((visible: boolean) => {
      store.canvas.showPixelGridAtMaxZoom = visible;
    }),
    setTransparencyBackgroundMode: jest.fn((mode: 'checker' | 'gray') => {
      store.canvas.transparencyBackgroundMode = mode;
    }),
    setGridDimensions: jest.fn((dimensions: Partial<{ enabled: boolean; rows: number; columns: number }>) => {
      store.ui.grid = { ...store.ui.grid, ...dimensions };
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
      grid: { enabled: false, rows: 8, columns: 8 },
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
    localStorage.removeItem('vessel-settings');
    resetMockStore();
  });

  it('renders primary panels and toolbars', () => {
    render(<Home />);

    expect(screen.getByTestId('left-toolbar')).toBeInTheDocument();
    expect(screen.getByTestId('drawing-canvas')).toBeInTheDocument();
    expect(screen.getByTestId('layers-panel')).toBeInTheDocument();
    expect(screen.getByTestId('brush-settings')).toBeInTheDocument();
  });

  it('isolates canvas overlays below the global modal stack', () => {
    render(<Home />);

    expect(screen.getByTestId('drawing-canvas').parentElement).toHaveClass('isolate');
  });

  it('gives brush settings more vertical space than the compact brush library', () => {
    render(<Home />);

    expect(screen.getByTestId('brush-library').parentElement).toHaveClass('flex-[0.85]');
    expect(screen.getByTestId('brush-settings').parentElement).toHaveClass('flex-[1.35]');
  });

  it('protects the layers region and scrolls secondary layer tools', () => {
    render(<Home />);

    expect(screen.getByTestId('layers-panel-region')).toHaveClass('min-h-48');
    expect(screen.getByTestId('layer-tools-region')).toHaveClass(
      'max-h-[calc(100vh-12rem)]',
      'overflow-y-auto',
    );
  });

  it('starts the autosave service when enabled', () => {
    render(<Home />);
    expect(mockAutosaveService.start).toHaveBeenCalled();
  });

  it('hydrates custom brushes on mount', () => {
    render(<Home />);
    expect(mockStore.ensureCustomBrushHydrated).toHaveBeenCalled();
  });

  it('creates a 768 by 960 project on startup', async () => {
    render(<Home />);

    await waitFor(() => {
      expect(mockStore.newProject).toHaveBeenCalledWith(
        768,
        960,
        'Untitled',
        { preserveRecoverySession: true },
      );
    });
  });

  it('creates the startup project at the last used canvas size', async () => {
    localStorage.setItem(
      'vessel-settings',
      JSON.stringify({
        canvas: { lastDocumentSize: { width: 1280, height: 720 } },
      }),
    );

    render(<Home />);

    await waitFor(() => {
      expect(mockStore.newProject).toHaveBeenCalledWith(
        1280,
        720,
        'Untitled',
        { preserveRecoverySession: true },
      );
    });
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

  it('applies persisted pixel grid visibility preference from settings', () => {
    localStorage.setItem(
      'vessel-settings',
      JSON.stringify({
        canvas: { showPixelGridAtMaxZoom: false },
      })
    );

    render(<Home />);

    expect(mockStore.setShowPixelGridAtMaxZoom).toHaveBeenCalledWith(false);
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

  it('applies a persisted user-selectable history size', () => {
    localStorage.setItem(
      'vessel-settings',
      JSON.stringify({
        history: { maxHistorySize: 100 },
      })
    );

    render(<Home />);

    expect(mockStore.setHistorySize).toHaveBeenCalledWith(100);
  });

  it('ignores legacy adaptive history sizes that silently truncate history', () => {
    localStorage.setItem(
      'vessel-settings',
      JSON.stringify({
        history: { maxHistorySize: 20 },
      })
    );

    render(<Home />);

    expect(mockStore.setHistorySize).not.toHaveBeenCalled();
  });


  it.each([true, false])('keeps a live ruler toggle after initial saved=%s hydration', saved => {
    const payload = JSON.stringify({
      canvas: {
        showRulers: saved,
        showFPSMeter: false,
        showPixelGridAtMaxZoom: false,
        transparencyBackgroundMode: 'gray',
      },
      autosave: { isEnabled: false, interval: 7 },
      history: { maxHistorySize: 100 },
      unknown: { preserve: 'exact' },
    });
    localStorage.setItem('vessel-settings', payload);
    mockStore.canvas.showRulers = !saved;
    const { rerender } = render(<Home />);
    expect(mockStore.canvas.showRulers).toBe(saved);
    expect(mockStore.toggleRulers).toHaveBeenCalledTimes(1);
    expect(mockStore.setShowFPSMeter).toHaveBeenCalledWith(false);
    expect(mockStore.setShowPixelGridAtMaxZoom).toHaveBeenCalledWith(false);
    expect(mockStore.setTransparencyBackgroundMode).toHaveBeenCalledWith('gray');
    expect(mockStore.setAutosaveEnabled).toHaveBeenCalledWith(false);
    expect(mockStore.setAutosaveInterval).toHaveBeenCalledWith(7);
    expect(mockStore.setHistorySize).toHaveBeenCalledWith(100);

    act(() => { mockStore.toggleRulers(); });
    const actions = [
      mockStore.toggleRulers,
      mockStore.setShowFPSMeter,
      mockStore.setShowPixelGridAtMaxZoom,
      mockStore.setTransparencyBackgroundMode,
      mockStore.setAutosaveEnabled,
      mockStore.setAutosaveInterval,
      mockStore.setHistorySize,
    ];
    actions.forEach(action => action.mockClear());
    rerender(<Home />);
    expect(mockStore.canvas.showRulers).toBe(!saved);
    actions.forEach(action => expect(action).not.toHaveBeenCalled());
    expect(localStorage.getItem('vessel-settings')).toBe(payload);
  });

  it.each([true, false])('hydrates latest ruler state once through StrictMode replay saved=%s', saved => {
    const payload = JSON.stringify({ canvas: { showRulers: saved } });
    localStorage.setItem('vessel-settings', payload);
    mockStore.canvas.showRulers = !saved;
    render(<React.StrictMode><Home /></React.StrictMode>);
    expect(mockStore.canvas.showRulers).toBe(saved);
    expect(mockStore.toggleRulers).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem('vessel-settings')).toBe(payload);
  });

  it.each([undefined, null, 'yes'])('does not invent ruler hydration for malformed/absent value %s', value => {
    mockStore.canvas.showRulers = true;
    localStorage.setItem('vessel-settings', JSON.stringify({ canvas: { showRulers: value, showFPSMeter: false } }));
    render(<Home />);
    expect(mockStore.canvas.showRulers).toBe(true);
    expect(mockStore.toggleRulers).not.toHaveBeenCalled();
    expect(mockStore.setShowFPSMeter).toHaveBeenCalledWith(false);
  });

  it.each([true, false])('hydrates remembered guide once and preserves later edits saved=%s', enabled => {
    const payload = JSON.stringify({ canvas: { guideGrid: { enabled, rows: 4, columns: 5, unknown: 'keep' } }, unknown: 'keep' });
    localStorage.setItem('vessel-settings', payload);
    const { rerender } = render(<React.StrictMode><Home /></React.StrictMode>);
    expect(mockStore.ui.grid).toEqual({ enabled, rows: 4, columns: 5 });
    expect(mockStore.setGridDimensions).toHaveBeenCalledTimes(1);
    expect(mockStore.setGridDimensions).toHaveBeenCalledWith({ enabled, rows: 4, columns: 5 });
    act(() => { mockStore.setGridDimensions({ enabled: !enabled, rows: 7 }); });
    mockStore.setGridDimensions.mockClear();
    rerender(<React.StrictMode><Home /></React.StrictMode>);
    expect(mockStore.ui.grid).toEqual({ enabled: !enabled, rows: 7, columns: 5 });
    expect(mockStore.setGridDimensions).not.toHaveBeenCalled();
    expect(localStorage.getItem('vessel-settings')).toBe(payload);
  });

  it('hydrates only valid guide fields without replacing current fields with malformed values', () => {
    localStorage.setItem('vessel-settings', JSON.stringify({ canvas: { guideGrid: { enabled: 'yes', rows: null, columns: 5 } } }));
    render(<Home />);
    expect(mockStore.setGridDimensions).toHaveBeenCalledWith({ columns: 5 });
    expect(mockStore.ui.grid).toEqual({ enabled: false, rows: 8, columns: 5 });
  });

  it.each([undefined, null, 'invalid', { enabled: 'yes', rows: null, columns: '5' }])('ignores absent or malformed guide values %p', guideGrid => {
    localStorage.setItem('vessel-settings', JSON.stringify({ canvas: { guideGrid } }));
    render(<Home />);
    expect(mockStore.setGridDimensions).not.toHaveBeenCalled();
    expect(mockStore.ui.grid).toEqual({ enabled: false, rows: 8, columns: 8 });
  });

});
