import {
  prepareHistoryDelta,
  type HistoryDelta,
  type HistoryDirection,
  type HistoryRehydrationTargets,
  type PreparedHistoryDelta,
} from '@/history/actionTypes';
import { useAppStore } from '@/stores/useAppStore';
import type { UiShape } from '@/types';
import { cloneUiShapes } from '@/utils/uiShape';

class UiShapeDelta implements HistoryDelta {
  readonly _tag = 'ui-shapes';
  readonly approxBytes: number;
  private readonly affectedLayerIds: Set<string>;

  constructor(
    private readonly beforeShapes: UiShape[],
    private readonly afterShapes: UiShape[],
  ) {
    this.approxBytes = Math.max(
      256,
      JSON.stringify(beforeShapes).length * 2 + JSON.stringify(afterShapes).length * 2,
    );
    this.affectedLayerIds = new Set(
      [...beforeShapes, ...afterShapes].map((shape) => shape.layerId).filter(Boolean),
    );
  }

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const state = useAppStore.getState();
    const projectId = state.project?.id ?? null;
    const previousShapes = state.project?.uiShapes;
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
        return current.project?.uiShapes !== previousShapes
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
                uiShapes: previousShapes,
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
          uiShapes: cloneUiShapes(target),
          updatedAt: new Date(),
        },
      };
    });
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    this.affectedLayerIds.forEach((layerId) => targets.layerIds.add(layerId));
  }
}

export const createUiShapeDelta = ({
  before,
  after,
}: {
  before: readonly UiShape[];
  after: readonly UiShape[];
}): HistoryDelta | null => {
  if (before === after || JSON.stringify(before) === JSON.stringify(after)) return null;
  return new UiShapeDelta(cloneUiShapes(before), cloneUiShapes(after));
};
