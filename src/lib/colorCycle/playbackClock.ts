import type { Project } from '@/types';

/** An optional authored clock. Ordinary CC layers keep their native timing. */
export interface ColorCyclePlaybackClock {
  timeSeconds: number;
  speedScale: number;
}

interface ClockProvider {
  read: (layerId: string, projectId?: string) => ColorCyclePlaybackClock | undefined;
  snapshotProject: (project: Project) => Project;
}
let provider: ClockProvider | undefined;

export const registerColorCyclePlaybackClock = (next: ClockProvider): (() => void) => {
  provider = next;
  return () => { if (provider === next) provider = undefined; };
};

export const getColorCyclePlaybackClock = (layerId: string | null, projectId?: string): ColorCyclePlaybackClock | undefined =>
  layerId ? provider?.read(layerId, projectId) : undefined;

export const snapshotColorCyclePlaybackProject = (project: Project): Project =>
  provider?.snapshotProject(project) ?? project;
