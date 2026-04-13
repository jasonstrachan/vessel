import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LeftToolbar from '../LeftToolbar';

const mockSwitchTool = jest.fn().mockResolvedValue(undefined);

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
    mockStore.setBrushPanelSection.mockImplementation((section: 'tool' | 'filters') => {
      mockStore.ui.brushPanelSection = section;
    });
  });

  it('marks the active tool button as pressed and annotates shortcuts', () => {
    render(<LeftToolbar />);

    const brushButton = screen.getByRole('button', { name: /brush \(b\)/i });
    expect(brushButton).toHaveAttribute('aria-pressed', 'true');
    expect(brushButton).toHaveAttribute('data-shortcut', 'B');
  });

  it('invokes the tool switcher for standard tool clicks', async () => {
    render(<LeftToolbar />);

    const customButton = screen.getByRole('button', { name: /custom brush/i });
    fireEvent.click(customButton);

    await waitFor(() => {
      expect(mockSwitchTool).toHaveBeenCalledWith('custom');
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
});
