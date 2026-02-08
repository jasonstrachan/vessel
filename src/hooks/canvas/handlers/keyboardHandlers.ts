import type React from 'react';
import { useAppStore } from '@/stores/useAppStore';
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
    if (!scopeAllowsSpace() || isTextEntryTarget(target)) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    deps.isSpacePressedRef.current = false;
    deps.setIsSpacePressed?.(false);

    if (deps.pan.panState.isPanning) {
      deps.pan.endPan();
    }
    deps.setCursorStyle(deps.defaultCursorStyle ?? 'crosshair');
    deps.setShowBrushCursor(true);
    void deps.resumeAnimationAfterPan?.();
  };

  const handleBlur = (event: React.FocusEvent) => {
    const newFocusTarget = event.relatedTarget as HTMLElement | null;
    if (newFocusTarget && deps.wrapperRef.current?.contains(newFocusTarget)) {
      return;
    }

    if (deps.stateMachine.state.isSpacePressed) {
      deps.stateMachine.dispatch({ type: 'SPACE_UP' });
      deps.setCursorStyle(deps.defaultCursorStyle ?? 'crosshair');
      deps.setShowBrushCursor(deps.isPointerInsideCanvas?.() ?? false);
    }
  };

  return {
    handleKeyDown,
    handleKeyUp,
    handleBlur,
  };
};
