const noop = () => {};

const makeResolved = () => Promise.resolve();
type MockClient = {
  ping: () => Promise<void>;
  requestFrame: () => Promise<void>;
  ensureLayer: () => Promise<void>;
  disposeLayer: () => Promise<void>;
  onFrame: () => () => void;
  dispose: () => void;
};

const mockClient: MockClient = {
  ping: makeResolved,
  requestFrame: makeResolved,
  ensureLayer: () => Promise.resolve(),
  disposeLayer: () => Promise.resolve(),
  onFrame: () => noop,
  dispose: noop,
};

export const getColorCycleCompositorClient = () => Promise.resolve(mockClient);

export const __mockColorCycleCompositorClient = mockClient;
