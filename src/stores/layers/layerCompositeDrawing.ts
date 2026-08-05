import type { ColorCycleDirtyRect } from '@/lib/colorCycle/document/ColorCycleLayerDocument';
import { getSequentialLayerRenderCanvas } from '@/lib/sequential/SequentialLayerRenderer';
import {
  getColorCycleBrushManager,
  type ColorCycleBrushManager,
} from '@/stores/colorCycleBrushManager';
import { prepareColorCycleCompositeSource } from '@/stores/layers/layerColorCycleMaskState';
import type { Layer, Project } from '@/types';
import { logError } from '@/utils/debug';

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
    const drawStaticLayers = (
      ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
      sortedLayers: Layer[],
      project: Project,
      dirtyRects?: ColorCycleDirtyRect[],
    ) => {
      const shouldPartialDraw = Boolean(dirtyRects?.length);

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
          layer.layerType === 'color-cycle' ||
          layer.layerType === 'sequential'
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

        if (!source) {
          continue;
        }
        ctx.globalCompositeOperation = layer.blendMode;
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(source, 0, 0);
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
      frameIndex: number
    ): void => {
      ctx.clearRect(0, 0, project.width, project.height);
      if (project.backgroundColor && project.backgroundColor !== 'transparent') {
        ctx.fillStyle = project.backgroundColor;
        ctx.fillRect(0, 0, project.width, project.height);
      }

      const brushManager = manager ?? getColorCycleBrushManager();

      for (const layer of sortedLayers) {
        if (!layer.visible) {
          continue;
        }

        if (layer.layerType === 'sequential' && layer.sequentialData) {
          const source = getSequentialLayerRenderCanvas({
            layer,
            width: project.width,
            height: project.height,
            frameIndex,
          });
          if (!source) {
            continue;
          }

          try {
            ctx.globalCompositeOperation = layer.blendMode;
            ctx.globalAlpha = layer.opacity;
            ctx.drawImage(source as CanvasImageSource, 0, 0);
          } catch {
            // ignore transient draw failures
          }
          continue;
        }

        if (layer.layerType === 'color-cycle' && layer.colorCycleData) {
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
          } catch (error) {
            logError('[compose] Layer compose error', error);
          }
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

        if (!source) {
          continue;
        }

        ctx.globalCompositeOperation = layer.blendMode;
        ctx.globalAlpha = layer.opacity;
        ctx.drawImage(source, 0, 0);
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
