import type { ColorCycleDirtyRect } from '@/lib/colorCycle/document/ColorCycleLayerDocument';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import { getInterlaceElapsedSeconds } from '@/lib/interlace/interlaceClock';
import { drawSierraLiteInterlace, type InterlaceRenderSource } from '@/lib/interlace/interlaceRenderer';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import {
  getColorCycleBrushManager,
  type ColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';
import { prepareColorCycleCompositeSource } from '@/stores/layers/layerColorCycleMaskState';
import {
  createAdjustmentLayerCompositeCache,
  hasVisibleAdjustmentLayers,
  renderAdjustmentAwareLayerStack,
} from '@/stores/layers/adjustmentLayerCompositor';
import type { Layer, Project } from '@/types';
import { logError } from '@/utils/debug';
import {
  composeLayerOwnedProjectObjectsIntoLayerSource,
  drawLayerOwnedProjectObjectsForLayer,
  hasLayerOwnedProjectObjects,
} from '@/utils/layerOwnedProjectObjects';

export interface LayerCompositeDrawingDeps {
  createLayerTransferCanvas: (
    width: number,
    height: number,
  ) => HTMLCanvasElement | OffscreenCanvas | null;
  hasValidFramebuffer: (
    framebuffer: HTMLCanvasElement | OffscreenCanvas | null | undefined,
  ) => framebuffer is HTMLCanvasElement | OffscreenCanvas;
}

export const createLayerCompositeDrawing = ({
  createLayerTransferCanvas,
  hasValidFramebuffer,
}: LayerCompositeDrawingDeps) => {
    const adjustmentCompositeCache = createAdjustmentLayerCompositeCache();
    const drawStaticLayers = (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sortedLayers: Layer[],
      project: Project,
      dirtyRects?: ColorCycleDirtyRect[],
    ) => {
      const shouldPartialDraw = Boolean(dirtyRects?.length);
      const interlaceGroupIds = new Set(
        (project.layerGroups ?? [])
          .filter(isInterlaceGroup)
          .filter((group) => sortedLayers.filter((layer) => (
            layer.visible && layer.layerType !== 'sequential' && layer.groupId === group.id
          )).length >= 2)
          .map((group) => group.id),
      );

      if (shouldPartialDraw && dirtyRects) {
        dirtyRects.forEach((rect) => {
          ctx.clearRect(rect.x, rect.y, rect.width, rect.height);
          if (project.backgroundColor && project.backgroundColor !== 'transparent') {
            ctx.fillStyle = project.backgroundColor;
            ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
          }
        });
        ctx.save();
        ctx.beginPath();
        dirtyRects.forEach((rect) => {
          ctx.rect(rect.x, rect.y, rect.width, rect.height);
        });
        ctx.clip();
      } else {
        ctx.clearRect(0, 0, project.width, project.height);
        if (project.backgroundColor && project.backgroundColor !== 'transparent') {
          ctx.fillStyle = project.backgroundColor;
          ctx.fillRect(0, 0, project.width, project.height);
        }
      }

      for (const layer of sortedLayers) {
        if (
          !layer.visible ||
          layer.layerType === 'adjustment' ||
          layer.layerType === 'color-cycle' ||
          layer.layerType === 'sequential' ||
          (layer.groupId ? interlaceGroupIds.has(layer.groupId) : false)
        ) {
          continue;
        }
        let source: CanvasImageSource | null = null;

        if (hasValidFramebuffer(layer.framebuffer)) {
          source = layer.framebuffer as CanvasImageSource;
        } else if (layer.imageData) {
          const layerCanvas = createLayerTransferCanvas(layer.imageData.width, layer.imageData.height);
          if (!layerCanvas) {
            continue;
          }
          const layerCtx = layerCanvas.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          if (!layerCtx) {
            continue;
          }
          layerCtx.putImageData(layer.imageData, 0, 0);
          source = layerCanvas as CanvasImageSource;
        }

        ctx.globalCompositeOperation = layer.blendMode;
        ctx.globalAlpha = layer.opacity;
        if (source) {
          ctx.drawImage(source, 0, 0);
        }
        drawLayerOwnedProjectObjectsForLayer(ctx, project, layer.id);
      }

      if (shouldPartialDraw) {
        ctx.restore();
      }
      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };

    const drawAllLayersInOrder = (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sortedLayers: Layer[],
      project: Project,
      manager: ColorCycleBrushManager | null,
      frameIndex: number,
      liveLayerOverlay?: {
        layerId: string;
        canvas: HTMLCanvasElement;
        mode: 'over' | 'replace';
      },
    ): void => {
      ctx.clearRect(0, 0, project.width, project.height);
      if (project.backgroundColor && project.backgroundColor !== 'transparent') {
        ctx.fillStyle = project.backgroundColor;
        ctx.fillRect(0, 0, project.width, project.height);
      }

      const brushManager = manager ?? getColorCycleBrushManager();
      const groupById = new Map((project.layerGroups ?? []).map((group) => [group.id, group]));
      const interlaceLayersByGroupId = new Map<string, Layer[]>();
      sortedLayers.forEach((layer) => {
        const group = layer.groupId ? groupById.get(layer.groupId) : undefined;
        if (layer.visible && layer.layerType !== 'sequential' && isInterlaceGroup(group)) {
          interlaceLayersByGroupId.set(
            group.id,
            [...(interlaceLayersByGroupId.get(group.id) ?? []), layer],
          );
        }
      });
      const drawnInterlaceGroupIds = new Set<string>();

      const resolveInterlaceSource = (layer: Layer): InterlaceRenderSource | null => {
        let source: CanvasImageSource | null = null;
        if (layer.layerType === 'color-cycle' && layer.colorCycleData?.canvas) {
          const canvas = layer.colorCycleData.canvas;
          if (layer.colorCycleData.mode !== 'recolor') {
            const brush = brushManager?.getSurfaceBrush(layer.id);
            try {
              if (layer.colorCycleData.isAnimating) brush?.updateAnimation?.();
              brush?.renderDirectToCanvas?.(canvas, layer.id);
            } catch (error) {
              logError('[compose] Interlace CC advance/render failed', error);
            }
          }
          source = prepareColorCycleCompositeSource(layer, canvas, createLayerTransferCanvas);
        } else if (hasValidFramebuffer(layer.framebuffer)) {
          source = layer.framebuffer as CanvasImageSource;
        } else if (layer.imageData) {
          const transfer = createLayerTransferCanvas(layer.imageData.width, layer.imageData.height);
          const transferContext = transfer?.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings,
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          transferContext?.putImageData(layer.imageData, 0, 0);
          source = transfer as CanvasImageSource | null;
        }
        if (layer.layerType === 'normal') {
          source = composeLayerOwnedProjectObjectsIntoLayerSource({
            source,
            project,
            layerId: layer.id,
            width: project.width,
            height: project.height,
          });
        }
        return source
          ? { source, opacity: layer.opacity, blendMode: layer.blendMode }
          : null;
      };

      const drawLayerToContext = (
        targetContext: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
        layer: Layer,
      ): void => {
        if (layer.layerType === 'sequential' && layer.sequentialData) {
          const source = getSequentialLayerRenderCanvas({
            layer,
            width: project.width,
            height: project.height,
            frameIndex,
          });
          if (!source) return;
          try {
            targetContext.globalCompositeOperation = layer.blendMode;
            targetContext.globalAlpha = layer.opacity;
            targetContext.drawImage(source as CanvasImageSource, 0, 0);
          } catch {
            // ignore transient draw failures
          }
          return;
        }

        if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
          const canvas = layer.colorCycleData.canvas;
          if (!canvas) return;
          if (layer.colorCycleData.mode !== 'recolor') {
            const brush = brushManager?.getSurfaceBrush(layer.id);
            if (brush) {
              try {
                const wantPlaying = Boolean(layer.colorCycleData.isAnimating);
                const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;
                if (wantPlaying && !isPlaying) brush.startAnimation?.();
                else if (!wantPlaying && isPlaying) brush.stopAnimation?.();
                if (wantPlaying) brush.updateAnimation?.();
                brush.renderDirectToCanvas?.(canvas, layer.id);
              } catch (error) {
                logError('[compose] CC advance/render failed', error);
              }
            }
          }
          const source = prepareColorCycleCompositeSource(layer, canvas, createLayerTransferCanvas);
          try {
            targetContext.globalCompositeOperation = layer.blendMode;
            targetContext.globalAlpha = layer.opacity;
            targetContext.drawImage(source, 0, 0);
          } catch (error) {
            logError('[compose] Layer compose error', error);
          }
          return;
        }

        let source: CanvasImageSource | null = null;
        if (hasValidFramebuffer(layer.framebuffer)) {
          source = layer.framebuffer as CanvasImageSource;
        } else if (layer.imageData) {
          const layerCanvas = createLayerTransferCanvas(layer.imageData.width, layer.imageData.height);
          const layerContext = layerCanvas?.getContext(
            '2d',
            { willReadFrequently: true } as CanvasRenderingContext2DSettings,
          ) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
          layerContext?.putImageData(layer.imageData, 0, 0);
          source = layerCanvas as CanvasImageSource | null;
        }
        const liveOverlay = liveLayerOverlay?.layerId === layer.id ? liveLayerOverlay.canvas : null;
        const hasSemanticObjects = layer.layerType === 'normal'
          && hasLayerOwnedProjectObjects(project, layer.id);
        if (!source && !liveOverlay && !hasSemanticObjects) return;
        targetContext.globalCompositeOperation = layer.blendMode;
        targetContext.globalAlpha = layer.opacity;
        if (source && (!liveOverlay || liveLayerOverlay?.mode !== 'replace')) {
          targetContext.drawImage(source, 0, 0);
        }
        if (liveOverlay) targetContext.drawImage(liveOverlay, 0, 0);
        if (layer.layerType === 'normal') {
          drawLayerOwnedProjectObjectsForLayer(targetContext, project, layer.id);
        }
      };

      if (hasVisibleAdjustmentLayers(sortedLayers)) {
        renderAdjustmentAwareLayerStack({
          context: ctx,
          sortedLayers,
          layerGroups: project.layerGroups ?? [],
          width: project.width,
          height: project.height,
          cache: adjustmentCompositeCache,
          drawLayer: drawLayerToContext,
          drawInterlaceGroup: (targetContext, group, members) => {
            const sources = members
              .map(resolveInterlaceSource)
              .filter((source): source is InterlaceRenderSource => Boolean(source));
            if (!group.interlace) return;
            drawSierraLiteInterlace({
              context: targetContext,
              width: project.width,
              height: project.height,
              sources,
              settings: group.interlace,
              elapsedSeconds: getInterlaceElapsedSeconds(),
            });
          },
        });
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        return;
      }

      for (const layer of sortedLayers) {
        if (!layer.visible) {
          continue;
        }

        const group = layer.groupId ? groupById.get(layer.groupId) : undefined;
        const interlaceLayers = group ? interlaceLayersByGroupId.get(group.id) : undefined;
        if (isInterlaceGroup(group) && interlaceLayers && interlaceLayers.length >= 2) {
          if (!drawnInterlaceGroupIds.has(group.id)) {
            const sources = interlaceLayers
              .map(resolveInterlaceSource)
              .filter((source): source is InterlaceRenderSource => Boolean(source));
            drawSierraLiteInterlace({
              context: ctx,
              width: project.width,
              height: project.height,
              sources,
              settings: group.interlace,
              elapsedSeconds: getInterlaceElapsedSeconds(),
            });
            drawnInterlaceGroupIds.add(group.id);
          }
          continue;
        }

        drawLayerToContext(ctx, layer);
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;
    };

    const drawColorCycleLayers = (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sortedLayers: Layer[],
      project: Project,
      manager: ColorCycleBrushManager | null,
      options?: { clear?: boolean }
    ): boolean => {
      if (options?.clear !== false) {
        ctx.clearRect(0, 0, project.width, project.height);
      }

      let drewLayer = false;

      const brushManager = manager ?? getColorCycleBrushManager();

      for (const layer of sortedLayers) {
        if (!layer.visible || layer.layerType !== 'color-cycle' || !layer.colorCycleData) {
          continue;
        }

        const canvas = layer.colorCycleData.canvas;
        if (!canvas) {
          continue;
        }

        if (layer.colorCycleData.mode !== 'recolor') {
          const brush = brushManager?.getSurfaceBrush(layer.id);
          if (brush) {
            try {
              const wantPlaying = Boolean(layer.colorCycleData.isAnimating);
              const isPlaying = typeof brush.isPlaying === 'function' ? brush.isPlaying() : false;
              if (wantPlaying && !isPlaying) {
                brush.startAnimation?.();
              } else if (!wantPlaying && isPlaying) {
                brush.stopAnimation?.();
              }
              if (wantPlaying) {
                brush.updateAnimation?.();
              }
              brush.renderDirectToCanvas?.(canvas, layer.id);
            } catch (error) {
              logError('[compose] CC advance/render failed', error);
            }
          }
        }

        const source = prepareColorCycleCompositeSource(layer, canvas, createLayerTransferCanvas);

        try {
          ctx.globalCompositeOperation = layer.blendMode;
          ctx.globalAlpha = layer.opacity;
          ctx.drawImage(source, 0, 0);
          drewLayer = true;
        } catch (error) {
          logError('[compose] Layer compose error', error);
        }
      }

      ctx.globalCompositeOperation = 'source-over';
      ctx.globalAlpha = 1;

      return drewLayer;
    };

  return {
    drawStaticLayers,
    drawAllLayersInOrder,
    drawColorCycleLayers,
  };
};
