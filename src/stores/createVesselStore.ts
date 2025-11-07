import { create } from 'zustand';
import type { StateCreator, StoreApi, UseBoundStore } from 'zustand';
import type { UseBoundStoreWithEqualityFn } from 'zustand/traditional';
import {
  devtools,
  subscribeWithSelector,
  type DevtoolsOptions,
} from 'zustand/middleware';

type CreateOptions = {
  devtools?: DevtoolsOptions;
  devtoolsEnabled?: boolean;
};

type AnyStateCreator<T> = StateCreator<T, [], []>;

export const createVesselStore = <TState>(
  initializer: AnyStateCreator<TState>,
  options?: CreateOptions
): UseBoundStoreWithEqualityFn<StoreApi<TState>> => {
  const shouldEnableDevtools =
    (options?.devtoolsEnabled ?? process.env.NODE_ENV !== 'production') !== false;

  const withDevtools = shouldEnableDevtools
    ? (devtools(initializer, options?.devtools) as AnyStateCreator<TState>)
    : initializer;

  const withSubscribe = subscribeWithSelector(
    withDevtools as unknown as StateCreator<
      TState,
      [['zustand/subscribeWithSelector', never]],
      []
    >
  ) as AnyStateCreator<TState>;

  return create<TState>()(withSubscribe) as UseBoundStoreWithEqualityFn<StoreApi<TState>>;
};

export const createSelectors = <TState>(
  store: UseBoundStore<StoreApi<TState>>
) => {
  const useStore = <U>(selector: (state: TState) => U) => store(selector);
  return { useStore };
};
