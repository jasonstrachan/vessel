import {
  __setSequentialSettingsStorageOverride,
  loadSequentialSettings,
  saveSequentialSettings,
} from '@/utils/sequentialSettingsStorage';

describe('sequentialSettingsStorage', () => {
  beforeEach(() => {
    localStorage.clear();
    __setSequentialSettingsStorageOverride(window.localStorage);
  });

  afterEach(() => {
    __setSequentialSettingsStorageOverride(null);
  });

  it('saves and loads sanitized time smear values', () => {
    saveSequentialSettings({ timeSmear: 240 });

    expect(window.localStorage.getItem('vessel:sequential-settings')).toBe(
      JSON.stringify({ timeSmear: 160 })
    );
    expect(loadSequentialSettings()).toEqual({ timeSmear: 160 });
  });

  it('saves and loads bounded temporal controls', () => {
    saveSequentialSettings({
      temporalSpreadFrames: 99,
      trailFalloff: -1,
      burstFrames: 4.4,
      gapFrames: 3.6,
    });

    expect(loadSequentialSettings()).toEqual({
      temporalSpreadFrames: 32,
      trailFalloff: 0,
      burstFrames: 4,
      gapFrames: 4,
    });
  });

  it('returns null for invalid payloads', () => {
    window.localStorage.setItem('vessel:sequential-settings', JSON.stringify({ timeSmear: 'oops' }));
    expect(loadSequentialSettings()).toBeNull();
  });
});
