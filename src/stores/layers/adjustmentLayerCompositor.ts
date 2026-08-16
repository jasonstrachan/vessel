import {
  applyAdjustmentEffect,
  createDisplayFilterPipelineState,
  type DisplayFilterPipelineState,
} from '@/lib/displayFilterPipeline';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import type { Layer, LayerGroup } from '@/types';

type Canvas2DContext = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;

interface AdjustmentRenderSurface {
  canvas: HTMLCanvasElement;
  context: CanvasRenderingContext2D;
}

export interface AdjustmentLayerCompositeCache {
  groupSurfaces: Map<string, AdjustmentRenderSurface>;
  inputSurfaces: Map<string, AdjustmentRenderSurface>;
  filterStates: Map<string, DisplayFilterPipelineState>;
}

export const createAdjustmentLayerCompositeCache = (): AdjustmentLayerCompositeCache => ({
  groupSurfaces: new Map(),
  inputSurfaces: new Map(),
  filterStates: new Map(),
});

const ensureSurface = (
  surfaces: Map<string, AdjustmentRenderSurface>,
  key: string,
  width: number,
  height: number,
): AdjustmentRenderSurface | null => {
  if (typeof document === 'undefined') return null;
  let surface = surfaces.get(key);
  if (!surface) {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext(
      '2d',
      { willReadFrequently: true } as CanvasRenderingContext2DSettings,
    );
    if (!context) return null;
    surface = { canvas, context };
    surfaces.set(key, surface);
  }
  if (surface.canvas.width !== width) surface.canvas.width = width;
  if (surface.canvas.height !== height) surface.canvas.height = height;
  return surface;
};

const resetContext = (context: Canvas2DContext): void => {
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.filter = 'none';
};

const applyLayerAdjustment = ({
  context,
  layer,
  width,
  height,
  cache,
}: {
  context: Canvas2DContext;
  layer: Layer;
  width: number;
  height: number;
  cache: AdjustmentLayerCompositeCache;
}): void => {
  if (layer.layerType !== 'adjustment' || !layer.adjustmentData || layer.opacity <= 0) return;
  const input = ensureSurface(cache.inputSurfaces, layer.id, width, height);
  if (!input) return;
  resetContext(input.context);
  input.context.clearRect(0, 0, width, height);
  input.context.drawImage(context.canvas as CanvasImageSource, 0, 0);
  const filterState = cache.filterStates.get(layer.id) ?? createDisplayFilterPipelineState();
  cache.filterStates.set(layer.id, filterState);
  const result = applyAdjustmentEffect({
    sourceCanvas: input.canvas,
    effect: layer.adjustmentData.effect,
    mix: layer.opacity,
    filterState,
  });
  context.save();
  resetContext(context);
  context.clearRect(0, 0, width, height);
  context.drawImage(result, 0, 0);
  context.restore();
};

export const hasVisibleAdjustmentLayers = (layers: Layer[]): boolean => (
  layers.some((layer) => (
    layer.visible
    && layer.layerType === 'adjustment'
    && Boolean(layer.adjustmentData)
    && layer.opacity > 0
  ))
);

export const renderAdjustmentAwareLayerStack = ({
  context,
  sortedLayers,
  layerGroups,
  width,
  height,
  cache,
  drawLayer,
  drawInterlaceGroup,
}: {
  context: Canvas2DContext;
  sortedLayers: Layer[];
  layerGroups: LayerGroup[];
  width: number;
  height: number;
  cache: AdjustmentLayerCompositeCache;
  drawLayer: (context: Canvas2DContext, layer: Layer) => void;
  drawInterlaceGroup?: (
    context: Canvas2DContext,
    group: LayerGroup & { kind: 'interlace' },
    members: Layer[],
  ) => void;
}): void => {
  const visibleLayers = sortedLayers.filter((layer) => layer.visible);
  const groupById = new Map(layerGroups.map((group) => [group.id, group]));
  const membersByGroupId = new Map<string, Layer[]>();
  visibleLayers.forEach((layer) => {
    if (!layer.groupId || !groupById.has(layer.groupId)) return;
    membersByGroupId.set(layer.groupId, [...(membersByGroupId.get(layer.groupId) ?? []), layer]);
  });
  const adjustmentGroupIds = new Set(
    layerGroups
      .filter((group) => !isInterlaceGroup(group))
      .filter((group) => membersByGroupId.get(group.id)?.some((member) => member.layerType === 'adjustment'))
      .map((group) => group.id),
  );
  const emittedGroupIds = new Set<string>();

  const renderFlatStack = (target: Canvas2DContext, layers: Layer[]): void => {
    for (const layer of layers) {
      if (layer.layerType === 'adjustment') {
        applyLayerAdjustment({ context: target, layer, width, height, cache });
      } else {
        drawLayer(target, layer);
      }
    }
  };

  for (const layer of visibleLayers) {
    const group = layer.groupId ? groupById.get(layer.groupId) : undefined;
    if (group && adjustmentGroupIds.has(group.id)) {
      if (emittedGroupIds.has(group.id)) continue;
      emittedGroupIds.add(group.id);
      const surface = ensureSurface(cache.groupSurfaces, group.id, width, height);
      if (!surface) continue;
      resetContext(surface.context);
      surface.context.clearRect(0, 0, width, height);
      renderFlatStack(surface.context, membersByGroupId.get(group.id) ?? []);
      context.save();
      resetContext(context);
      context.drawImage(surface.canvas, 0, 0);
      context.restore();
      continue;
    }
    if (isInterlaceGroup(group)) {
      if (emittedGroupIds.has(group.id)) continue;
      emittedGroupIds.add(group.id);
      const members = membersByGroupId.get(group.id) ?? [];
      if (members.length >= 2 && drawInterlaceGroup) {
        drawInterlaceGroup(context, group, members);
      } else {
        renderFlatStack(context, members);
      }
      continue;
    }
    if (layer.layerType === 'adjustment') {
      applyLayerAdjustment({ context, layer, width, height, cache });
    } else {
      drawLayer(context, layer);
    }
  }

  const activeAdjustmentIds = new Set(
    visibleLayers.filter((layer) => layer.layerType === 'adjustment').map((layer) => layer.id),
  );
  cache.inputSurfaces.forEach((_, key) => {
    if (!activeAdjustmentIds.has(key)) cache.inputSurfaces.delete(key);
  });
  cache.filterStates.forEach((_, key) => {
    if (!activeAdjustmentIds.has(key)) cache.filterStates.delete(key);
  });
  cache.groupSurfaces.forEach((_, key) => {
    if (!adjustmentGroupIds.has(key)) cache.groupSurfaces.delete(key);
  });
};
