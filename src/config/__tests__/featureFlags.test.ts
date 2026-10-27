import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';

import ts from 'typescript';
import { act, renderHook } from '@testing-library/react';

import {
  featureFlags,
  isFeatureFlagEnabled,
  resetFeatureFlags,
  setFeatureFlag,
  useFeatureFlag,
  type FeatureFlagKey,
} from '@/config/featureFlags';
import {
  disposeColorCycleBrushManager,
  getColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';

jest.mock('@/utils/debug', () => ({
  debugLog: jest.fn(),
  debugWarn: jest.fn(),
  logError: jest.fn(),
}));

const defaults: Record<FeatureFlagKey, boolean> = {
  useCanvas2DColorCycle: false,
  logColorCycleOperations: false,
  useColorCycleWorker: true,
  enableSequentialRecordMode: true,
  enableSequentialGpuAcceleration: false,
  enableSequentialWorkerMaterialization: true,
  enableSequentialTemporalDistribution: true,
  enableSequentialTypedQueueDebtControl: true,
  enableSequentialDirtyRunPatch: true,
};
const keys = Object.keys(defaults) as FeatureFlagKey[];
const eventTypes = ['vessel:featureFlagChange', 'feature-flag-changed'] as const;

describe('feature flag Reset uses the ordinary live-consumer contract', () => {
  const events: Array<{ type: string; key: FeatureFlagKey; value: boolean; stored: string | null }> = [];
  const listener = (event: Event) => {
    const { key, value } = (event as CustomEvent<{ key: FeatureFlagKey; value: boolean }>).detail;
    events.push({ type: event.type, key, value, stored: localStorage.getItem(`vessel:flag:${key}`) });
  };

  beforeEach(() => {
    disposeColorCycleBrushManager();
    for (const key of keys) setFeatureFlag(key, defaults[key]);
    localStorage.clear();
    events.length = 0;
    for (const type of eventTypes) window.addEventListener(type, listener);
  });
  afterEach(() => {
    for (const type of eventTypes) window.removeEventListener(type, listener);
    disposeColorCycleBrushManager();
    jest.restoreAllMocks();
    localStorage.clear();
  });

  it('updates the existing manager consumer when Reset returns Canvas2D to WebGL', () => {
    const manager = getColorCycleBrushManager();
    const implementation = jest.spyOn(manager, 'setCanvasImplementation');
    setFeatureFlag('useCanvas2DColorCycle', true);
    expect(implementation).toHaveBeenLastCalledWith(true);
    implementation.mockClear();

    resetFeatureFlags();

    expect(getColorCycleBrushManager()).toBe(manager);
    expect(implementation).toHaveBeenCalledTimes(1);
    expect(implementation).toHaveBeenCalledWith(false);
    expect(isFeatureFlagEnabled('useCanvas2DColorCycle')).toBe(false);
    expect(localStorage.getItem('vessel:flag:useCanvas2DColorCycle')).toBe('false');
  });

  it('emits both ordered events only for changed flags, after persisting defaults', () => {
    for (const key of ['useColorCycleWorker', 'logColorCycleOperations', 'useCanvas2DColorCycle'] as const) {
      setFeatureFlag(key, !defaults[key]);
    }
    events.length = 0;
    const write = jest.spyOn(Storage.prototype, 'setItem');
    const remove = jest.spyOn(Storage.prototype, 'removeItem');

    resetFeatureFlags();

    const changed = ['useCanvas2DColorCycle', 'logColorCycleOperations', 'useColorCycleWorker'] as const;
    expect(events).toEqual(changed.flatMap(key => eventTypes.map(type => ({
      type, key, value: defaults[key], stored: String(defaults[key]),
    }))));
    expect(write.mock.calls).toEqual(changed.map(key => [`vessel:flag:${key}`, String(defaults[key])]));
    expect(remove).not.toHaveBeenCalled();
    expect(featureFlags).toEqual(defaults);
  });

  it('updates subscribed React state once and keeps repeat Reset idempotent', () => {
    const hook = renderHook(() => useFeatureFlag('useCanvas2DColorCycle'));
    act(() => setFeatureFlag('useCanvas2DColorCycle', true));
    expect(hook.result.current).toBe(true);
    events.length = 0;
    act(() => resetFeatureFlags());
    expect(hook.result.current).toBe(false);
    expect(events).toHaveLength(2);
    events.length = 0;
    const write = jest.spyOn(Storage.prototype, 'setItem');
    act(() => resetFeatureFlags());
    expect(events).toEqual([]);
    expect(write).not.toHaveBeenCalled();
    hook.unmount();
  });

  it('still notifies runtime consumers and subscribers when persistence fails', () => {
    const manager = getColorCycleBrushManager();
    const implementation = jest.spyOn(manager, 'setCanvasImplementation');
    const hook = renderHook(() => useFeatureFlag('useCanvas2DColorCycle'));
    act(() => setFeatureFlag('useCanvas2DColorCycle', true));
    implementation.mockClear();
    events.length = 0;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Declared storage failure'); });

    expect(() => act(() => resetFeatureFlags())).not.toThrow();

    expect(hook.result.current).toBe(false);
    expect(implementation).toHaveBeenCalledWith(false);
    expect(events.map(({ type, key, value }) => ({ type, key, value }))).toEqual(eventTypes.map(type => ({
      type, key: 'useCanvas2DColorCycle', value: false,
    })));
    expect(localStorage.getItem('vessel:flag:useCanvas2DColorCycle')).toBe('true');
    hook.unmount();
  });

  it('a default-valued Reset does not create storage or notify consumers', () => {
    const implementation = jest.spyOn(getColorCycleBrushManager(), 'setCanvasImplementation');
    const write = jest.spyOn(Storage.prototype, 'setItem');
    resetFeatureFlags();
    expect(events).toEqual([]);
    expect(implementation).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
  });
});


it('keeps Reset safe in a server realm without window or storage', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'src/config/featureFlags.ts'), 'utf8');
  const compiled = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
  const exported: Record<string, unknown> = {};
  vm.runInNewContext(compiled, {
    exports: exported,
    process: { env: { NODE_ENV: 'production' } },
    require: (name: string) => {
      if (name === '@/utils/debug') return { debugLog: () => {}, debugWarn: () => {}, logError: () => {} };
      if (name === 'react') return {};
      throw new Error(`Unexpected server dependency ${name}`);
    },
  });
  const flags = exported as unknown as typeof import('@/config/featureFlags');
  flags.setFeatureFlag('useColorCycleWorker', false);
  expect(flags.isFeatureFlagEnabled('useColorCycleWorker')).toBe(false);
  expect(() => flags.resetFeatureFlags()).not.toThrow();
  expect(flags.isFeatureFlagEnabled('useColorCycleWorker')).toBe(true);
});
