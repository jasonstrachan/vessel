import type { Project, Layer } from '@/types';
import { readLayerSourcesForCrop } from './read';
import type {
  ColorCycleBrushResetEntry,
  NormalizedCropRect,
  RecolorRebuildRequest
} from './types';

interface ApplyCroppedLayersArgs {
  project: Project;
  layers: Layer[];
  rect: NormalizedCropRect;
  activeLayerId: string | null;
  syncPercentOffsetsFromPixels: (layers: Layer[], project: Project | null) => Layer[];
}

interface ApplyCroppedLayersResult {
  updatedProject: Project;
  updatedLayers: Layer[];
  colorCycleBrushResets: ColorCycleBrushResetEntry[];
  recolorRebuildQueue: RecolorRebuildRequest[];
}

export function applyCroppedLayers({
  project,
  layers,
  rect,
  activeLayerId,
  syncPercentOffsetsFromPixels
}: ApplyCroppedLayersArgs): ApplyCroppedLayersResult {
  const readResults = layers.map((layer) =>
    readLayerSourcesForCrop(layer, rect, { activeLayerId })
  );

  const updatedLayers = readResults.map((result) => result.updatedLayer);
  const colorCycleBrushResets: ColorCycleBrushResetEntry[] = readResults
    .map((result) => result.brushReset)
    .filter((entry): entry is ColorCycleBrushResetEntry => Boolean(entry));
  const recolorRebuildQueue: RecolorRebuildRequest[] = readResults
    .map((result) => result.recolorRequest)
    .filter((entry): entry is RecolorRebuildRequest => Boolean(entry));

  let updatedProject: Project = {
    ...project,
    width: rect.width,
    height: rect.height,
    updatedAt: new Date()
  };

  const syncedLayers = syncPercentOffsetsFromPixels(updatedLayers, updatedProject);

  updatedProject = {
    ...updatedProject,
    layers: syncedLayers
  };

  return {
    updatedProject,
    updatedLayers: syncedLayers,
    colorCycleBrushResets,
    recolorRebuildQueue
  };
}
