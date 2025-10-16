import { useAppStore } from '@/stores/useAppStore';
import type { HistoryDelta, HistoryDirection } from '../actionTypes';

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

  apply(direction: HistoryDirection): void {
    const target =
      direction === 'forward' ? this.afterSize : this.beforeSize;
    const store = useAppStore.getState();
    store.setProjectDimensions(target.width, target.height);
  }
}

export const createProjectDimensionsDelta = (
  options: ProjectDimensionsDeltaOptions,
): HistoryDelta => new ProjectDimensionsDelta(options.before, options.after);
