import type React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import {
  cancelClickLineSelectionSession,
  finalizeClickLineSelectionSession,
} from '@/hooks/canvas/handlers/selectionHandlers';
import { CURSOR_FALLBACK_CROSSHAIR } from '@/hooks/canvas/handlers/utils/cursorFallbacks';
import { resolveSpacePanCursor } from '@/hooks/canvas/handlers/utils/spacePanCursor';
import type { EventHandlerDependencies, KeyboardHandlers } from '../utils/types';

const isTextEntryTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target.isContentEditable
  );
};

const scopeAllowsSpace = (): boolean => {
  const state = useAppStore.getState();
  const currentScope = state.ui.keyboardScope.active;
  const brushEditorStatus = state.brushEditor.status;
  return currentScope === 'canvas' || (currentScope === 'modal' && brushEditorStatus === 'EDITING');
};

export const createKeyboardHandlers = (
  deps: EventHandlerDependencies
): Pick<KeyboardHandlers, 'handleKeyDown' | 'handleKeyUp' | 'handleBlur'> => {
  let panInterruptFinalizeInFlight = false;
  let panInterruptFinalizeScheduled = false;

  const schedulePanInterruptFinalize = () => {
    if (panInterruptFinalizeInFlight || panInterruptFinalizeScheduled) {
      return;
    }

    const runFinalize = () => {
      panInterruptFinalizeScheduled = false;
      if (panInterruptFinalizeInFlight) {
        return;
      }
      panInterruptFinalizeInFlight = true;
      void deps.drawingHandlers.finalizeDrawing(false).finally(() => {
        panInterruptFinalizeInFlight = false;
      });
    };

    if (process.env.NODE_ENV === 'test' || typeof requestAnimationFrame !== 'function') {
      runFinalize();
      return;
    }

    panInterruptFinalizeScheduled = true;
    requestAnimationFrame(() => {
      runFinalize();
    });
  };

  const interruptActiveStrokeForPan = () => {
    if (
      deps.suppressBootstrapUntilPointerUpRef.current ||
      (!deps.isMouseDownRef.current && !deps.interaction.state.isDrawing)
    ) {
      return;
    }
    deps.isMouseDownRef.current = false;
    if (deps.interaction.state.isDrawing) {
      deps.interaction.dispatch({ type: 'DRAWING_END' });
      schedulePanInterruptFinalize();
    }
    deps.compositeCanvasDirtyRef.current = true;
    deps.suppressBootstrapUntilPointerUpRef.current = true;
  };

  const clearSelectionOverlay = () => {
    const overlayCanvas = deps.overlayCanvasRef.current;
    if (!overlayCanvas) {
      return;
    }
    overlayCanvas.getContext('2d')?.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  };

  const redrawCanvas = () => {
    deps.setNeedsRedraw((prev) => prev + 1);
    const canvas = deps.canvasRef.current;
    const ctx = canvas?.getContext('2d', { willReadFrequently: true });
    if (ctx) {
      deps.draw(ctx, deps.viewTransformRef.current);
    }
  };

  const releaseSpaceInteraction = () => {
    deps.isSpacePressedRef.current = false;

    if (deps.pan.panState.isPanning) {
      deps.suppressBootstrapUntilPointerUpRef.current = true;
      deps.pan.endPan();
    }

    if (deps.stateMachine.state.isSpacePressed) {
      deps.stateMachine.dispatch({ type: 'SPACE_UP' });
    }

    deps.setCursorStyle(
      resolveSpacePanCursor({
        isSpaceActive: false,
        isPanning: false,
        defaultCursorStyle: deps.defaultCursorStyle,
        fallbackCursor: CURSOR_FALLBACK_CROSSHAIR,
      })
    );
    deps.setShowBrushCursor(deps.isPointerInsideCanvas?.() ?? true);
    void deps.resumeAnimationAfterPan?.();
  };

  const handleKeyDown = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;

    if (event.code === 'Space' && !deps.isSpacePressedRef.current) {
      if (!scopeAllowsSpace() || isTextEntryTarget(target)) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();

      deps.isSpacePressedRef.current = true;
      deps.stateMachine.dispatch({ type: 'SPACE_DOWN' });
      deps.setShowBrushCursor(false);
      deps.setCursorStyle(
        resolveSpacePanCursor({
          isSpaceActive: true,
          isPanning: false,
          defaultCursorStyle: deps.defaultCursorStyle,
          fallbackCursor: CURSOR_FALLBACK_CROSSHAIR,
        })
      );

      if (deps.isMouseDownRef.current) {
        interruptActiveStrokeForPan();
        const pointer = deps.mousePositionRef?.current ?? { x: 0, y: 0 };
        const { x: pointerX, y: pointerY } = pointer;
        deps.pan.startPan(pointerX, pointerY);
        deps.setCursorStyle(
          resolveSpacePanCursor({
            isSpaceActive: true,
            isPanning: true,
            defaultCursorStyle: deps.defaultCursorStyle,
            fallbackCursor: CURSOR_FALLBACK_CROSSHAIR,
          })
        );
        deps.pauseAnimationForPan?.();
      }
      return;
    }

    const currentScope = useAppStore.getState().ui.keyboardScope.active;
    if (currentScope !== 'canvas') {
      return;
    }

    const dynamic = deps.dynamicDepsRef.current;
    const runtime = deps.selectionRuntimeRef.current;
    const clickLineActive =
      dynamic.tools.currentTool === 'selection' &&
      dynamic.tools.selectionMode === 'click-line' &&
      runtime.clickLineSession.active;

    if (!clickLineActive) {
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (cancelClickLineSelectionSession({ runtime, clearOverlay: clearSelectionOverlay })) {
        redrawCanvas();
      }
      return;
    }

    if (event.key === 'Enter' || event.code === 'NumpadEnter') {
      event.preventDefault();
      event.stopPropagation();
      if (
        finalizeClickLineSelectionSession({
          runtime,
          dynamic,
          clearOverlay: clearSelectionOverlay,
          outcome: 'selection-click-line-keyboard',
          historyMeta: { source: 'keyboard', key: event.key, code: event.code },
        })
      ) {
        redrawCanvas();
      }
    }
  };

  const handleKeyUp = (event: KeyboardEvent) => {
    const target = event.target as HTMLElement | null;
    if (event.code !== 'Space') {
      return;
    }

    const shouldReleaseSpace =
      deps.isSpacePressedRef.current ||
      deps.pan.panState.isPanning ||
      deps.stateMachine.state.isSpacePressed;
    if (!shouldReleaseSpace) {
      return;
    }

    // Always release space interaction even if scope changed or target became text input.
    if (scopeAllowsSpace() && !isTextEntryTarget(target)) {
      event.preventDefault();
      event.stopPropagation();
    }

    releaseSpaceInteraction();
  };

  const handleBlur = (event: React.FocusEvent) => {
    const newFocusTarget = event.relatedTarget as HTMLElement | null;
    if (newFocusTarget && deps.wrapperRef.current?.contains(newFocusTarget)) {
      return;
    }

    if (
      deps.isSpacePressedRef.current ||
      deps.pan.panState.isPanning ||
      deps.stateMachine.state.isSpacePressed
    ) {
      releaseSpaceInteraction();
    }
  };

  return {
    handleKeyDown,
    handleKeyUp,
    handleBlur,
  };
};
