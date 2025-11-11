import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import LeftToolbar from '../LeftToolbar';

const mockSwitchTool = jest.fn().mockResolvedValue(undefined);

jest.mock('@/utils/toolSwitch', () => ({
  useToolSwitcher: () => mockSwitchTool,
}));

jest.mock('@/stores/useAppStore', () => {
  const mockStore = {
    tools: { currentTool: 'brush' },
    saveProject: jest.fn().mockResolvedValue(undefined),
    toggleModal: jest.fn(),
  };
  const mock = jest.fn(() => mockStore);
  mock.getState = () => mockStore;
  mock.setState = jest.fn();
  mock.subscribe = jest.fn(() => () => {});
  return {
    useAppStore: mock,
    __mockStore: mockStore,
  };
});

const { useAppStore: useAppStoreMock, __mockStore: mockStore } = require('@/stores/useAppStore') as {
  useAppStore: jest.Mock;
  __mockStore: {
    tools: { currentTool: string };
    saveProject: jest.Mock;
    toggleModal: jest.Mock;
  };
};

describe('LeftToolbar accessibility', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockStore.tools.currentTool = 'brush';
  });

  it('marks the active tool button as pressed and annotates shortcuts', () => {
    render(<LeftToolbar />);

    const brushButton = screen.getByRole('button', { name: /^brush$/i });
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

  it('routes save actions through the store API for accessibility buttons', async () => {
    render(<LeftToolbar />);

    fireEvent.click(screen.getByRole('button', { name: /save file/i }));

    await waitFor(() => {
      expect(mockStore.saveProject).toHaveBeenCalledTimes(1);
    });
  });
});
