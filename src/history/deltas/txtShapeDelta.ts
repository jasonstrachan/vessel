import {
  prepareHistoryDelta,
  type HistoryDelta,
  type HistoryDirection,
  type HistoryRehydrationTargets,
  type PreparedHistoryDelta,
} from '@/history/actionTypes';
import { useAppStore } from '@/stores/useAppStore';
import type { TxtShape } from '@/types';

const cloneTxtShapes = (shapes: readonly TxtShape[]): TxtShape[] => shapes.map((shape) => ({
  ...shape,
  regionPath: shape.regionPath?.map((point) => ({ ...point })),
  selections: shape.selections.map((selection) => ({ ...selection })),
}));

const rangesEqual = (
  left: readonly { start: number; end: number }[] | undefined,
  right: readonly { start: number; end: number }[] | undefined,
): boolean => (left?.length ?? 0) === (right?.length ?? 0) && (left ?? []).every(
  (range, index) => range.start === right?.[index]?.start && range.end === right?.[index]?.end,
);

const pathsEqual = (
  left: readonly { x: number; y: number }[] | undefined,
  right: readonly { x: number; y: number }[] | undefined,
): boolean => (left?.length ?? 0) === (right?.length ?? 0) && (left ?? []).every(
  (point, index) => point.x === right?.[index]?.x && point.y === right?.[index]?.y,
);

const shapesEqual = (left: TxtShape, right: TxtShape): boolean => (
  left.id === right.id
  && left.layerId === right.layerId
  && left.x === right.x
  && left.y === right.y
  && left.width === right.width
  && left.height === right.height
  && left.padding === right.padding
  && left.regionKind === right.regionKind
  && pathsEqual(left.regionPath, right.regionPath)
  && left.content === right.content
  && left.fontFamily === right.fontFamily
  && left.fontSize === right.fontSize
  && left.lineHeight === right.lineHeight
  && left.textAlign === right.textAlign
  && left.colorSource === right.colorSource
  && left.color === right.color
  && left.selectionColor === right.selectionColor
  && left.selectionBackgroundColor === right.selectionBackgroundColor
  && left.backgroundColor === right.backgroundColor
  && rangesEqual(left.selections, right.selections)
  && left.createdAt === right.createdAt
  && left.updatedAt === right.updatedAt
);

const txtShapeCollectionsEqual = (
  left: readonly TxtShape[],
  right: readonly TxtShape[],
): boolean => left.length === right.length && left.every(
  (shape, index) => shapesEqual(shape, right[index]!),
);

const estimateTxtShapeBytes = (shapes: readonly TxtShape[]): number => shapes.reduce(
  (total, shape) => total
    + 192
    + shape.content.length * 2
    + (shape.regionPath?.length ?? 0) * 16
    + shape.selections.length * 16,
  0,
);

class TxtShapeDelta implements HistoryDelta {
  readonly _tag = 'txt-shapes';
  readonly approxBytes: number;
  private readonly affectedLayerIds: Set<string>;

  constructor(
    private readonly beforeShapes: TxtShape[],
    private readonly afterShapes: TxtShape[],
  ) {
    this.approxBytes = Math.max(
      256,
      estimateTxtShapeBytes(beforeShapes) + estimateTxtShapeBytes(afterShapes),
    );
    this.affectedLayerIds = new Set(
      [...beforeShapes, ...afterShapes].map((shape) => shape.layerId).filter(Boolean),
    );
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const state = useAppStore.getState();
    const projectId = state.project?.id ?? null;
    const previousShapes = state.project?.txtShapes;
    const previousUpdatedAt = state.project?.updatedAt;
    const previousCompositeState = {
      layersNeedRecomposition: state.layersNeedRecomposition,
      compositeSegments: state.compositeSegments,
      pendingCompositeDirtyBatches: state.pendingCompositeDirtyBatches,
    };
    const isCurrentProject = (): boolean => (
      (useAppStore.getState().project?.id ?? null) === projectId
    );

    return prepareHistoryDelta(
      this._tag,
      () => this.applyReplay(direction, projectId),
      () => {
        if (!isCurrentProject()) return false;
        const current = useAppStore.getState();
        return current.project?.txtShapes !== previousShapes
          || current.project?.updatedAt !== previousUpdatedAt
          || current.layersNeedRecomposition !== previousCompositeState.layersNeedRecomposition
          || current.compositeSegments !== previousCompositeState.compositeSegments
          || current.pendingCompositeDirtyBatches !== previousCompositeState.pendingCompositeDirtyBatches;
      },
      () => {
        if (!isCurrentProject()) return;
        useAppStore.setState((current) => ({
          ...previousCompositeState,
          project: current.project
            ? {
                ...current.project,
                txtShapes: previousShapes,
                updatedAt: previousUpdatedAt ?? current.project.updatedAt,
              }
            : current.project,
        }));
      },
      (targets) => this.collectRehydrationTargets(targets),
    );
  }

  private applyReplay(direction: HistoryDirection, projectId: string | null): void {
    const target = direction === 'forward' ? this.afterShapes : this.beforeShapes;
    useAppStore.setState((state) => {
      if (!state.project || state.project.id !== projectId) return state;
      return {
        project: {
          ...state.project,
          txtShapes: cloneTxtShapes(target),
          updatedAt: new Date(),
        },
      };
    });
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    this.affectedLayerIds.forEach((layerId) => targets.layerIds.add(layerId));
  }
}

interface CreateTxtShapeDeltaOptions {
  before: readonly TxtShape[];
  after: readonly TxtShape[];
}

export const createTxtShapeDelta = ({
  before,
  after,
}: CreateTxtShapeDeltaOptions): HistoryDelta | null => {
  if (txtShapeCollectionsEqual(before, after)) return null;
  return new TxtShapeDelta(cloneTxtShapes(before), cloneTxtShapes(after));
};
