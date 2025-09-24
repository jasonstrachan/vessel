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
  const originalValues = new Map<BrushSettingsKey, BrushSettings[BrushSettingsKey] | undefined>();

  (Object.keys(patch) as BrushSettingsKey[]).forEach((key) => {
    originalValues.set(key, target[key]);
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      target[key] = patch[key] as BrushSettings[BrushSettingsKey];
    }
  });

  try {
    return callback(target);
  } finally {
    originalValues.forEach((value, key) => {
      if (value === undefined) {
        delete target[key];
      } else {
        target[key] = value;
      }
    });
  }
};

