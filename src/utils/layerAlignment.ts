import type { ExportContainerLayout, LayerAlignmentSettings } from '@/types';
import { clampDimension, computeLayerTransform } from '@/utils/alignment/alignFitResolver';

interface Size2D {
  width: number;
  height: number;
}

export interface LayerTransform {
  scaleX: number;
  scaleY: number;
  translateX: number;
  translateY: number;
  rotation?: number;
}

export interface LayoutLayerInput {
  layerId: string;
  surface: Size2D;
  document: Size2D;
  content?: Size2D;
  alignment: LayerAlignmentSettings;
  hidden?: boolean;
}

export interface ResolvedLayerLayout {
  layerId: string;
  frame: { x: number; y: number; width: number; height: number };
  transform: LayerTransform;
}

export { computeLayerTransform };

const MIN_DIMENSION = 1e-3;

const resolveContainerFrame = (
  layout: ExportContainerLayout,
  viewport: Size2D
) => {
  const padding = layout.padding;
  const containerWidth = layout.sizeMode === 'fixed' && typeof layout.width === 'number'
    ? layout.width
    : viewport.width;
  const containerHeight = layout.sizeMode === 'fixed' && typeof layout.height === 'number'
    ? layout.height
    : viewport.height;

  const innerWidth = Math.max(
    MIN_DIMENSION,
    containerWidth - padding.left - padding.right
  );
  const innerHeight = Math.max(
    MIN_DIMENSION,
    containerHeight - padding.top - padding.bottom
  );

  return {
    frame: {
      x: padding.left,
      y: padding.top,
      width: innerWidth,
      height: innerHeight
    }
  };
};

export const resolveContainerLayout = (
  layers: LayoutLayerInput[],
  layout: ExportContainerLayout,
  viewport: Size2D
): ResolvedLayerLayout[] => {
  const { frame } = resolveContainerFrame(layout, viewport);
  const viewportForLayer = { width: frame.width, height: frame.height };

  const resolved: ResolvedLayerLayout[] = [];
  layers.forEach((entry) => {
    if (entry.hidden) {
      return;
    }

    const isUniformFit = entry.alignment.fit === 'uniform';
    const isTileFit = entry.alignment.fit === 'tile';
    const anchorContent = entry.alignment.positioning === 'anchor';
    const basisSize = entry.content && (isUniformFit || isTileFit || anchorContent)
      ? {
          width: clampDimension(entry.content.width),
          height: clampDimension(entry.content.height)
        }
      : {
          width: clampDimension(entry.document.width),
          height: clampDimension(entry.document.height)
        };

    const paintedBounds = {
      x: 0,
      y: 0,
      width: basisSize.width,
      height: basisSize.height
    };

    const documentForLayer = anchorContent && (isUniformFit || isTileFit)
      ? {
          width: basisSize.width,
          height: basisSize.height
        }
      : entry.document;

    const transform = computeLayerTransform(documentForLayer, viewportForLayer, entry.alignment, { paintedBounds });

    resolved.push({
      layerId: entry.layerId,
      frame: { ...frame },
      transform
    });
  });

  return resolved;
};
