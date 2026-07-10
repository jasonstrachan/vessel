import { useAppStore } from '@/stores/useAppStore';
import {
  prepareHistoryDelta,
  type PreparedHistoryDelta,
  type HistoryDelta,
  type HistoryDirection,
  type HistoryRehydrationTargets,
} from '../actionTypes';
import { restoreOwnedProperties } from '@/history/storeStateCompensation';

export interface ProjectViewState {
  width: number;
  height: number;
  zoom: number;
  offsetX: number;
  offsetY: number;
  canvasWidth: number;
  canvasHeight: number;
  viewport?: {
    left: number;
    top: number;
    width: number;
    height: number;
  } | null;
}

export interface ProjectTransformDeltaOptions {
  before: ProjectViewState;
  after: ProjectViewState;
}

const applyState = (state: ProjectViewState): void => {
  const store = useAppStore.getState();

  store.setProjectDimensions(state.width, state.height);
  store.setCanvasDimensions(state.canvasWidth, state.canvasHeight);
  store.setZoom(state.zoom);
  store.setCanvasOffset(state.offsetX, state.offsetY);

  if (state.viewport) {
    store.setCanvasViewport(state.viewport);
  }

  store.setLayersNeedRecomposition(true);
};

export class ProjectTransformDelta implements HistoryDelta {
  readonly _tag = 'project-transform';
  readonly approxBytes = 64;

  constructor(
    private readonly beforeState: ProjectViewState,
    private readonly afterState: ProjectViewState,
  ) {}

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const state = useAppStore.getState();
    const projectId = state.project?.id ?? null;
    const projectSnapshot = state.project;
    const layers = state.layers;
    const canvasGeometry = {
      zoom: state.canvas.zoom,
      offsetX: state.canvas.offsetX,
      offsetY: state.canvas.offsetY,
      canvasWidth: state.canvas.canvasWidth,
      canvasHeight: state.canvas.canvasHeight,
    };
    const canvasViewport = state.canvasViewport;
    const layersNeedRecomposition = state.layersNeedRecomposition;
    const target = direction === 'forward' ? this.afterState : this.beforeState;
    const isCurrentProject = (): boolean =>
      (useAppStore.getState().project?.id ?? null) === projectId;
    const requiresCompensation = (): boolean => {
      if (!isCurrentProject()) return false;
      const current = useAppStore.getState();
      return (
        !Object.is(current.layers, layers) ||
        current.project?.width !== projectSnapshot?.width ||
        current.project?.height !== projectSnapshot?.height ||
        !Object.is(current.project?.updatedAt, projectSnapshot?.updatedAt) ||
        !Object.is(current.project?.canvasShape, projectSnapshot?.canvasShape) ||
        current.canvas.zoom !== canvasGeometry.zoom ||
        current.canvas.offsetX !== canvasGeometry.offsetX ||
        current.canvas.offsetY !== canvasGeometry.offsetY ||
        current.canvas.canvasWidth !== canvasGeometry.canvasWidth ||
        current.canvas.canvasHeight !== canvasGeometry.canvasHeight ||
        (target.viewport ? !Object.is(current.canvasViewport, canvasViewport) : false) ||
        current.layersNeedRecomposition !== layersNeedRecomposition
      );
    };

    return prepareHistoryDelta(
      this._tag,
      () => this.applyReplay(direction),
      requiresCompensation,
      () => {
        if (!isCurrentProject()) return;
        useAppStore.setState((current) => ({
          layers,
          project: current.project && projectSnapshot
            ? restoreOwnedProperties(current.project, projectSnapshot, [
                'width',
                'height',
                'updatedAt',
                'canvasShape',
              ])
            : current.project,
          canvas: {
            ...current.canvas,
            ...canvasGeometry,
          },
          ...(target.viewport ? { canvasViewport } : {}),
          layersNeedRecomposition,
        }));
      },
      (targets) => this.collectRehydrationTargets(targets),
    );
  }

  applyReplay(direction: HistoryDirection): void {
    const target = direction === 'forward' ? this.afterState : this.beforeState;
    applyState(target);
  }

  collectRehydrationTargets(targets: HistoryRehydrationTargets): void {
    // No layer-specific work required, but mark viewport-dependent composites dirty.
    if (targets.layerIds.size === 0) {
      // Touch a sentinel so downstream caller triggers composite refresh.
      targets.layerIds.add('__project__');
    }
  }
}

export const createProjectTransformDelta = (
  options: ProjectTransformDeltaOptions,
): HistoryDelta => new ProjectTransformDelta(options.before, options.after);
