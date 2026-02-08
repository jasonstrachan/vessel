import type React from 'react';
import { useEffect } from 'react';

interface UseDrawingCanvasCompositeRebuildOptions {
  project: { width: number; height: number } | null;
  activeLayerId: string | null;
  layersHash: string;
  layersNeedRecomposition: boolean;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  lastCompositeHashRef: React.MutableRefObject<string>;
  lastActiveLayerIdRef: React.MutableRefObject<string | null>;
  lastSampleRef: React.MutableRefObject<{ x: number; y: number; color: string; layerId: string | null; preferReference: boolean }>;
  preferReferenceSampling: boolean;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  renderSplitComposites: () => void;
  setLayersNeedRecomposition: (next: boolean) => void;
  setNeedsRedraw: React.Dispatch<React.SetStateAction<number>>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  drawRef: React.MutableRefObject<
    | ((
        ctx: CanvasRenderingContext2D,
        transform: { scale: number; offsetX: number; offsetY: number },
        skipDrawingCanvas?: boolean
      ) => void)
    | null
  >;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
}

export const useDrawingCanvasCompositeRebuild = ({
  project,
  activeLayerId,
  layersHash,
  layersNeedRecomposition,
  compositeCanvasDirtyRef,
  lastCompositeHashRef,
  lastActiveLayerIdRef,
  lastSampleRef,
  preferReferenceSampling,
  rebuildStaticComposite,
  renderSplitComposites,
  setLayersNeedRecomposition,
  setNeedsRedraw,
  canvasRef,
  drawRef,
  viewTransformRef,
}: UseDrawingCanvasCompositeRebuildOptions) => {
  useEffect(() => {
    if (!project) return;

    const activeLayerChanged = activeLayerId !== lastActiveLayerIdRef.current;

    if (
      layersHash === lastCompositeHashRef.current &&
      !compositeCanvasDirtyRef.current &&
      !layersNeedRecomposition &&
      !activeLayerChanged
    ) {
      return;
    }

    const onRebuilt = (rebuilt: boolean) => {
      if (!rebuilt) return;

      renderSplitComposites();
      lastCompositeHashRef.current = layersHash;
      lastActiveLayerIdRef.current = activeLayerId ?? null;
      compositeCanvasDirtyRef.current = false;
      lastSampleRef.current = { x: -1, y: -1, color: 'rgb(0, 0, 0)', layerId: null, preferReference: preferReferenceSampling };
      if (layersNeedRecomposition) {
        setLayersNeedRecomposition(false);
      }
      setNeedsRedraw((prev) => prev + 1);

      const canvas = canvasRef.current;
      if (canvas && drawRef.current && viewTransformRef.current) {
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          drawRef.current(ctx, viewTransformRef.current);
        }
      }
    };

    const rebuiltResult = rebuildStaticComposite();
    if (typeof rebuiltResult === 'object' && rebuiltResult !== null && 'then' in rebuiltResult) {
      void rebuiltResult.then(onRebuilt);
      return;
    }
    onRebuilt(Boolean(rebuiltResult));
  }, [
    activeLayerId,
    canvasRef,
    compositeCanvasDirtyRef,
    drawRef,
    lastActiveLayerIdRef,
    lastCompositeHashRef,
    lastSampleRef,
    layersHash,
    layersNeedRecomposition,
    preferReferenceSampling,
    project,
    rebuildStaticComposite,
    renderSplitComposites,
    setLayersNeedRecomposition,
    setNeedsRedraw,
    viewTransformRef,
  ]);
};
