import { flushPendingToolWork, registerToolFlush, runToolFlush, unregisterToolFlush } from '@/utils/toolFlushRegistry';

describe('toolFlushRegistry', () => {
  const TEST_KEY = 'tool-flush:test';

  afterEach(() => {
    unregisterToolFlush(TEST_KEY);
    unregisterToolFlush(`${TEST_KEY}:other`);
  });

  it('runs and awaits only the requested active owner', async () => {
    const steps: string[] = [];
    let release = () => {};
    registerToolFlush(`${TEST_KEY}:other`, () => { steps.push('unrelated'); });
    registerToolFlush(TEST_KEY, async () => {
      steps.push('start');
      await new Promise<void>(resolve => { release = resolve; });
      steps.push('end');
    }, { passive: false });

    const pending = runToolFlush(TEST_KEY);
    await Promise.resolve();
    expect(steps).toEqual(['start']);
    release();
    await expect(pending).resolves.toBe(true);
    expect(steps).toEqual(['start', 'end']);
  });

  it('reports an absent owner without running another registration', async () => {
    const other = jest.fn();
    registerToolFlush(`${TEST_KEY}:other`, other);
    await expect(runToolFlush(TEST_KEY)).resolves.toBe(false);
    expect(other).not.toHaveBeenCalled();
  });

  it('propagates the requested owner rejection without broad fallback', async () => {
    const error = new Error('Commit rejected');
    const other = jest.fn();
    registerToolFlush(`${TEST_KEY}:other`, other);
    registerToolFlush(TEST_KEY, async () => { throw error; }, { passive: false });
    await expect(runToolFlush(TEST_KEY)).rejects.toBe(error);
    expect(other).not.toHaveBeenCalled();
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
