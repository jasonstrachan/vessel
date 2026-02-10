import type React from 'react';
import { useAppStore } from '@/stores/useAppStore';
import type { EventHandlerDependencies, KeyboardHandlers } from '../utils/types';
import { traceStrokeLock } from '@/hooks/canvas/handlers/strokeLockDebug';

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
  const releaseSpaceInteraction = () => {
    traceStrokeLock('keyboard.space.release.begin', {
      isSpaceRef: deps.isSpacePressedRef.current,
      stateMachineSpace: deps.stateMachine.state.isSpacePressed,
      isPanning: deps.pan.panState.isPanning,
    });
    deps.isSpacePressedRef.current = false;
    deps.setIsSpacePressed?.(false);

    if (deps.pan.panState.isPanning) {
      deps.pan.endPan();
    }

    if (deps.stateMachine.state.isSpacePressed) {
      deps.stateMachine.dispatch({ type: 'SPACE_UP' });
    }

    deps.setCursorStyle(deps.defaultCursorStyle ?? 'crosshair');
    deps.setShowBrushCursor(deps.isPointerInsideCanvas?.() ?? true);
    void deps.resumeAnimationAfterPan?.();
    traceStrokeLock('keyboard.space.release.end', {
      isSpaceRef: deps.isSpacePressedRef.current,
      stateMachineSpace: deps.stateMachine.state.isSpacePressed,
      isPanning: deps.pan.panState.isPanning,
    });
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
      deps.setIsSpacePressed?.(true);
      deps.stateMachine.dispatch({ type: 'SPACE_DOWN' });
      traceStrokeLock('keyboard.space.down', {
        scope: useAppStore.getState().ui.keyboardScope.active,
        targetType: target?.tagName ?? 'unknown',
      });
      deps.setShowBrushCursor(false);
      deps.setCursorStyle('grab');

      if (deps.isMouseDownRef.current) {
        const pointer = deps.mousePositionRef?.current ?? { x: 0, y: 0 };
        const { x: pointerX, y: pointerY } = pointer;
        deps.pan.startPan(pointerX, pointerY);
        deps.setCursorStyle('grabbing');
        deps.pauseAnimationForPan?.();
      }
      return;
    }

    const currentScope = useAppStore.getState().ui.keyboardScope.active;
    if (currentScope !== 'canvas') {
      return;
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
    traceStrokeLock('keyboard.space.up', {
      scope: useAppStore.getState().ui.keyboardScope.active,
      targetType: target?.tagName ?? 'unknown',
    });
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
      traceStrokeLock('keyboard.blur.release', {
        hasRelatedTarget: Boolean(newFocusTarget),
      });
      releaseSpaceInteraction();
    }
  };

  return {
    handleKeyDown,
    handleKeyUp,
    handleBlur,
  };
};
