import { BrushShape } from '@/types';
import { useAppStore, selectEffectiveColorCyclePlaying } from '@/stores/useAppStore';
import { pauseColorCycleForNonCCInteraction, resumeColorCycleAfterInteraction } from '../colorCycleInteraction';

it.each(['resume', 'user-pause', 'nested-hold', 'already-paused', 'existing-hold'])('releases only the painting hold: %s', async scenario => {
  const original = useAppStore.getState();
  useAppStore.setState({
    layers: [], activeLayerId: null,
    tools: { ...original.tools, brushSettings: { ...original.tools.brushSettings, brushShape: BrushShape.COLOR_CYCLE } },
    sequentialRecord: { ...original.sequentialRecord, isPointerDown: false },
    colorCyclePlayback: { ...original.colorCyclePlayback, desiredPlaying: scenario !== 'already-paused', suspendDepth: scenario === 'existing-hold' ? 1 : 0 },
  });
  const shouldResumeRef = { current: false };
  const deps = { shouldResumeRef, recolorWasAnimatingRef: { current: false },
    storeRef: { get current() { return useAppStore.getState(); } },
    getEffectiveColorCyclePlaying: () => selectEffectiveColorCyclePlaying(useAppStore.getState()),
    pauseAllBrushCCAnimationsNow: jest.fn(() => true), ccLog: jest.fn(), ccGroup: jest.fn(), ccGroupEnd: jest.fn() };
  try {
    pauseColorCycleForNonCCInteraction({ ...deps, reason: 'brush-stroke' });
    pauseColorCycleForNonCCInteraction({ ...deps, reason: 'brush-stroke' });
    expect(useAppStore.getState().colorCyclePlayback.suspendDepth).toBe(scenario === 'existing-hold' ? 2 : 1);
    expect(selectEffectiveColorCyclePlaying(useAppStore.getState())).toBe(false);
    expect(deps.pauseAllBrushCCAnimationsNow).not.toHaveBeenCalled();
    if (scenario === 'nested-hold') useAppStore.getState().suspendColorCycle('pan');
    if (scenario === 'user-pause') useAppStore.getState().pauseColorCycle('toolbar');
    await resumeColorCycleAfterInteraction(deps);
    await resumeColorCycleAfterInteraction(deps);
    expect(useAppStore.getState().colorCyclePlayback.suspendDepth).toBe(scenario === 'nested-hold' || scenario === 'existing-hold' ? 1 : 0);
    expect(selectEffectiveColorCyclePlaying(useAppStore.getState())).toBe(scenario === 'resume');
  } finally { useAppStore.setState(original, true); }
});
