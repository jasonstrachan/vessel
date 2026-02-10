import type React from 'react';
import { createKeyboardHandlers } from '@/hooks/canvas/handlers/keyboardHandlers';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/stores/useAppStore', () => ({
  useAppStore: {
    getState: jest.fn(),
  },
}));

const mockedUseAppStore = useAppStore as unknown as {
  getState: jest.Mock;
};

type KeyboardDeps = Parameters<typeof createKeyboardHandlers>[0];

const createDeps = (): KeyboardDeps => {
  const dispatch = jest.fn();
  const endPan = jest.fn(() => {
    (deps.pan.panState as { isPanning: boolean }).isPanning = false;
  });

  const deps = {
    isSpacePressedRef: { current: false },
    setIsSpacePressed: jest.fn(),
    setShowBrushCursor: jest.fn(),
    setCursorStyle: jest.fn(),
    isMouseDownRef: { current: false },
    mousePositionRef: { current: { x: 12, y: 34 } },
    pan: {
      panState: {
        isPanning: false,
      },
      startPan: jest.fn(),
      endPan,
    },
    pauseAnimationForPan: jest.fn(),
    resumeAnimationAfterPan: jest.fn(),
    stateMachine: {
      state: { isSpacePressed: false },
      dispatch,
    },
    wrapperRef: { current: document.createElement('div') },
    defaultCursorStyle: 'crosshair',
    isPointerInsideCanvas: jest.fn(() => true),
  } as unknown as KeyboardDeps;

  return deps;
};

describe('createKeyboardHandlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockedUseAppStore.getState.mockReturnValue({
      ui: { keyboardScope: { active: 'canvas' } },
      brushEditor: { status: 'IDLE' },
    });
  });

  it('sets space state on keydown and dispatches SPACE_DOWN', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    handlers.handleKeyDown(new KeyboardEvent('keydown', { code: 'Space' }));

    expect(deps.isSpacePressedRef.current).toBe(true);
    expect(deps.setIsSpacePressed).toHaveBeenCalledWith(true);
    expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'SPACE_DOWN' });
    expect(deps.setCursorStyle).toHaveBeenCalledWith('grab');
  });

  it('releases stuck space on keyup even when scope no longer allows space', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    deps.isSpacePressedRef.current = true;
    (deps.pan.panState as { isPanning: boolean }).isPanning = true;
    deps.stateMachine.state.isSpacePressed = true;
    mockedUseAppStore.getState.mockReturnValue({
      ui: { keyboardScope: { active: 'modal' } },
      brushEditor: { status: 'IDLE' },
    });

    handlers.handleKeyUp(new KeyboardEvent('keyup', { code: 'Space' }));

    expect(deps.isSpacePressedRef.current).toBe(false);
    expect(deps.pan.endPan).toHaveBeenCalledTimes(1);
    expect(deps.stateMachine.dispatch).toHaveBeenCalledWith({ type: 'SPACE_UP' });
    expect(deps.setCursorStyle).toHaveBeenCalledWith('crosshair');
  });

  it('releases space on blur based on ref state even if stateMachine is stale', () => {
    const deps = createDeps();
    const handlers = createKeyboardHandlers(deps);

    deps.isSpacePressedRef.current = true;
    deps.stateMachine.state.isSpacePressed = false;

    handlers.handleBlur({ relatedTarget: null } as unknown as React.FocusEvent);

    expect(deps.isSpacePressedRef.current).toBe(false);
    expect(deps.setCursorStyle).toHaveBeenCalledWith('crosshair');
  });
});
