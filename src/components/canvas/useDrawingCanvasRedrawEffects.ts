import type React from 'react';
import { useEffect } from 'react';
import { useAppStore } from '@/stores/useAppStore';

interface UseDrawingCanvasRedrawEffectsOptions {
  layersNeedRecomposition: boolean;
  compositeCanvasDirtyRef: React.MutableRefObject<boolean>;
  rebuildStaticComposite: () => boolean | Promise<boolean>;
  renderSplitComposites: () => void;
  lastCompositeHashRef: React.MutableRefObject<string>;
  layersHash: string;
  lastActiveLayerIdRef: React.MutableRefObject<string | null>;
  activeLayerId: string | null;
  lastSampleRef: React.MutableRefObject<{ x: number; y: number; color: string; layerId: string | null; preferReference: boolean }>;
  preferReferenceSampling: boolean;
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
  selectionStart: unknown;
  selectionEnd: unknown;
  hadSelectionRef: React.MutableRefObject<boolean>;
  refreshColorCycleSegments: () => void;
}

export const useDrawingCanvasRedrawEffects = ({
  layersNeedRecomposition,
  compositeCanvasDirtyRef,
  rebuildStaticComposite,
  renderSplitComposites,
  lastCompositeHashRef,
  layersHash,
  lastActiveLayerIdRef,
  activeLayerId,
  lastSampleRef,
  preferReferenceSampling,
  setLayersNeedRecomposition,
  setNeedsRedraw,
  canvasRef,
  drawRef,
  viewTransformRef,
  selectionStart,
  selectionEnd,
  hadSelectionRef,
  refreshColorCycleSegments,
}: UseDrawingCanvasRedrawEffectsOptions) => {
  useEffect(() => {
    if (!layersNeedRecomposition) return;

    const onCompositeRebuildResolved = (rebuilt: boolean) => {
      if (rebuilt) {
        renderSplitComposites();
        compositeCanvasDirtyRef.current = false;
        lastCompositeHashRef.current = layersHash;
        lastActiveLayerIdRef.current = activeLayerId ?? null;
        lastSampleRef.current = { x: -1, y: -1, color: 'rgb(0, 0, 0)', layerId: null, preferReference: preferReferenceSampling };
        setLayersNeedRecomposition(false);
      }

      setNeedsRedraw((prev) => prev + 1);

      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      const drawFunc = drawRef.current;
      if (ctx && drawFunc && viewTransformRef.current) {
        drawFunc(ctx, viewTransformRef.current);
      }
    };

    compositeCanvasDirtyRef.current = true;
    const rebuiltResult = rebuildStaticComposite();
    if (typeof rebuiltResult === 'object' && rebuiltResult !== null && 'then' in rebuiltResult) {
      void rebuiltResult.then(onCompositeRebuildResolved);
      return;
    }
    onCompositeRebuildResolved(Boolean(rebuiltResult));
  }, [
    layersNeedRecomposition,
    compositeCanvasDirtyRef,
    rebuildStaticComposite,
    renderSplitComposites,
    lastCompositeHashRef,
    layersHash,
    lastActiveLayerIdRef,
    activeLayerId,
    lastSampleRef,
    preferReferenceSampling,
    setLayersNeedRecomposition,
    setNeedsRedraw,
    canvasRef,
    drawRef,
    viewTransformRef,
  ]);

  useEffect(() => {
    const hasSelection = Boolean(selectionStart && selectionEnd);

    setNeedsRedraw((prev) => prev + 1);

    if (hadSelectionRef.current && !hasSelection) {
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx && drawRef.current && viewTransformRef.current) {
        drawRef.current(ctx, viewTransformRef.current);
      }
    }

    hadSelectionRef.current = hasSelection;
  }, [selectionStart, selectionEnd, setNeedsRedraw, hadSelectionRef, canvasRef, drawRef, viewTransformRef]);

  useEffect(() => {
    const handleColorCycleFrame = () => {
      refreshColorCycleSegments();
      setNeedsRedraw((prev) => prev + 1);
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext('2d', { willReadFrequently: true });
      if (ctx && drawRef.current && viewTransformRef.current) {
        drawRef.current(ctx, viewTransformRef.current);
      }
    };

    window.addEventListener('colorCycleFrameReady', handleColorCycleFrame);
    window.addEventListener('colorCycleFrameUpdate', handleColorCycleFrame);
    window.addEventListener('vessel:animationFrameUpdate', handleColorCycleFrame);

    return () => {
      window.removeEventListener('colorCycleFrameReady', handleColorCycleFrame);
      window.removeEventListener('colorCycleFrameUpdate', handleColorCycleFrame);
      window.removeEventListener('vessel:animationFrameUpdate', handleColorCycleFrame);
    };
  }, [refreshColorCycleSegments, setNeedsRedraw, canvasRef, drawRef, viewTransformRef]);

  useEffect(() => {
    let prevLength = useAppStore.getState().history.undoStack.length;
    const unsubscribe = useAppStore.subscribe((state) => {
      const length = state.history.undoStack.length;
      if (length > prevLength) {
        // quiet
      }
      prevLength = length;
    });
    return unsubscribe;
  }, []);
};
