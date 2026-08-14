import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { VesselMultiplayerSnapshot } from '@/collaboration/vesselMultiplayerSession';
import LeftToolbar, { TOOLBAR_TOOLTIP_DELAY_MS } from '../LeftToolbar';

const mockSwitchTool = jest.fn().mockResolvedValue(undefined);
const mockStartVesselMultiplayerSession = jest.fn().mockResolvedValue(undefined);
const mockStopVesselMultiplayerSession = jest.fn();
const mockShowAppFeedback = jest.fn();
const mockOpenReferenceStudioWindow = jest.fn(() => true);
let multiplayer: VesselMultiplayerSnapshot = {
  sessionId: null,
  projectId: null,
  status: 'idle',
  humanLayerId: null,
  aiLayerId: null,
  activeGestureId: null,
  aiCursor: null,
  stopReason: null,
  error: null,
  bridgeStatus: 'connected',
  aiState: 'watching',
  aiModel: 'test-model',
  lastObservationAt: null,
  bridgeError: null,
};

jest.mock('@/collaboration/vesselMultiplayerSession', () => ({
  startVesselMultiplayerSession: (...args: unknown[]) => mockStartVesselMultiplayerSession(...args),
  stopVesselMultiplayerSession: (...args: unknown[]) => mockStopVesselMultiplayerSession(...args),
  useVesselMultiplayerSnapshot: () => multiplayer,
}));

jest.mock('@/utils/appFeedback', () => ({
  showAppFeedback: (...args: unknown[]) => mockShowAppFeedback(...args),
}));

jest.mock('@/referenceStudio/referenceStudioChannel', () => ({
  openReferenceStudioWindow: () => mockOpenReferenceStudioWindow(),
}));

jest.mock('@/utils/toolSwitch', () => ({
  useToolSwitcher: () => mockSwitchTool,
}));

type ToolbarStore = {
  tools: { currentTool: string; selectionMode?: string };
  ui: { grid: { enabled: boolean }; modals: { settings: boolean }; brushPanelSection: 'tool' | 'filters' };
  saveProject: jest.Mock;
  toggleGrid: jest.Mock;
  toggleModal: jest.Mock;
  setSelectionMode: jest.Mock;
  setBrushPanelSection: jest.Mock;
  setSettingsSection: jest.Mock;
};

const mockStore: ToolbarStore = {
  tools: { currentTool: 'brush', selectionMode: 'marquee' },
  ui: { grid: { enabled: false }, modals: { settings: false }, brushPanelSection: 'tool' },
  saveProject: jest.fn().mockResolvedValue(undefined),
  toggleGrid: jest.fn(),
  toggleModal: jest.fn(),
  setSelectionMode: jest.fn(),
  setBrushPanelSection: jest.fn(),
  setSettingsSection: jest.fn(),
};

jest.mock('@/stores/useAppStore', () => {
  const actual = jest.requireActual('@/stores/useAppStore');
  return {
    __esModule: true,
    ...actual,
    useAppStore: jest.fn(),
  };
});

const { useAppStore: useAppStoreMock } = jest.requireMock('@/stores/useAppStore') as {
  useAppStore: jest.Mock & {
    getState?: () => ToolbarStore;
    setState?: jest.Mock;
    subscribe?: jest.Mock;
  };
};

Object.assign(useAppStoreMock, {
  getState: () => mockStore,
  setState: jest.fn(),
  subscribe: jest.fn(() => () => {}),
});

useAppStoreMock.mockImplementation(() => mockStore);

describe('LeftToolbar accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.tools.currentTool = 'brush';
    mockStore.tools.selectionMode = 'marquee';
    mockStore.ui.grid.enabled = false;
    mockStore.ui.modals.settings = false;
    mockStore.ui.brushPanelSection = 'tool';
    multiplayer = {
      sessionId: null,
      projectId: null,
      status: 'idle',
      humanLayerId: null,
      aiLayerId: null,
      activeGestureId: null,
      aiCursor: null,
      stopReason: null,
      error: null,
      bridgeStatus: 'connected',
      aiState: 'watching',
      aiModel: 'test-model',
      lastObservationAt: null,
      bridgeError: null,
    };
    mockStartVesselMultiplayerSession.mockResolvedValue(undefined);
    mockStopVesselMultiplayerSession.mockReturnValue({ status: 'stopped' });
    mockStore.setBrushPanelSection.mockImplementation((section: 'tool' | 'filters') => {
      mockStore.ui.brushPanelSection = section;
    });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('marks the active tool button as pressed and annotates shortcuts', () => {
    render(<LeftToolbar />);

    const brushButton = screen.getByRole('button', { name: /brush \(b\)/i });
    expect(brushButton).toHaveAttribute('aria-pressed', 'true');
    expect(brushButton).toHaveAttribute('data-shortcut', 'B');
  });

  it('shows the full toolbar label only after a long hover', () => {
    jest.useFakeTimers();
    render(<LeftToolbar />);

    const brushButton = screen.getByRole('button', { name: /brush \(b\)/i });
    fireEvent.mouseEnter(brushButton.parentElement as HTMLElement);

    act(() => {
      jest.advanceTimersByTime(TOOLBAR_TOOLTIP_DELAY_MS - 1);
    });
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

    act(() => {
      jest.advanceTimersByTime(1);
    });
    expect(screen.getByRole('tooltip')).toHaveTextContent('Brush (B)');
    expect(brushButton).toHaveAttribute('aria-describedby', 'toolbar-tooltip-brush');

    fireEvent.mouseLeave(brushButton.parentElement as HTMLElement);
    expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();
  });

  it('does not let a stale hover timer replace the keyboard-focused tooltip', () => {
    jest.useFakeTimers();
    render(<LeftToolbar />);

    const brushButton = screen.getByRole('button', { name: /brush \(b\)/i });
    const customButton = screen.getByRole('button', { name: /custom brush \(c\)/i });
    fireEvent.mouseEnter(brushButton.parentElement as HTMLElement);
    fireEvent.focus(customButton);

    act(() => {
      jest.advanceTimersByTime(TOOLBAR_TOOLTIP_DELAY_MS);
    });

    expect(screen.getByRole('tooltip')).toHaveTextContent('Custom Brush (C)');
    expect(customButton).toHaveAttribute('aria-describedby', 'toolbar-tooltip-custom');
  });

  it('invokes the tool switcher for standard tool clicks', async () => {
    render(<LeftToolbar />);

    const customButton = screen.getByRole('button', { name: /custom brush/i });
    fireEvent.click(customButton);

    await waitFor(() => {
      expect(mockSwitchTool).toHaveBeenCalledWith('custom');
    });
  });

  it('exposes one Eyedropper button backed by the functional color picker tool', async () => {
    render(<LeftToolbar />);

    const eyedropperButtons = screen.getAllByRole('button', { name: /eyedropper/i });
    expect(eyedropperButtons).toHaveLength(1);
    expect(eyedropperButtons[0]).toHaveAttribute('data-shortcut', 'Hold P');

    fireEvent.click(eyedropperButtons[0]);

    await waitFor(() => {
      expect(mockSwitchTool).toHaveBeenCalledWith('color-picker');
    });
  });

  it('renders and switches to magic wand via toolbar button', async () => {
    render(<LeftToolbar />);

    const wandButton = screen.getByRole('button', { name: /magic wand \(w\)/i });
    expect(wandButton).toHaveAttribute('data-shortcut', 'W');

    fireEvent.click(wandButton);

    await waitFor(() => {
      expect(mockStore.setSelectionMode).toHaveBeenCalledWith('magic-wand');
      expect(mockSwitchTool).toHaveBeenCalledWith('selection');
    });
  });

  it('treats selection wand mode as the active wand button state', () => {
    mockStore.tools.currentTool = 'selection';
    mockStore.tools.selectionMode = 'magic-wand';

    render(<LeftToolbar />);

    expect(screen.getByRole('button', { name: /magic wand \(w\)/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /selection \(m\)/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('routes save actions through the store API for accessibility buttons', async () => {
    render(<LeftToolbar />);

    fireEvent.click(screen.getByRole('button', { name: /save file/i }));

    await waitFor(() => {
      expect(mockStore.saveProject).toHaveBeenCalledTimes(1);
    });
  });

  it('toggles the grid from the toolbar', () => {
    render(<LeftToolbar />);

    const gridButton = screen.getByRole('button', { name: /grid/i });
    expect(gridButton).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(gridButton);

    expect(mockStore.toggleGrid).toHaveBeenCalledTimes(1);
  });

  it('opens Reference Studio from its dedicated toolbar button', () => {
    render(<LeftToolbar />);

    fireEvent.click(screen.getByRole('button', { name: /reference studio/i }));

    expect(mockOpenReferenceStudioWindow).toHaveBeenCalledTimes(1);
    expect(mockSwitchTool).not.toHaveBeenCalled();
  });

  it('routes the Fl button to the brush settings filters section', () => {
    render(<LeftToolbar />);

    fireEvent.click(screen.getByRole('button', { name: /filters/i }));

    expect(mockStore.setBrushPanelSection).toHaveBeenCalledWith('filters');
    expect(mockStore.toggleModal).not.toHaveBeenCalled();
  });

  it('marks the Fl button active when the brush panel is showing filters', () => {
    mockStore.ui.brushPanelSection = 'filters';

    render(<LeftToolbar />);

    expect(screen.getByRole('button', { name: /filters/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('treats filters as the only active toolbar state while the filters section is open', () => {
    mockStore.ui.brushPanelSection = 'filters';

    render(<LeftToolbar />);

    expect(screen.getByRole('button', { name: /filters/i })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /brush \(b\)/i })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /selection \(m\)/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('switches back to tool mode when a toolbar tool is clicked from filters', async () => {
    mockStore.ui.brushPanelSection = 'filters';
    const { rerender } = render(<LeftToolbar />);

    fireEvent.click(screen.getByRole('button', { name: /custom brush/i }));

    await waitFor(() => {
      expect(mockStore.setBrushPanelSection).toHaveBeenCalledWith('tool');
      expect(mockSwitchTool).toHaveBeenCalledWith('custom');
    });

    rerender(<LeftToolbar />);

    expect(screen.getByRole('button', { name: /filters/i })).toHaveAttribute('aria-pressed', 'false');
  });

  it('still opens global settings from the options button', () => {
    mockStore.ui.modals.settings = true;

    render(<LeftToolbar />);

    fireEvent.click(screen.getByRole('button', { name: /options/i }));

    expect(mockStore.setSettingsSection).toHaveBeenCalledWith('display');
    expect(mockStore.toggleModal).not.toHaveBeenCalled();
  });

  it('starts multiplayer from the left toolbar without switching tools', async () => {
    render(<LeftToolbar />);

    const multiplayerButton = screen.getByRole('button', { name: 'Start multiplayer painting' });
    expect(multiplayerButton).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(multiplayerButton);

    await waitFor(() => {
      expect(mockStartVesselMultiplayerSession).toHaveBeenCalledWith({
        sessionId: expect.stringMatching(/^vessel-/),
      });
      expect(mockShowAppFeedback).toHaveBeenCalledWith('Multiplayer active — AI watching');
    });
    expect(mockSwitchTool).not.toHaveBeenCalled();
  });

  it('stops an active multiplayer session from the same toolbar item', () => {
    multiplayer = {
      ...multiplayer,
      sessionId: 'portrait-together',
      status: 'active',
    };
    render(<LeftToolbar />);

    const multiplayerButton = screen.getByRole('button', { name: 'Stop AI multiplayer painting' });
    expect(multiplayerButton).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(multiplayerButton);

    expect(mockStopVesselMultiplayerSession).toHaveBeenCalledWith({
      sessionId: 'portrait-together',
      reason: 'Stopped from the Vessel toolbar',
    });
    expect(mockShowAppFeedback).toHaveBeenCalledWith('Multiplayer stopped');
  });

  it('reports multiplayer startup failures and re-enables the toolbar item', async () => {
    mockStartVesselMultiplayerSession.mockRejectedValueOnce(new Error('Select a drawable layer'));
    render(<LeftToolbar />);

    const multiplayerButton = screen.getByRole('button', { name: 'Start multiplayer painting' });
    fireEvent.click(multiplayerButton);

    await waitFor(() => {
      expect(mockShowAppFeedback).toHaveBeenCalledWith(
        'Multiplayer unavailable: Select a drawable layer',
      );
      expect(multiplayerButton).not.toBeDisabled();
    });
  });

  it('disables the multiplayer item while an active gesture is stopping', () => {
    multiplayer = {
      ...multiplayer,
      sessionId: 'portrait-together',
      status: 'stopping',
    };
    render(<LeftToolbar />);

    expect(screen.getByRole('button', { name: 'Stopping AI multiplayer painting' })).toBeDisabled();
  });

  it('reports an in-flight gesture as stopping instead of already stopped', () => {
    multiplayer = {
      ...multiplayer,
      sessionId: 'portrait-together',
      status: 'active',
      activeGestureId: 'ai-stroke-1',
    };
    mockStopVesselMultiplayerSession.mockReturnValueOnce({ status: 'stopping' });
    render(<LeftToolbar />);

    fireEvent.click(screen.getByRole('button', { name: 'Stop AI multiplayer painting' }));

    expect(mockShowAppFeedback).toHaveBeenCalledWith('Stopping multiplayer…');
  });
});
