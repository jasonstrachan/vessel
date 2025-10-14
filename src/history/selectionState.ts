export interface SelectionPoint {
  x: number;
  y: number;
}

export interface SelectionSnapshot {
  start: SelectionPoint | null;
  end: SelectionPoint | null;
}

export const clonePoint = (point: SelectionPoint | null): SelectionPoint | null =>
  point ? { x: point.x, y: point.y } : null;

export const cloneSelectionSnapshot = (snapshot: SelectionSnapshot): SelectionSnapshot => ({
  start: clonePoint(snapshot.start),
  end: clonePoint(snapshot.end),
});

export const selectionSnapshotFromValues = (
  start: SelectionPoint | null | undefined,
  end: SelectionPoint | null | undefined,
): SelectionSnapshot => normalizeSelectionSnapshot({
  start: clonePoint(start ?? null),
  end: clonePoint(end ?? null),
});

export const normalizeSelectionSnapshot = (snapshot: SelectionSnapshot): SelectionSnapshot => {
  const hasStart = Boolean(snapshot.start);
  const hasEnd = Boolean(snapshot.end);
  if (hasStart && hasEnd) {
    return {
      start: clonePoint(snapshot.start),
      end: clonePoint(snapshot.end),
    };
  }
  return {
    start: null,
    end: null,
  };
};

const pointsEqual = (a: SelectionPoint | null, b: SelectionPoint | null): boolean => {
  if (a === b) {
    return true;
  }
  if (!a || !b) {
    return false;
  }
  return a.x === b.x && a.y === b.y;
};

export const selectionSnapshotsEqual = (a: SelectionSnapshot, b: SelectionSnapshot): boolean => {
  const normalizedA = normalizeSelectionSnapshot(a);
  const normalizedB = normalizeSelectionSnapshot(b);
  return (
    pointsEqual(normalizedA.start, normalizedB.start) &&
    pointsEqual(normalizedA.end, normalizedB.end)
  );
};
