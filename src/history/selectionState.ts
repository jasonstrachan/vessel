import type { SelectionActionProvenance, SelectionSlice } from '@/stores/slices/selectionSlice';
import type { Rectangle } from '@/types';

export interface SelectionPoint {
  x: number;
  y: number;
}

interface SelectionMaskSnapshot {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface SelectionSnapshot {
  start: SelectionPoint | null;
  end: SelectionPoint | null;
  provenance?: Partial<SelectionActionProvenance> | null;
  mask?: SelectionMaskSnapshot | null;
  maskBounds?: Rectangle | null;
  maskLayerId?: string | null;
  vectorPath?: SelectionSlice['selectionVectorPath'];
}

type SelectionSnapshotSource = Pick<SelectionSlice,
  'selectionStart' | 'selectionEnd' | 'selectionLastAction' | 'selectionMask' |
  'selectionMaskBounds' | 'selectionMaskLayerId' | 'selectionVectorPath'>;

export const clonePoint = (point: SelectionPoint | null): SelectionPoint | null =>
  point ? { x: point.x, y: point.y } : null;

export const normalizeSelectionSnapshot = (snapshot: SelectionSnapshot): SelectionSnapshot => {
  if (!snapshot.start || !snapshot.end) {
    return { start: null, end: null, provenance: null, mask: null, maskBounds: null, maskLayerId: null, vectorPath: null };
  }
  return {
    start: clonePoint(snapshot.start),
    end: clonePoint(snapshot.end),
    provenance: snapshot.provenance
      ? { ...snapshot.provenance, bounds: snapshot.provenance.bounds ? { ...snapshot.provenance.bounds } : snapshot.provenance.bounds }
      : null,
    mask: snapshot.mask
      ? { width: snapshot.mask.width, height: snapshot.mask.height, data: new Uint8ClampedArray(snapshot.mask.data) }
      : null,
    maskBounds: snapshot.maskBounds ? { ...snapshot.maskBounds } : null,
    maskLayerId: snapshot.maskLayerId ?? null,
    vectorPath: snapshot.vectorPath
      ? { mode: snapshot.vectorPath.mode, points: snapshot.vectorPath.points.map((point) => ({ ...point })) }
      : null,
  };
};

export const cloneSelectionSnapshot = (snapshot: SelectionSnapshot): SelectionSnapshot =>
  normalizeSelectionSnapshot(snapshot);

export const selectionSnapshotFromValues = (
  start: SelectionPoint | null | undefined,
  end: SelectionPoint | null | undefined,
  provenance?: Partial<SelectionActionProvenance> | null,
): SelectionSnapshot => normalizeSelectionSnapshot({ start: start ?? null, end: end ?? null, provenance });

export const selectionSnapshotFromState = (source: SelectionSnapshotSource): SelectionSnapshot =>
  normalizeSelectionSnapshot({
    start: source.selectionStart,
    end: source.selectionEnd,
    provenance: source.selectionLastAction,
    mask: source.selectionMask,
    maskBounds: source.selectionMaskBounds,
    maskLayerId: source.selectionMaskLayerId,
    vectorPath: source.selectionVectorPath,
  });

const pointsEqual = (a: SelectionPoint | null, b: SelectionPoint | null): boolean =>
  a === b || Boolean(a && b && a.x === b.x && a.y === b.y);

export const selectionSnapshotsEqual = (a: SelectionSnapshot, b: SelectionSnapshot): boolean => {
  const hasA = Boolean(a.start && a.end);
  const hasB = Boolean(b.start && b.end);
  if (!hasA || !hasB) return hasA === hasB;
  if (!pointsEqual(a.start, b.start) || !pointsEqual(a.end, b.end) ||
    (a.maskLayerId ?? null) !== (b.maskLayerId ?? null)) return false;
  const boundsA = a.maskBounds ?? null;
  const boundsB = b.maskBounds ?? null;
  if (Boolean(boundsA) !== Boolean(boundsB) || boundsA && boundsB &&
    (boundsA.x !== boundsB.x || boundsA.y !== boundsB.y || boundsA.width !== boundsB.width || boundsA.height !== boundsB.height)) return false;
  const maskA = a.mask ?? null;
  const maskB = b.mask ?? null;
  if (Boolean(maskA) !== Boolean(maskB)) return false;
  if (maskA && maskB) {
    if (maskA.width !== maskB.width || maskA.height !== maskB.height || maskA.data.length !== maskB.data.length) return false;
    for (let i = 0; i < maskA.data.length; i += 1) if (maskA.data[i] !== maskB.data[i]) return false;
  }
  const vectorA = a.vectorPath ?? null;
  const vectorB = b.vectorPath ?? null;
  if (Boolean(vectorA) !== Boolean(vectorB)) return false;
  if (vectorA && vectorB) {
    if (vectorA.mode !== vectorB.mode || vectorA.points.length !== vectorB.points.length) return false;
    for (let i = 0; i < vectorA.points.length; i += 1) if (!pointsEqual(vectorA.points[i], vectorB.points[i])) return false;
  }
  // Provenance timestamps alone do not turn unchanged geometry into an edit.
  return true;
};
