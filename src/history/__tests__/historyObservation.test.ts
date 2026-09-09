import { HistoryManager } from '../historyManager';
import { prepareHistoryDelta, type HistoryObservation } from '../actionTypes';

const manager = (maxEntries = 2) => new HistoryManager({
  maxEntries,
  runtimeRehydration: {
    createTargets: () => ({ layerIds: new Set(), colorCycleLayerIds: new Set(), sequentialLayerIds: new Set(), workerScopes: new Set() }),
    rehydrate: async () => {},
  },
});

test('observers see each accepted transaction even when undo coalesces and trims', () => {
  const history = manager();
  const observations: HistoryObservation[] = [];
  history.subscribe(event => observations.push(event));
  for (let i = 0; i < 55; i += 1) {
    const txn = history.begin('brush-stroke', {}, undefined, i < 2 ? { coalesce: { key: 'stroke' } } : undefined);
    txn.push({ _tag: 'test', prepare: () => prepareHistoryDelta('test', () => {}, () => false, () => {}) });
    txn.commit('Stroke');
  }
  expect(observations).toHaveLength(55);
  expect(observations[0].entry.deltas).toHaveLength(1);
  expect(observations[1].entry.deltas).toHaveLength(1);
  expect(new Set(observations.map(event => event.entry.id)).size).toBe(55);
  expect(history.entries()).toHaveLength(2);
});

test('undo and redo identify all constituent commits and notify only after state applies', async () => {
  const history = manager();
  let value = 0;
  const observed: { event: HistoryObservation; value: number }[] = [];
  history.subscribe(event => observed.push({ event, value }));
  for (let i = 0; i < 2; i += 1) {
    value += 1;
    const txn = history.begin('brush-stroke', {}, undefined, { coalesce: { key: 'stroke' } });
    txn.push({ _tag: 'test', prepare: direction => prepareHistoryDelta('test', () => { value += direction === 'forward' ? 1 : -1; }, () => true, () => {}) });
    txn.commit('Stroke');
  }
  await history.undo();
  expect(observed.at(-1)?.value).toBe(0);
  expect(observed.at(-1)?.event.entry.transactionIds).toHaveLength(2);
  await history.redo();
  expect(observed.at(-1)?.value).toBe(2);
  expect(observed.at(-1)?.event.kind).toBe('redo');
});

test('cancelled transactions and failed undo are never reported as accepted changes', async () => {
  const history = manager();
  const observe = jest.fn(); history.subscribe(observe);
  history.begin('brush-stroke').cancel();
  const txn = history.begin('brush-stroke');
  txn.push({ _tag: 'test', prepare: () => { throw new Error('missing payload'); } });
  txn.commit('Stroke');
  await expect(history.undo()).rejects.toThrow();
  expect(observe).toHaveBeenCalledTimes(1);
});

test('transient observation data never enters undo history', () => {
  const history = manager(); const events: HistoryObservation[] = [];
  history.subscribe(event => events.push(event));
  const payload = { pixels: new Uint8Array([1, 2, 3]) };
  const txn = history.begin('brush-stroke', {}, undefined, { observationData: payload });
  txn.push({ _tag: 'test', prepare: () => prepareHistoryDelta('test', () => {}, () => false, () => {}) });
  txn.commit('Stroke');
  expect(events[0].data).toBe(payload);
  expect(history.entries()[0]).not.toHaveProperty('data');
  expect(history.entries()[0].meta).not.toHaveProperty('pixels');
});
