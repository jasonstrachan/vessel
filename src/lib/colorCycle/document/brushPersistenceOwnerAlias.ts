const colorCycleBrushPersistenceOwnerAliases = new WeakMap<object, object>();

export const COLOR_CYCLE_RUNTIME_OWNER: unique symbol = Symbol('vessel.colorCycle.runtimeOwner');

export type ColorCycleRuntimeOwnerProvider = {
  [COLOR_CYCLE_RUNTIME_OWNER]?: object | (() => object | null | undefined);
};

const readColorCycleRuntimeOwner = (owner: object): object | null => {
  const runtimeOwner = (owner as ColorCycleRuntimeOwnerProvider)[COLOR_CYCLE_RUNTIME_OWNER];
  if (typeof runtimeOwner === 'function') {
    return runtimeOwner() ?? null;
  }
  return runtimeOwner ?? null;
};

export const registerColorCycleBrushPersistenceOwnerAlias = (
  publicOwner: object,
  storageOwner: object,
): void => {
  colorCycleBrushPersistenceOwnerAliases.set(publicOwner, storageOwner);
};

export const resolveColorCycleBrushPersistenceOwner = (owner: object): object => {
  let resolvedOwner = owner;
  for (let depth = 0; depth < 8; depth += 1) {
    const runtimeOwner = readColorCycleRuntimeOwner(resolvedOwner);
    if (runtimeOwner && runtimeOwner !== resolvedOwner) {
      resolvedOwner = runtimeOwner;
      continue;
    }
    const nextOwner = colorCycleBrushPersistenceOwnerAliases.get(resolvedOwner);
    if (!nextOwner || nextOwner === resolvedOwner) {
      break;
    }
    resolvedOwner = nextOwner;
  }
  return resolvedOwner;
};
