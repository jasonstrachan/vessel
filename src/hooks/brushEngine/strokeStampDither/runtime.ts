export type StampDitherRuntime = {
  baseTiles: Map<string, Uint8Array>;
  tiles: Map<string, Uint8Array>;
  builtFromVersion: number | null;
  imageTileResolverIds: WeakMap<(x: number, y: number) => number | null, number>;
  nextImageTileResolverId: number;
};

export const createStampDitherRuntime = (
  builtFromVersion: number | null = null,
): StampDitherRuntime => ({
  baseTiles: new Map(),
  tiles: new Map(),
  builtFromVersion,
  imageTileResolverIds: new WeakMap(),
  nextImageTileResolverId: 1,
});

export const clearStampDitherRuntime = (
  runtime: StampDitherRuntime,
  builtFromVersion: number | null = runtime.builtFromVersion,
): void => {
  runtime.baseTiles.clear();
  runtime.tiles.clear();
  runtime.imageTileResolverIds = new WeakMap();
  runtime.nextImageTileResolverId = 1;
  runtime.builtFromVersion = builtFromVersion;
};

export const syncStampDitherRuntimeVersion = (
  runtime: StampDitherRuntime,
  builtFromVersion: number | null,
): void => {
  if (runtime.builtFromVersion === builtFromVersion) {
    return;
  }
  clearStampDitherRuntime(runtime, builtFromVersion);
};

export const getImageTileResolverCacheKey = (
  runtime: StampDitherRuntime,
  resolver?: (x: number, y: number) => number | null,
): string => {
  if (!resolver) {
    return 'none';
  }
  let id = runtime.imageTileResolverIds.get(resolver);
  if (!id) {
    id = runtime.nextImageTileResolverId;
    runtime.nextImageTileResolverId += 1;
    runtime.imageTileResolverIds.set(resolver, id);
  }
  return String(id);
};
