import { getInterlaceElapsedSeconds } from '@/lib/interlace/interlaceClock';
import {
  drawSierraLiteInterlace,
  type InterlaceRenderSource,
} from '@/lib/interlace/interlaceRenderer';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { getSequentialRenderFrame } from '@/runtime/playback/sequentialFrameCursor';
import {
  createAdjustmentLayerCompositeCache,
  renderAdjustmentAwareLayerStack,
} from '@/stores/layers/adjustmentLayerCompositor';
import type { AppState } from '@/stores/useAppStore';
import type { Layer } from '@/types';
import { composeLayerOwnedProjectObjectsIntoLayerSource } from '@/utils/layerOwnedProjectObjects';

import {
  getColorCyclePresentationCanvas,
  resolveColorCyclePresentation,
} from './resolveColorCyclePresentation';

interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface LiveLayerOverlay {
  layerId: string;
  canvas: HTMLCanvasElement;
  mode: 'over' | 'replace';
}

const adjustmentCompositeCache = createAdjustmentLayerCompositeCache();
let adjustmentViewportCanvas: HTMLCanvasElement | null = null;

const ensureAdjustmentViewportCanvas = (width: number, height: number): HTMLCanvasElement | null => {
  if (typeof document === 'undefined') return null;
  const canvas = adjustmentViewportCanvas ?? document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width));
  canvas.height = Math.max(1, Math.ceil(height));
  adjustmentViewportCanvas = canvas;
  return canvas;
};

const resolveBloomOverscan = (layers: Layer[]): number => layers.reduce((largest, layer) => {
  if (
    !layer.visible
    || layer.layerType !== 'adjustment'
    || layer.adjustmentData?.effect.id !== 'bloom'
  ) {
    return largest;
  }
  return Math.max(largest, Math.ceil(layer.adjustmentData.effect.settings.blurRadius * 3));
}, 0);

const expandVisibleRect = (visibleRect: Rect, layers: Layer[], state: AppState): Rect => {
  const overscan = resolveBloomOverscan(layers);
  const projectWidth = Math.max(1, state.project?.width ?? visibleRect.x + visibleRect.width);
  const projectHeight = Math.max(1, state.project?.height ?? visibleRect.y + visibleRect.height);
  const x = Math.floor(Math.max(0, visibleRect.x - overscan));
  const y = Math.floor(Math.max(0, visibleRect.y - overscan));
  const maxX = Math.ceil(Math.min(
    projectWidth,
    visibleRect.x + visibleRect.width + overscan,
  ));
  const maxY = Math.ceil(Math.min(
    projectHeight,
    visibleRect.y + visibleRect.height + overscan,
  ));
  return { x, y, width: maxX - x, height: maxY - y };
};

export const drawAdjustmentCompositeStack = ({
  ctx,
  visibleRect,
  destination,
  sortedLayers,
  storeState,
  shouldHoldPreviousSequentialFrame,
  liveLayerOverlay,
}: {
  ctx: CanvasRenderingContext2D;
  visibleRect: Rect;
  destination: Rect;
  sortedLayers: Layer[];
  storeState: AppState;
  shouldHoldPreviousSequentialFrame: boolean;
  liveLayerOverlay?: LiveLayerOverlay;
}): boolean => {
  const renderRect = expandVisibleRect(visibleRect, sortedLayers, storeState);
  const surface = ensureAdjustmentViewportCanvas(renderRect.width, renderRect.height);
  const surfaceContext = surface?.getContext(
    '2d',
    { willReadFrequently: true } as CanvasRenderingContext2DSettings,
  );
  if (!surface || !surfaceContext) return false;

  surfaceContext.setTransform(1, 0, 0, 1, 0, 0);
  surfaceContext.imageSmoothingEnabled = false;
  surfaceContext.clearRect(0, 0, surface.width, surface.height);
  const project = storeState.project;
  if (project?.backgroundColor && project.backgroundColor !== 'transparent') {
    surfaceContext.fillStyle = project.backgroundColor;
    surfaceContext.fillRect(0, 0, surface.width, surface.height);
  }

  const drawLayer = (
    target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
    layer: Layer,
  ) => {
    let source: CanvasImageSource | null = null;
    if (layer.layerType === 'color-cycle') {
      const presentation = resolveColorCyclePresentation({
        layer,
        activeLayerId: storeState.activeLayerId ?? null,
        projectWidth: project?.width ?? renderRect.width,
        projectHeight: project?.height ?? renderRect.height,
      });
      source = getColorCyclePresentationCanvas(presentation, layer);
    } else if (layer.layerType === 'sequential' && layer.sequentialData) {
      source = getSequentialLayerRenderCanvas({
        layer,
        width: project?.width ?? renderRect.width,
        height: project?.height ?? renderRect.height,
        frameIndex: getSequentialRenderFrame(storeState),
        holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
      }) as CanvasImageSource | null;
    } else if (layer.framebuffer) {
      source = layer.framebuffer as CanvasImageSource;
    }
    if (layer.layerType === 'normal') {
      source = composeLayerOwnedProjectObjectsIntoLayerSource({
        source,
        project: project ?? {},
        layerId: layer.id,
        width: project?.width ?? renderRect.width,
        height: project?.height ?? renderRect.height,
      });
    }
    const overlay = liveLayerOverlay?.layerId === layer.id ? liveLayerOverlay : null;
    if (!source && !overlay) return;
    target.save();
    target.globalAlpha = layer.opacity;
    target.globalCompositeOperation = layer.blendMode ?? 'source-over';
    if (source && overlay?.mode !== 'replace') {
      target.drawImage(
        source,
        renderRect.x,
        renderRect.y,
        renderRect.width,
        renderRect.height,
        0,
        0,
        surface.width,
        surface.height,
      );
    }
    if (overlay) {
      target.drawImage(
        overlay.canvas,
        renderRect.x,
        renderRect.y,
        renderRect.width,
        renderRect.height,
        0,
        0,
        surface.width,
        surface.height,
      );
    }
    target.restore();
  };

  renderAdjustmentAwareLayerStack({
    context: surfaceContext,
    sortedLayers,
    layerGroups: storeState.layerGroups,
    width: surface.width,
    height: surface.height,
    cache: adjustmentCompositeCache,
    drawLayer,
    drawInterlaceGroup: (target, group, members) => {
      const sources = members.flatMap<InterlaceRenderSource>((member) => {
        let source: CanvasImageSource | null = null;
        if (member.layerType === 'color-cycle') {
          const presentation = resolveColorCyclePresentation({
            layer: member,
            activeLayerId: storeState.activeLayerId ?? null,
            projectWidth: project?.width ?? renderRect.width,
            projectHeight: project?.height ?? renderRect.height,
          });
          source = getColorCyclePresentationCanvas(presentation, member);
        } else if (member.framebuffer) {
          source = member.framebuffer as CanvasImageSource;
        }
        if (member.layerType === 'normal') {
          source = composeLayerOwnedProjectObjectsIntoLayerSource({
            source,
            project: project ?? {},
            layerId: member.id,
            width: project?.width ?? renderRect.width,
            height: project?.height ?? renderRect.height,
          });
        }
        return source
          ? [{ source, opacity: member.opacity, blendMode: member.blendMode }]
          : [];
      });
      if (!group.interlace) return;
      drawSierraLiteInterlace({
        context: target,
        width: project?.width ?? renderRect.width,
        height: project?.height ?? renderRect.height,
        sources,
        settings: group.interlace,
        elapsedSeconds: getInterlaceElapsedSeconds(),
        sourceRect: renderRect,
        destinationRect: { x: 0, y: 0, width: surface.width, height: surface.height },
      });
    },
  });

  const sourceScaleX = surface.width / renderRect.width;
  const sourceScaleY = surface.height / renderRect.height;
  ctx.drawImage(
    surface,
    (visibleRect.x - renderRect.x) * sourceScaleX,
    (visibleRect.y - renderRect.y) * sourceScaleY,
    visibleRect.width * sourceScaleX,
    visibleRect.height * sourceScaleY,
    destination.x,
    destination.y,
    destination.width,
    destination.height,
  );
  return true;
};
