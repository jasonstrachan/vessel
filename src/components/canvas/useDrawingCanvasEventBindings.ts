import type React from 'react';
import { useEffect } from 'react';

interface UseDrawingCanvasEventBindingsOptions {
  eventHandleKeyDown: (event: KeyboardEvent) => void;
  eventHandleKeyUp: (event: KeyboardEvent) => void;
  eventHandleWheel: (event: WheelEvent) => void;
  eventHandlePaste: (event: ClipboardEvent) => void;
  wrapperRef: React.RefObject<HTMLDivElement | null>;
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
}

export const useDrawingCanvasEventBindings = ({
  eventHandleKeyDown,
  eventHandleKeyUp,
  eventHandleWheel,
  eventHandlePaste,
  wrapperRef,
  canvasRef,
}: UseDrawingCanvasEventBindingsOptions) => {
  useEffect(() => {
    const listenerOptions: AddEventListenerOptions = { capture: true };
    window.addEventListener('keydown', eventHandleKeyDown, listenerOptions);
    window.addEventListener('keyup', eventHandleKeyUp, listenerOptions);
    return () => {
      window.removeEventListener('keydown', eventHandleKeyDown, listenerOptions);
      window.removeEventListener('keyup', eventHandleKeyUp, listenerOptions);
    };
  }, [eventHandleKeyDown, eventHandleKeyUp]);

  useEffect(() => {
    const primaryTarget = wrapperRef.current ?? canvasRef.current;
    if (!primaryTarget) {
      return;
    }
    const listenerOptions: AddEventListenerOptions = { passive: false };
    const wheelListener: EventListener = (event) => {
      eventHandleWheel(event as WheelEvent);
    };
    primaryTarget.addEventListener('wheel', wheelListener, listenerOptions);
    return () => {
      primaryTarget.removeEventListener('wheel', wheelListener);
    };
  }, [eventHandleWheel, wrapperRef, canvasRef]);

  useEffect(() => {
    document.addEventListener('paste', eventHandlePaste);
    return () => {
      document.removeEventListener('paste', eventHandlePaste);
    };
  }, [eventHandlePaste]);
};
