import React from 'react';
import { render, act } from '@testing-library/react';
import { useCanvasStateMachine } from '@/hooks/useCanvasStateMachine';

describe('useCanvasStateMachine', () => {
  const smRef: { current: ReturnType<typeof useCanvasStateMachine> | null } = { current: null };

  const Harness: React.FC = () => {
    smRef.current = useCanvasStateMachine();
    return null;
  };

  const renderHarness = () => {
    render(<Harness />);
    if (!smRef.current) {
      throw new Error('state machine not initialized');
    }
    return smRef.current;
  };

  it('enters AWAITING_PAN when space is pressed from IDLE', () => {
    const sm = renderHarness();

    act(() => sm.dispatch({ type: 'SPACE_DOWN' }));

    expect(sm.stateRef.current.mode).toBe('AWAITING_PAN');
    expect(sm.stateRef.current.isSpacePressed).toBe(true);
  });

  it('finalizes drawing when space pressed mid-stroke', () => {
    const sm = renderHarness();

    act(() => sm.dispatch({ type: 'START_DRAWING', position: { x: 0, y: 0 } }));
    expect(sm.stateRef.current.mode).toBe('DRAWING');

    act(() => sm.dispatch({ type: 'SPACE_DOWN' }));

    expect(sm.stateRef.current.mode).toBe('FINALIZING');
    expect(sm.stateRef.current.isSpacePressed).toBe(true);
    expect(sm.stateRef.current.isMouseDown).toBe(false);
  });

  it('resets to idle with FORCE_IDLE', () => {
    const sm = renderHarness();

    act(() => sm.dispatch({ type: 'SET_BUSY', busy: true }));
    expect(sm.stateRef.current.mode).toBe('BUSY');

    act(() => sm.dispatch({ type: 'FORCE_IDLE' }));
    expect(sm.stateRef.current.mode).toBe('IDLE');
    expect(sm.stateRef.current.isBusy).toBe(false);
  });
});
