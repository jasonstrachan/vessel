import type { BrushSettings } from '@/types';

type BrushSettingsKey = keyof BrushSettings;

/**
 * Temporarily apply a patch of brush settings, execute a callback, then restore the originals.
 * This keeps previews deterministic without permanently mutating shared state.
 */
export const withTemporaryBrushSettings = <T>(
  target: BrushSettings,
  patch: Partial<BrushSettings>,
  callback: (settings: BrushSettings) => T
): T => {
  const mutableTarget = target as Record<BrushSettingsKey, BrushSettings[BrushSettingsKey] | undefined>;
  const originalValues = new Map<BrushSettingsKey, BrushSettings[BrushSettingsKey] | undefined>();

  (Object.keys(patch) as BrushSettingsKey[]).forEach((key) => {
    if (!Object.prototype.hasOwnProperty.call(patch, key)) {
      return;
    }

    const nextValue = patch[key];
    originalValues.set(key, mutableTarget[key]);

    if (nextValue === undefined) {
      delete mutableTarget[key];
    } else {
      mutableTarget[key] = nextValue as BrushSettings[BrushSettingsKey];
    }
  });

  try {
    return callback(target);
  } finally {
    originalValues.forEach((value, key) => {
      if (value === undefined) {
        delete mutableTarget[key];
      } else {
        mutableTarget[key] = value;
      }
    });
  }
};
