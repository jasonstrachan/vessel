import { flushAndSetCurrentTool, subscribeToolSelection } from '../toolSwitch';
import { flushPendingToolWork } from '../toolFlushRegistry';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('../toolFlushRegistry', () => ({ flushPendingToolWork: jest.fn(async () => {}) }));
jest.mock('@/stores/useAppStore', () => ({ useAppStore: { getState: jest.fn() } }));

test('reselecting Brush notifies before flushing and setting the tool', async () => {
  const order: string[] = [];
  jest.mocked(flushPendingToolWork).mockImplementation(async () => { order.push('flush'); });
  jest.mocked(useAppStore.getState).mockReturnValue({ setCurrentTool: () => order.push('tool') } as unknown as ReturnType<typeof useAppStore.getState>);
  const stop = subscribeToolSelection(() => order.push('selection'));
  try {
    await flushAndSetCurrentTool('brush');
    await flushAndSetCurrentTool('brush');
    expect(order).toEqual(['selection', 'flush', 'tool', 'selection', 'flush', 'tool']);
  } finally { stop(); }
  order.length = 0;
  await flushAndSetCurrentTool('brush');
  expect(order).toEqual(['flush', 'tool']);
});
