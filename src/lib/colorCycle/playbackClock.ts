import type { Project } from '@/types';

/** An optional authored clock. Ordinary CC layers keep their native timing. */
export interface ColorCyclePlaybackClock {
  timeSeconds: number;
  speedScale: number;
  /** One repeating period of sampled render times, including both endpoints. */
  timeCurve?: { durationSeconds: number; samples: number[] };
  /** Presentation opacity on the same authored clock; never alters paint data. */
  opacityCurve?: { durationSeconds: number; samples: number[] };
}

const sampleCurve = (curve: ColorCyclePlaybackClock['timeCurve'], time: number, fallback: number): number => {
  if (!curve || !(curve.durationSeconds > 0) || !Number.isFinite(curve.durationSeconds) || curve.samples.length < 2) return fallback;
  const position = ((time % curve.durationSeconds + curve.durationSeconds) % curve.durationSeconds)
    / curve.durationSeconds * (curve.samples.length - 1);
  const index = Math.min(Math.floor(position), curve.samples.length - 2);
  const start = curve.samples[index];
  const end = curve.samples[index + 1];
  return Number.isFinite(start) && Number.isFinite(end)
    ? start + (end - start) * (position - index) : fallback;
};

export const getColorCyclePlaybackTime = (clock: ColorCyclePlaybackClock): number =>
  sampleCurve(clock.timeCurve, clock.timeSeconds, clock.timeSeconds);

export const getColorCyclePlaybackOpacity = (clock: ColorCyclePlaybackClock | undefined): number =>
  clock ? Math.max(0, Math.min(1, sampleCurve(clock.opacityCurve, clock.timeSeconds, 1))) : 1;

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
