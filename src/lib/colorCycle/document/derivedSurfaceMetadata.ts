import type { DerivedSurface } from './ColorCycleLayerDocument';

export type VersionedDerivedSurface<T extends object> = T & Pick<DerivedSurface, 'builtFromVersion'>;

export const markDerivedSurfaceBuiltFromVersion = <T extends object>(
  surface: T,
  version: number | null,
): VersionedDerivedSurface<T> => {
  try {
    Object.defineProperty(surface, 'builtFromVersion', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: version,
    });
  } catch {
    (surface as VersionedDerivedSurface<T>).builtFromVersion = version;
  }
  return surface as VersionedDerivedSurface<T>;
};

export const getDerivedSurfaceBuiltFromVersion = (
  surface: object | null | undefined,
): number | null => {
  const value = (surface as Partial<DerivedSurface> | null | undefined)?.builtFromVersion;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
};
