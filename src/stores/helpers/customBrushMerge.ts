import type { CustomBrush, Project } from '@/types';

export const mergeCustomBrushCollections = (
  projectBrushes: Project['customBrushes'] | undefined,
  storedBrushes: CustomBrush[] | undefined
): CustomBrush[] => {
  const merged = new Map<string, CustomBrush>();
  (storedBrushes ?? []).forEach((brush) => merged.set(brush.id, brush));
  (projectBrushes ?? []).forEach((brush) => merged.set(brush.id, brush));
  return Array.from(merged.values());
};

export const resolveStoredDefaultBrushId = (
  incomingDefault: string | null,
  mergedBrushes: CustomBrush[],
  storedDefault: string | null
): string | null => {
  if (storedDefault && mergedBrushes.some((brush) => brush.id === storedDefault)) {
    return storedDefault;
  }
  if (incomingDefault && mergedBrushes.some((brush) => brush.id === incomingDefault)) {
    return incomingDefault;
  }
  return null;
};
