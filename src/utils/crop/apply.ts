import type { Project, Layer } from '@/types';
import { readLayerSourcesForCrop } from './read';
import type {
  ColorCycleBrushResetEntry,
  NormalizedCropRect,
  RecolorRebuildRequest
} from './types';

interface CroppableProjectObject {
  x: number;
  y: number;
  width: number;
  height: number;
  updatedAt: number;
}

const cropProjectObjects = <T extends CroppableProjectObject>(
  objects: readonly T[] | undefined,
  rect: NormalizedCropRect,
): T[] | undefined => {
  if (!objects) return undefined;
  const right = rect.x + rect.width;
  const bottom = rect.y + rect.height;
  const didMoveOrigin = rect.x !== 0 || rect.y !== 0;
  const updatedAt = Date.now();

  return objects.flatMap((object) => {
    const intersectsCrop = object.x < right
      && object.y < bottom
      && object.x + object.width > rect.x
      && object.y + object.height > rect.y;
    if (!intersectsCrop) return [];
    if (!didMoveOrigin) return [object];
    return [{
      ...object,
      x: object.x - rect.x,
      y: object.y - rect.y,
      updatedAt,
    }];
  });
};

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
    ...(project.txtShapes
      ? { txtShapes: cropProjectObjects(project.txtShapes, rect) }
      : {}),
    ...(project.uiShapes
      ? { uiShapes: cropProjectObjects(project.uiShapes, rect) }
      : {}),
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
