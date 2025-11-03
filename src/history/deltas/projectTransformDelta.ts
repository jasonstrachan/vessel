import { useAppStore } from '@/stores/useAppStore';
import type {
  HistoryDelta,
  HistoryDirection,
  HistoryRehydrationTargets,
} from '../actionTypes';

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

  apply(direction: HistoryDirection): void {
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
