import { flushPendingToolWork, registerToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';

describe('toolFlushRegistry', () => {
  const TEST_KEY = 'tool-flush:test';

  afterEach(() => {
    unregisterToolFlush(TEST_KEY);
  });

  it('awaits asynchronous flush tasks before resolving', async () => {
    const steps: string[] = [];
    registerToolFlush(TEST_KEY, async () => {
      steps.push('start');
      await new Promise(resolve => setTimeout(resolve, 5));
      steps.push('end');
    });

    await flushPendingToolWork();

    expect(steps).toEqual(['start', 'end']);
  });
});
