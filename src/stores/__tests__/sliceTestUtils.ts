/* eslint-disable @typescript-eslint/no-explicit-any */
type MutableState = Record<string, any>;

export const createSliceTestStore = <TSlice>(
  createSlice: (set: (updater: any) => void, get: () => MutableState) => TSlice,
  overrides: MutableState = {}
): { slice: TSlice; getState: () => MutableState; setState: (partial: MutableState) => void } => {
  let state: MutableState = {
    ...overrides,
  };

  const set = (updater: any) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    state = { ...state, ...next };
    return state;
  };

  const get = () => state;
  const slice = createSlice(set, get);
  state = { ...state, ...slice, ...overrides };

  return {
    slice,
    getState: () => state,
    setState: (partial: MutableState) => {
      state = { ...state, ...partial };
    },
  };
};
