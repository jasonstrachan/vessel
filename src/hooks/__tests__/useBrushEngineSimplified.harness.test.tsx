import React, { useEffect } from 'react';
import { render, act } from '@testing-library/react';
import { useBrushEngineSimplified } from '../useBrushEngineSimplified';

// Mock dependencies
const mockGetBrush = jest.fn(() => ({
  setTargetCanvas: jest.fn(),
}));
jest.mock('@/stores/colorCycleBrushManager', () => ({
  getColorCycleBrushManager: () => ({
    getBrush: (...args: any[]) => {
      mockGetBrush(...args);
      return {
        setTargetCanvas: jest.fn(),
        getCanvas: jest.fn(),
      };
    },
  }),
}));

jest.mock('@/utils/risographTexture', () => ({
  getRisographPattern: jest.fn(() => null),
  getRisographEffectSettings: jest.fn(() => ({})),
}));

jest.mock('@/stores/useAppStore', () => {
  const state = {
    tools: {
      brushSettings: {
        size: 10,
        brushShape: 'round',
        pressureEnabled: false,
        maxPressure: 1,
      },
      tool: 'brush',
    },
    project: { width: 10, height: 10 },
    layers: [],
    activeLayerId: null,
  };
  const useAppStore = (selector: any) => (typeof selector === 'function' ? selector(state) : state);
  (useAppStore as any).getState = () => state;
  (useAppStore as any).subscribe = () => jest.fn();
  return { useAppStore, selectEffectiveColorCyclePlaying: () => false };
});

jest.mock('@/hooks/brushEngine/BrushEngineFacade', () => {
  const drawStroke = jest.fn();
  const reset = jest.fn();
  return {
    createBrushEngineFacade: () => ({
      drawStroke,
      reset,
      dispose: jest.fn(),
      setBrush: jest.fn(),
      updateConfig: jest.fn(),
    }),
  };
});

// Harness component that invokes the hook
const Harness: React.FC<{ onReady: (engine: ReturnType<typeof useBrushEngineSimplified>) => void }> = ({ onReady }) => {
  const engine = useBrushEngineSimplified();
  useEffect(() => {
    onReady(engine);
  }, [engine, onReady]);
  return null;
};

describe('useBrushEngineSimplified harness', () => {
  it('initializes and exposes API methods', async () => {
    let engineRef: any;
    await act(async () => {
      render(<Harness onReady={(engine) => (engineRef = engine)} />);
    });

    expect(engineRef).toBeDefined();
    expect(typeof engineRef.resetStroke).toBe('function');
    expect(typeof engineRef.drawBrush).toBe('function');
  });
});
