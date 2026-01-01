/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHistorySlice } from '@/stores/slices/historySlice';

jest.mock('@/stores/helpers/historyLifecycle', () => ({
  __esModule: true,
  createHistoryService: jest.fn(() => ({
    undo: jest.fn(),
    redo: jest.fn(),
    canUndo: jest.fn(() => false),
    canRedo: jest.fn(() => false),
    clearHistory: jest.fn(),
  })),
}));

jest.mock('@/history/historyService', () => ({
  __esModule: true,
  default: {
    setMaxEntries: jest.fn(),
  },
}));

const mockedHistory = jest.requireMock('@/history/historyService').default as {
  setMaxEntries: jest.Mock;
};

const mockedLifecycle = jest.requireMock('@/stores/helpers/historyLifecycle') as {
  createHistoryService: jest.Mock;
};

type MutableState = Record<string, any>;

const createTestStore = (overrides: MutableState = {}) => {
  let state: MutableState = {
    history: { maxHistorySize: 50 },
    ...overrides,
  };

  const set = (updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...next };
    return state;
  };

  const get = () => state;
  const runWithColorCycleSuspended = async <T,>(_: any, fn: () => T | Promise<T>) => fn();
  const slice = (createHistorySlice as any)({ runWithColorCycleSuspended })(set, get);
  state = { ...state, ...slice };

  return {
    ...slice,
    getState: () => state,
    runWithColorCycleSuspended,
  };
};

describe('history slice', () => {
  beforeEach(() => {
    mockedHistory.setMaxEntries.mockClear();
    mockedLifecycle.createHistoryService.mockClear();
  });

  it('wires history service with color cycle suspension handler', () => {
    const store = createTestStore();
    expect(mockedLifecycle.createHistoryService).toHaveBeenCalledWith(
      expect.objectContaining({
        runWithColorCycleSuspended: store.runWithColorCycleSuspended,
      }),
    );
  });

  it('sets history size and forwards to history manager', () => {
    const store = createTestStore();
    store.setHistorySize(64);

    expect(store.getState().history.maxHistorySize).toBe(64);
    expect(mockedHistory.setMaxEntries).toHaveBeenCalledWith(64);
  });
});
