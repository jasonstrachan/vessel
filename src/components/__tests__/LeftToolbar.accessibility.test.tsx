import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LeftToolbar from '../LeftToolbar';

const mockSwitchTool = jest.fn().mockResolvedValue(undefined);

jest.mock('@/utils/toolSwitch', () => ({
  useToolSwitcher: () => mockSwitchTool,
}));

type ToolbarStore = {
  tools: { currentTool: string; selectionMode?: string };
  ui: { grid: { enabled: boolean } };
  saveProject: jest.Mock;
  toggleGrid: jest.Mock;
  toggleModal: jest.Mock;
  setSelectionMode: jest.Mock;
};

const mockStore: ToolbarStore = {
  tools: { currentTool: 'brush', selectionMode: 'marquee' },
  ui: { grid: { enabled: false } },
  saveProject: jest.fn().mockResolvedValue(undefined),
  toggleGrid: jest.fn(),
  toggleModal: jest.fn(),
  setSelectionMode: jest.fn(),
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
});
