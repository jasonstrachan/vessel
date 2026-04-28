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

  it('skips active flush tasks during passive-only flushes', async () => {
    const activeKey = `${TEST_KEY}:active`;
    const steps: string[] = [];

    registerToolFlush(TEST_KEY, () => {
      steps.push('passive');
    });
    registerToolFlush(activeKey, () => {
      steps.push('active');
    }, {
      passive: false,
    });

    await flushPendingToolWork({ passiveOnly: true });

    expect(steps).toEqual(['passive']);

    unregisterToolFlush(activeKey);
  });
});
