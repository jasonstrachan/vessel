import type { Project } from '@/types';
import {
  composeTxtShapesIntoLayerSource,
  drawTxtShapesForLayer,
  getTxtShapesForLayer,
} from '@/utils/txtShape';
import {
  composeUiShapesIntoLayerSource,
  drawUiShapesForLayer,
  getUiShapesForLayer,
} from '@/utils/uiShape';

type LayerObjectProject = Pick<Project, 'txtShapes' | 'uiShapes'>;

export const hasLayerOwnedProjectObjects = (
  project: LayerObjectProject,
  layerId: string,
): boolean => getTxtShapesForLayer(project.txtShapes, layerId).length > 0
  || getUiShapesForLayer(project.uiShapes, layerId).length > 0;

export const drawLayerOwnedProjectObjectsForLayer = (
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  project: LayerObjectProject,
  layerId: string,
  dirtyRects?: readonly { x: number; y: number; width: number; height: number }[],
): void => {
  drawTxtShapesForLayer(ctx, project.txtShapes, layerId, dirtyRects);
  drawUiShapesForLayer(ctx, project.uiShapes, layerId, dirtyRects);
};

export const composeLayerOwnedProjectObjectsIntoLayerSource = ({
  source,
  project,
  layerId,
  width,
  height,
}: {
  source: CanvasImageSource | null;
  project: LayerObjectProject;
  layerId: string;
  width: number;
  height: number;
}): CanvasImageSource | null => {
  const withText = composeTxtShapesIntoLayerSource({
    source,
    shapes: project.txtShapes,
    layerId,
    width,
    height,
  });
  return composeUiShapesIntoLayerSource({
    source: withText,
    shapes: project.uiShapes,
    layerId,
    width,
    height,
  });
};
