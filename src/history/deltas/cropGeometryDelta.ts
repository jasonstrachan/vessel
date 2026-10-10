import type { HistoryDelta, HistoryDirection, PreparedHistoryDelta } from '@/history/actionTypes';
import { restoreOwnedProperties } from '@/history/storeStateCompensation';
import { useAppStore } from '@/stores/useAppStore';
import type { Layer, Project } from '@/types';

export type CropProjectGeometry = Pick<Project, 'width' | 'height' | 'canvasShape'>;

export const cloneCropProjectGeometry = (project: CropProjectGeometry): CropProjectGeometry => {
  const result: CropProjectGeometry = { width: project.width, height: project.height };
  if (Object.prototype.hasOwnProperty.call(project, 'canvasShape')) {
    const shape = project.canvasShape;
    result.canvasShape = shape ? {
      ...shape,
      bounds: { ...shape.bounds },
      ...(shape.kind === 'circle' ? { center: { ...shape.center } } : {}),
      ...(shape.kind === 'freehand' ? { points: shape.points.map((point) => ({ ...point })) } : {}),
    } : undefined;
  }
  return result;
};

export const cloneCropAlignment = (alignment: Layer['alignment']): Layer['alignment'] => ({
  ...alignment,
  ...(alignment.offsetPx ? { offsetPx: { ...alignment.offsetPx } } : {}),
  ...(alignment.offsetPercent ? { offsetPercent: { ...alignment.offsetPercent } } : {}),
});

interface CropGeometrySnapshot {
  project: CropProjectGeometry;
  alignments: ReadonlyMap<string, Layer['alignment']>;
}

const cloneSnapshot = (snapshot: CropGeometrySnapshot): CropGeometrySnapshot => ({
  project: cloneCropProjectGeometry(snapshot.project),
  alignments: new Map([...snapshot.alignments].map(([id, alignment]) => [id, cloneCropAlignment(alignment)])),
});

class CropGeometryDelta implements HistoryDelta {
  readonly _tag = 'crop-geometry';
  readonly approxBytes: number;
  private readonly before: CropGeometrySnapshot;
  private readonly after: CropGeometrySnapshot;

  constructor(before: CropGeometrySnapshot, after: CropGeometrySnapshot) {
    this.before = cloneSnapshot(before);
    this.after = cloneSnapshot(after);
    this.approxBytes = JSON.stringify([this.before.project, this.after.project,
      [...this.before.alignments], [...this.after.alignments]]).length * 2;
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const state = useAppStore.getState();
    const projectId = state.project?.id;
    const compensation = state.project ? cloneSnapshot({
      project: state.project,
      alignments: new Map(state.layers
        .filter((layer) => this.before.alignments.has(layer.id) || this.after.alignments.has(layer.id))
        .map((layer) => [layer.id, layer.alignment])),
    }) : null;
    let armed = false;
    const restore = (snapshot: CropGeometrySnapshot, needsRecomposition = true): void => {
      useAppStore.setState((current) => {
        if (!current.project || current.project.id !== projectId) return current;
        const cloned = cloneSnapshot(snapshot);
        const project = { ...current.project };
        if (Object.prototype.hasOwnProperty.call(cloned.project, 'canvasShape')) {
          project.canvasShape = cloned.project.canvasShape;
        } else {
          delete project.canvasShape;
        }
        return {
          project,
          layers: current.layers.map((layer) => {
            const alignment = cloned.alignments.get(layer.id);
            return alignment ? {
              ...layer,
              alignment: restoreOwnedProperties(layer.alignment, alignment, ['offsetPercent']),
            } : layer;
          }),
          layersNeedRecomposition: needsRecomposition,
        };
      });
    };
    return {
      deltaTag: this._tag,
      // Other deltas may recompute these fields from partially restored pixels.
      // Arm compensation now; install the saved authority only after replay settles.
      apply: () => { armed = true; },
      finalize: () => restore(direction === 'forward' ? this.after : this.before),
      requiresCompensation: () => armed && useAppStore.getState().project?.id === projectId,
      compensate: () => { if (compensation) restore(compensation, state.layersNeedRecomposition); },
    };
  }
}

export const createCropGeometryDelta = (
  before: CropGeometrySnapshot,
  after: CropGeometrySnapshot,
): HistoryDelta => new CropGeometryDelta(before, after);
