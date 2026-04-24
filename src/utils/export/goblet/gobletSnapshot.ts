import { cloneDisplayFilters } from '@/lib/displayFilters';
import type { DisplayFilterConfig } from '@/types';
import type { WebGLExportRequest } from '@/utils/export/goblet/gobletTypes';

export interface GobletExportSnapshotState {
  transparencyBackgroundMode?: 'checker' | 'gray';
  displayFilters?: DisplayFilterConfig[];
  colorCyclePlaybackSpeedScale?: number;
  colorCycleLayerSpeedScale?: number;
  colorCycleToolSpeed?: number;
}

export const buildGobletExportSnapshotRequest = (
  request: WebGLExportRequest,
  state: GobletExportSnapshotState
): WebGLExportRequest => ({
  ...request,
  transparencyBackgroundMode:
    request.transparencyBackgroundMode
    ?? state.transparencyBackgroundMode
    ?? 'checker',
  displayFilters:
    request.displayFilters
    ?? cloneDisplayFilters(state.displayFilters ?? []),
  colorCyclePlaybackSpeedScale:
    request.colorCyclePlaybackSpeedScale
    ?? state.colorCyclePlaybackSpeedScale,
  colorCycleLayerSpeedScale:
    request.colorCycleLayerSpeedScale
    ?? state.colorCycleLayerSpeedScale,
  colorCycleToolSpeed:
    request.colorCycleToolSpeed
    ?? state.colorCycleToolSpeed,
});
