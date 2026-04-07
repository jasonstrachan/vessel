export const MIN_COLOR_CYCLE_DEF_ID = 1;
export const MAX_COLOR_CYCLE_DEF_ID = 0xffff;
export const EXHAUSTED_COLOR_CYCLE_DEF_ID = MAX_COLOR_CYCLE_DEF_ID + 1;

const toSortedUniqueIds = (ids: Iterable<number>): number[] => {
  const used = new Set<number>();
  for (const value of ids) {
    const id = Math.floor(Number(value));
    if (!Number.isFinite(id)) {
      continue;
    }
    if (id < MIN_COLOR_CYCLE_DEF_ID || id > MAX_COLOR_CYCLE_DEF_ID) {
      continue;
    }
    used.add(id);
  }
  return [...used].sort((a, b) => a - b);
};

const normalizeStartId = (nextId?: number | null): number => {
  const id = Math.floor(Number(nextId));
  if (!Number.isFinite(id) || id < MIN_COLOR_CYCLE_DEF_ID || id > MAX_COLOR_CYCLE_DEF_ID) {
    return MIN_COLOR_CYCLE_DEF_ID;
  }
  return id;
};

export const findNextAvailableColorCycleDefId = (
  ids: Iterable<number>,
  nextId?: number | null
): number | null => {
  const usedIds = toSortedUniqueIds(ids);
  if (usedIds.length >= MAX_COLOR_CYCLE_DEF_ID) {
    return null;
  }

  const used = new Set<number>(usedIds);
  const startId = normalizeStartId(nextId);

  for (let id = startId; id <= MAX_COLOR_CYCLE_DEF_ID; id += 1) {
    if (!used.has(id)) {
      return id;
    }
  }
  for (let id = MIN_COLOR_CYCLE_DEF_ID; id < startId; id += 1) {
    if (!used.has(id)) {
      return id;
    }
  }
  return null;
};

export const normalizeNextColorCycleDefId = (
  ids: Iterable<number>,
  nextId?: number | null
): number => findNextAvailableColorCycleDefId(ids, nextId) ?? EXHAUSTED_COLOR_CYCLE_DEF_ID;

export const allocateNextColorCycleDefId = (params: {
  ids: Iterable<number>;
  nextId?: number | null;
  preferredId?: number | null;
}): { id: number | null; nextGradientDefId: number } => {
  const usedIds = toSortedUniqueIds(params.ids);
  const used = new Set<number>(usedIds);
  const preferredId = Math.floor(Number(params.preferredId));

  let allocatedId: number | null = null;
  if (
    Number.isFinite(preferredId) &&
    preferredId >= MIN_COLOR_CYCLE_DEF_ID &&
    preferredId <= MAX_COLOR_CYCLE_DEF_ID &&
    !used.has(preferredId)
  ) {
    allocatedId = preferredId;
  } else {
    allocatedId = findNextAvailableColorCycleDefId(usedIds, params.nextId);
  }

  if (allocatedId === null) {
    return { id: null, nextGradientDefId: EXHAUSTED_COLOR_CYCLE_DEF_ID };
  }

  used.add(allocatedId);
  return {
    id: allocatedId,
    nextGradientDefId: normalizeNextColorCycleDefId(used, allocatedId + 1),
  };
};
