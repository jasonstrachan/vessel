import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import { useCallback } from 'react';
import { BrushShape, type Layer, type Project } from '@/types';
import {
  composeTxtShapesIntoLayerSource,
  drawCachedTxtShapesForLayer,
} from '@/utils/txtShape';
import { selectSequentialPlaybackActive, type AppState } from '@/stores/useAppStore';
import {
  getSequentialLayerRenderCanvas,
} from '@/lib/sequential/SequentialLayerRenderer';
import { getSequentialRenderFrame } from '@/runtime/playback/sequentialFrameCursor';
import { getInterlaceElapsedSeconds } from '@/lib/interlace/interlaceClock';
import { drawSierraLiteInterlace, type InterlaceRenderSource } from '@/lib/interlace/interlaceRenderer';
import { isInterlaceGroup } from '@/lib/interlace/interlaceSettings';
import { getLayerTransferCanvas, type LayerTransferCacheEntry } from './layerTransferCache';
import {
  getColorCyclePresentationCanvas,
  resolveColorCyclePresentation,
} from './resolveColorCyclePresentation';

interface UseDrawingCanvasLayerRenderingOptions {
  project: Pick<Project, 'width' | 'height' | 'backgroundColor' | 'txtShapes'> | null;
  layers: Layer[];
  activeLayerId: string | null;
  brushShape: BrushShape | undefined;
  antialiasing: boolean;
  displayMode: 'auto' | 'pixelated' | 'smooth';
  layerTransferCacheRef: React.MutableRefObject<Map<string, LayerTransferCacheEntry>>;
}

export const useDrawingCanvasLayerRendering = ({
  project,
  layers,
  activeLayerId,
  brushShape,
  antialiasing,
  displayMode,
  layerTransferCacheRef,
}: UseDrawingCanvasLayerRenderingOptions) => {
  return useCallback((ctx: CanvasRenderingContext2D) => {
    if (!project) return;

    const sortedLayers = [...layers].sort((a, b) => a.order - b.order);
    const activeId = activeLayerId;
    const storeState = getAppStoreState() as AppState;
    const sequentialFrameIndex = getSequentialRenderFrame(storeState);
    const shouldHoldPreviousSequentialFrame = !selectSequentialPlaybackActive(storeState);
    const groupById = new Map((storeState.layerGroups ?? []).map((group) => [group.id, group]));
    const activeGroupId = sortedLayers.find((layer) => layer.id === activeId)?.groupId;
    const interlaceLayersByGroupId = new Map<string, Layer[]>();
    sortedLayers.forEach((layer) => {
      const group = layer.groupId ? groupById.get(layer.groupId) : undefined;
      if (
        layer.visible
        && layer.id !== activeId
        && layer.groupId !== activeGroupId
        && layer.layerType !== 'sequential'
        && isInterlaceGroup(group)
      ) {
        interlaceLayersByGroupId.set(
          group.id,
          [...(interlaceLayersByGroupId.get(group.id) ?? []), layer],
        );
      }
    });
    const paintedInterlaceGroupIds = new Set<string>();
    const isPixelatedDisplay = displayMode === 'pixelated';
    const shouldSmooth = !isPixelatedDisplay && !(
      brushShape === BrushShape.PIXEL_ROUND ||
      (brushShape === BrushShape.SQUARE && !antialiasing)
    );

    ctx.save();
    ctx.imageSmoothingEnabled = shouldSmooth;

    if (project.backgroundColor && project.backgroundColor !== 'transparent') {
      ctx.fillStyle = project.backgroundColor;
      ctx.fillRect(0, 0, project.width, project.height);
    }

    for (const layer of sortedLayers) {
      if (!layer.visible || layer.id === activeId) {
        continue;
      }

      const group = layer.groupId ? groupById.get(layer.groupId) : undefined;
      const interlaceLayers = group ? interlaceLayersByGroupId.get(group.id) : undefined;
      if (isInterlaceGroup(group) && interlaceLayers && interlaceLayers.length >= 2) {
        if (!paintedInterlaceGroupIds.has(group.id)) {
          const sources = interlaceLayers.flatMap<InterlaceRenderSource>((member) => {
            let source: CanvasImageSource | null = null;
            if (member.layerType === 'color-cycle') {
              const presentation = resolveColorCyclePresentation({
                layer: member,
                activeLayerId,
                projectWidth: project.width,
                projectHeight: project.height,
              });
              source = getColorCyclePresentationCanvas(presentation, member);
            } else if (member.framebuffer) {
              source = member.framebuffer as CanvasImageSource;
            } else if (member.imageData) {
              source = getLayerTransferCanvas(member, layerTransferCacheRef.current);
            }
            if (member.layerType === 'normal') {
              source = composeTxtShapesIntoLayerSource({
                source,
                shapes: project.txtShapes,
                layerId: member.id,
                width: project.width,
                height: project.height,
              });
            }
            return source
              ? [{ source, opacity: member.opacity, blendMode: member.blendMode }]
              : [];
          });
          drawSierraLiteInterlace({
            context: ctx,
            width: project.width,
            height: project.height,
            sources,
            settings: group.interlace,
            elapsedSeconds: getInterlaceElapsedSeconds(),
          });
          paintedInterlaceGroupIds.add(group.id);
        }
        continue;
      }

      ctx.save();
      ctx.globalCompositeOperation = layer.blendMode;
      ctx.globalAlpha = layer.opacity;

      if (layer.layerType === 'color-cycle') {
        const presentation = resolveColorCyclePresentation({
          layer,
          activeLayerId,
          projectWidth: project.width,
          projectHeight: project.height,
        });
        const source = getColorCyclePresentationCanvas(presentation, layer);
        if (source) {
          try {
            ctx.drawImage(source, 0, 0);
          } catch {
            // ignore transient color cycle draw errors
          }
        }
      } else if (layer.layerType === 'sequential' && layer.sequentialData) {
        const source = getSequentialLayerRenderCanvas({
          layer,
          width: project.width,
          height: project.height,
          frameIndex: sequentialFrameIndex,
          holdPreviousOnEmptyFrames: shouldHoldPreviousSequentialFrame,
        });
        if (source) {
          try {
            ctx.drawImage(source as CanvasImageSource, 0, 0);
          } catch {
            // ignore transient draw errors
          }
        }
      } else if (layer.framebuffer) {
        try {
          ctx.drawImage(layer.framebuffer as CanvasImageSource, 0, 0);
        } catch {
          // ignore transient draw errors
        }
      } else if (layer.imageData) {
        const transferCanvas = getLayerTransferCanvas(layer, layerTransferCacheRef.current);
        if (transferCanvas) {
          try {
            ctx.drawImage(transferCanvas, 0, 0);
          } catch {
            // ignore transient draw errors
          }
        }
      }

      if (layer.layerType === 'normal') {
        drawCachedTxtShapesForLayer(
          ctx,
          project.txtShapes,
          layer.id,
          project.width,
          project.height,
        );
      }

      ctx.restore();
    }

    ctx.restore();

  }, [activeLayerId, antialiasing, brushShape, displayMode, layerTransferCacheRef, layers, project]);
};
