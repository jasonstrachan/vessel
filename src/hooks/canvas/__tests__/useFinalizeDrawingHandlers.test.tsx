import { act, renderHook } from '@testing-library/react';
import { waitForPendingHistoryCommits, trackPendingHistoryCommit } from '@/history/pendingHistoryCommits';
import { runToolFlush } from '@/utils/toolFlushRegistry';
import { useFinalizeDrawingHandlers } from '../useFinalizeDrawingHandlers';

const mockFinalize = jest.fn<Promise<void>, [unknown?]>();
jest.mock('@/hooks/canvas/handlers/finalizeExecution', () => ({ createFinalizeExecutionDispatcher: jest.fn() }));
jest.mock('@/hooks/canvas/handlers/finalizeExecutionDeps', () => ({ createFinalizeAfterQueueDeps: jest.fn() }));
jest.mock('@/hooks/canvas/handlers/buildFinalizePipelineArgs', () => ({ buildFinalizeDrawingDispatcherArgs: jest.fn() }));
jest.mock('@/hooks/canvas/handlers/finalizeDrawingHandlers', () => ({
  createFinalizeDrawingDispatcher: jest.fn(),
  createFinalizeDrawingHandlers: () => ({ finalizeDrawing: mockFinalize, finalizeStroke: jest.fn() }),
}));

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
};
const mount = () => renderHook(() => useFinalizeDrawingHandlers({} as Parameters<typeof useFinalizeDrawingHandlers>[0]));
const microtasks = async () => { for (let index = 0; index < 8; index += 1) await Promise.resolve(); };

beforeEach(() => mockFinalize.mockReset());
afterEach(async () => { await waitForPendingHistoryCommits(); });

it('keeps global idle pending across full finalization before late history registration and revision publication', async () => {
  const capture = deferred(), history = deferred();
  let revision = 14;
  mockFinalize.mockImplementation(async () => {
    await capture.promise;
    const commit = history.promise.then(() => { revision = 15; });
    trackPendingHistoryCommit(commit);
    await commit;
  });
  const { result } = mount();
  let run!: Promise<void>;
  act(() => { run = result.current.finalizeDrawing(false); });
  let observed: number | undefined;
  const idle = waitForPendingHistoryCommits().then(() => { observed = revision; });
  await microtasks();
  const beforeCapture = observed;
  capture.resolve();
  await microtasks();
  const beforeHistory = observed;
  history.resolve();
  await Promise.all([run, idle]);
  expect({ beforeCapture, beforeHistory, observed }).toEqual({ beforeCapture: undefined, beforeHistory: undefined, observed: 15 });
  expect(mockFinalize).toHaveBeenCalledWith(false);
});

it('tracks overlapping full runs independently rather than only the latest local ref', async () => {
  const first = deferred(), second = deferred();
  mockFinalize.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = mount();
  let one!: Promise<void>, two!: Promise<void>;
  act(() => { one = result.current.finalizeDrawing(false); two = result.current.finalizeDrawing(false); });
  let settled = false;
  const idle = waitForPendingHistoryCommits().then(() => { settled = true; });
  second.resolve(); await two; await microtasks();
  const afterSecondOnly = settled;
  first.resolve(); await Promise.all([one, idle]);
  expect(afterSecondOnly).toBe(false);
  expect(settled).toBe(true);
});

it('retains the existing passive tool-flush wait and becomes idle after settlement', async () => {
  const work = deferred(); mockFinalize.mockReturnValue(work.promise);
  const { result } = mount();
  let run!: Promise<void>; act(() => { run = result.current.finalizeDrawing(false); });
  let flushed = false;
  const flush = runToolFlush('drawing-handlers:finalize').then(() => { flushed = true; });
  await microtasks(); expect(flushed).toBe(false);
  work.resolve(); await Promise.all([run, flush]);
  expect(flushed).toBe(true);
  await expect(waitForPendingHistoryCommits()).resolves.toBeUndefined();
});

it('preserves a rejected finalize result while global idle waits for its settlement', async () => {
  let reject!: (error: Error) => void;
  const work = new Promise<void>((_resolve, fail) => { reject = fail; });
  mockFinalize.mockReturnValue(work);
  const { result } = mount();
  let run!: Promise<void>; act(() => { run = result.current.finalizeDrawing(false); });
  const failure = new Error('full finalize failed');
  const resultError = run.catch(error => error);
  let idleSettled = false;
  const idle = waitForPendingHistoryCommits().then(() => { idleSettled = true; });
  await microtasks(); const beforeRejection = idleSettled;
  reject(failure);
  expect(await resultError).toBe(failure);
  await idle;
  expect(beforeRejection).toBe(false);
  await expect(waitForPendingHistoryCommits()).resolves.toBeUndefined();
});
