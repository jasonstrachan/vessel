import { useAppStore } from '@/stores/useAppStore';
import {
  prepareHistoryDelta,
  type HistoryDelta,
  type HistoryDirection,
  type PreparedHistoryDelta,
} from '../actionTypes';
import { restoreOwnedProperties } from '@/history/storeStateCompensation';

interface ProjectDimensionsDeltaOptions {
  before: { width: number; height: number };
  after: { width: number; height: number };
}

class ProjectDimensionsDelta implements HistoryDelta {
  readonly _tag = 'project-dimensions';
  readonly approxBytes = 16;

  constructor(
    private readonly beforeSize: { width: number; height: number },
    private readonly afterSize: { width: number; height: number },
  ) {}

  prepare(direction: HistoryDirection): PreparedHistoryDelta {
    const state = useAppStore.getState();
    const projectId = state.project?.id ?? null;
    const projectSnapshot = state.project;
    const layers = state.layers;
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
        !Object.is(current.project?.canvasShape, projectSnapshot?.canvasShape)
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
        }));
      },
    );
  }

  applyReplay(direction: HistoryDirection): void {
    const target =
      direction === 'forward' ? this.afterSize : this.beforeSize;
    const store = useAppStore.getState();
    store.setProjectDimensions(target.width, target.height);
  }
}

export const createProjectDimensionsDelta = (
  options: ProjectDimensionsDeltaOptions,
): HistoryDelta => new ProjectDimensionsDelta(options.before, options.after);
