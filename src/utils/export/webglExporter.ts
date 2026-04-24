import { useAppStore } from '@/stores/useAppStore';
import {
  __TESTING__,
  exportProjectAsWebGL as exportProjectAsWebGLFromSnapshot,
} from '@/utils/export/goblet/gobletExporter';
import { buildGobletExportSnapshotRequest } from '@/utils/export/goblet/gobletSnapshot';
import type { WebGLExportMetadata, WebGLExportRequest } from '@/utils/export/goblet/gobletTypes';

export { __TESTING__ };

export const exportProjectAsWebGL = async (
  request: WebGLExportRequest
): Promise<WebGLExportMetadata> => {
  const state = useAppStore.getState();
  return exportProjectAsWebGLFromSnapshot(buildGobletExportSnapshotRequest(request, {
    transparencyBackgroundMode: state.canvas.transparencyBackgroundMode,
    displayFilters: state.canvas.displayFilters,
    colorCyclePlaybackSpeedScale: state.colorCyclePlayback?.playbackSpeedScale,
    colorCycleLayerSpeedScale: state.tools?.brushSettings?.colorCycleLayerSpeedScale,
    colorCycleToolSpeed: state.tools?.brushSettings?.colorCycleSpeed,
  }));
};

export type {
  WebGLExportMetadata,
  WebGLExportRequest,
  WebGLLayerBounds,
  WebGLLayerMetadata,
} from '@/utils/export/goblet/gobletTypes';
