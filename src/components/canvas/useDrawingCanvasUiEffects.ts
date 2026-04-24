import { getAppStoreState } from '@/stores/appStoreAccess';
import type React from 'react';
import { useEffect } from 'react';
import { flushBufferedSequentialEvents } from '@/hooks/canvas/handlers/sequential/sequentialCapture';

interface UseDrawingCanvasUiEffectsOptions {
  selectionStart: unknown;
  selectionEnd: unknown;
  floatingPaste: unknown;
  setMarchingAntsOffset: React.Dispatch<React.SetStateAction<number>>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  draw: (
    ctx: CanvasRenderingContext2D,
    transform: { scale: number; offsetX: number; offsetY: number },
    skipDrawingCanvas?: boolean
  ) => void;
  viewTransformRef: React.MutableRefObject<{ scale: number; offsetX: number; offsetY: number }>;
  defaultCursorStyle: string;
  isPointerInsideCanvas: () => boolean;
  setCursorStyle: React.Dispatch<React.SetStateAction<string>>;
  setShowBrushCursor: React.Dispatch<React.SetStateAction<boolean>>;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  mode: string;
  canvasZoom: number;
  canvasOffsetX: number;
  canvasOffsetY: number;
  needsRedraw: number;
}

export const useDrawingCanvasUiEffects = ({
  selectionStart,
  selectionEnd,
  floatingPaste,
  setMarchingAntsOffset,
  canvasRef,
  draw,
  viewTransformRef,
  defaultCursorStyle,
  isPointerInsideCanvas,
  setCursorStyle,
  setShowBrushCursor,
  wrapperRef,
  mode,
  canvasZoom,
  canvasOffsetX,
  canvasOffsetY,
  needsRedraw,
}: UseDrawingCanvasUiEffectsOptions) => {
  useEffect(() => {
    let animationId: number | null = null;
    let frameCount = 0;
    let isActive = true;

    if ((selectionStart && selectionEnd) || floatingPaste) {
      const animate = () => {
        if (!isActive) return;

        frameCount += 1;
        if (frameCount % 3 === 0) {
          setMarchingAntsOffset((prev) => (prev + 1) % 10);
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d', { willReadFrequently: true });
          if (ctx) {
            draw(ctx, viewTransformRef.current);
          }
        }
        animationId = requestAnimationFrame(animate);
      };
      animationId = requestAnimationFrame(animate);
    }

    return () => {
      isActive = false;
      if (animationId !== null) {
        cancelAnimationFrame(animationId);
      }
    };
  }, [canvasRef, draw, floatingPaste, selectionEnd, selectionStart, setMarchingAntsOffset, viewTransformRef]);

  useEffect(() => {
    const handleInteractionReset = () => {
      const store = getAppStoreState();
      if (typeof store.setSequentialPointerDown === 'function') {
        store.setSequentialPointerDown(false);
      }
      flushBufferedSequentialEvents({ state: store });
      // Always normalize cursor UI on blur/visibility loss to recover
      // from keyup-loss or state-machine/ref desync during pan.
      setCursorStyle(defaultCursorStyle);
      setShowBrushCursor(isPointerInsideCanvas());
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        handleInteractionReset();
      }
    };

    window.addEventListener('blur', handleInteractionReset);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      window.removeEventListener('blur', handleInteractionReset);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [
    defaultCursorStyle,
    isPointerInsideCanvas,
    setCursorStyle,
    setShowBrushCursor,
  ]);

  useEffect(() => {
    if (wrapperRef.current) {
      wrapperRef.current.focus();
    }
  }, [wrapperRef]);

  useEffect(() => {
    if (mode === 'PANNING') return;

    const canvasElement = canvasRef.current;
    const ctx = canvasElement?.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    draw(ctx, viewTransformRef.current);
  }, [
    canvasRef,
    canvasOffsetX,
    canvasOffsetY,
    canvasZoom,
    draw,
    floatingPaste,
    mode,
    needsRedraw,
    viewTransformRef,
  ]);
};
