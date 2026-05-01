import type { SelectionActionProvenance } from '@/stores/slices/selectionSlice';

export interface SelectionPoint {
  x: number;
  y: number;
}

export interface SelectionSnapshot {
  start: SelectionPoint | null;
  end: SelectionPoint | null;
  provenance?: Partial<SelectionActionProvenance> | null;
}

export const clonePoint = (point: SelectionPoint | null): SelectionPoint | null =>
  point ? { x: point.x, y: point.y } : null;

export const cloneSelectionSnapshot = (snapshot: SelectionSnapshot): SelectionSnapshot => ({
  start: clonePoint(snapshot.start),
  end: clonePoint(snapshot.end),
  provenance: snapshot.provenance
    ? {
        ...snapshot.provenance,
        bounds: snapshot.provenance.bounds ? { ...snapshot.provenance.bounds } : snapshot.provenance.bounds,
      }
    : null,
});

export const selectionSnapshotFromValues = (
  start: SelectionPoint | null | undefined,
  end: SelectionPoint | null | undefined,
  provenance?: Partial<SelectionActionProvenance> | null,
): SelectionSnapshot => normalizeSelectionSnapshot({
  start: clonePoint(start ?? null),
  end: clonePoint(end ?? null),
  provenance: provenance ?? null,
});

export const normalizeSelectionSnapshot = (snapshot: SelectionSnapshot): SelectionSnapshot => {
  const hasStart = Boolean(snapshot.start);
  const hasEnd = Boolean(snapshot.end);
  if (hasStart && hasEnd) {
    return {
      start: clonePoint(snapshot.start),
      end: clonePoint(snapshot.end),
      provenance: snapshot.provenance
        ? {
            ...snapshot.provenance,
            bounds: snapshot.provenance.bounds ? { ...snapshot.provenance.bounds } : snapshot.provenance.bounds,
          }
        : null,
    };
  }
  return {
    start: null,
    end: null,
    provenance: null,
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
