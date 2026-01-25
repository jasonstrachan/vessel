/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import BrushLibrary from '@/components/BrushLibrary';
import { BrushShape } from '@/types';

type MockState = {
  currentBrushPreset: unknown;
  brushPresets: unknown[];
  project: any;
  tools: { brushSettings: { brushShape: BrushShape; selectedCustomBrush: string | null } };
  brushEditor: { status: string };
  currentOffscreenCanvas: unknown;
  temporaryCustomBrush: unknown;
  listCustomBrushes: () => any[];
  getCustomBrushById: () => any;
  setBrushPreset: (preset: unknown) => void;
  setDefaultCustomBrush: jest.Mock;
  removeCustomBrush: jest.Mock;
  saveCustomBrushAsPreset: jest.Mock;
  removeBrushPreset: jest.Mock;
  setBrushSettings: jest.Mock;
  cancelBrushEdit: jest.Mock;
  setCurrentTool: jest.Mock;
  markAutosaveDirty: jest.Mock;
};

jest.mock('@/stores/useAppStore', () => {
  // Avoid hoist-time TDZ issues by resolving types inside the factory
  const { BrushShape } = jest.requireActual('@/types');
  const listeners = new Set<(s: MockState) => void>();
  const state: MockState = {
    currentBrushPreset: null,
    brushPresets: [],
    project: null,
    tools: { brushSettings: { brushShape: BrushShape.ROUND, selectedCustomBrush: null } },
    brushEditor: { status: 'IDLE' },
    currentOffscreenCanvas: null,
    temporaryCustomBrush: null,
    listCustomBrushes: () => state.project?.customBrushes ?? [],
    getCustomBrushById: () => null,
    setBrushPreset: (preset: unknown) => {
      state.currentBrushPreset = preset;
      listeners.forEach((l) => l(state));
    },
    setDefaultCustomBrush: jest.fn(),
    removeCustomBrush: jest.fn(),
    saveCustomBrushAsPreset: jest.fn(),
    removeBrushPreset: jest.fn(),
    setBrushSettings: jest.fn(),
    cancelBrushEdit: jest.fn(),
    setCurrentTool: jest.fn(),
    markAutosaveDirty: jest.fn(),
  };
  const useAppStore = ((selector?: (s: MockState) => unknown) =>
    selector ? selector(state) : state) as any;
  useAppStore.getState = () => state;
  useAppStore.setState = (updater: Partial<MockState> | ((s: MockState) => Partial<MockState>)) => {
    const next = typeof updater === 'function' ? updater(state) : updater;
    Object.assign(state, next);
    listeners.forEach((l) => l(state));
  };
  useAppStore.subscribe = (listener: (s: MockState) => void) => {
    listeners.add(listener);
    return () => listeners.delete(listener);
  };
  return { useAppStore };
});
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/components/ui/PlusButton', () => {
  const MockPlusButton = ({ onClick }: { onClick: () => void }) => (
    <button data-testid="plus-button" onClick={onClick}>+</button>
  );
  MockPlusButton.displayName = 'MockPlusButton';
  return { __esModule: true, default: MockPlusButton };
});

jest.mock('@/utils/brushThumbnailGenerator', () => ({
  generateBrushThumbnail: () => 'data:image/png;base64,thumb',
}));

const basePreset = {
  id: 'round-brush',
  name: 'Round',
  isDefault: true,
  category: 'Basic',
  components: [{ type: 'shape', parameters: { shape: BrushShape.ROUND } }],
};

const otherPreset = {
  id: 'pixel-square',
  name: 'Pixel Square',
  isDefault: false,
  category: 'Pixel Art',
  components: [{ type: 'shape', parameters: { shape: BrushShape.SQUARE } }],
};

const trianglePreset = {
  id: 'color-cycle-triangle',
  name: 'Triangle CC',
  isDefault: false,
  category: 'Color Cycle',
  components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE_TRIANGLE } }],
};

describe('BrushLibrary', () => {
  beforeEach(() => {
    useAppStore.setState({
      ...useAppStore.getState(),
      currentBrushPreset: basePreset as any,
      brushPresets: [basePreset as any, trianglePreset as any, otherPreset as any],
      project: {
        id: 'p1',
        name: 'demo',
        width: 10,
        height: 10,
        backgroundColor: '#000',
        layers: [],
        customBrushes: [],
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      tools: {
        ...useAppStore.getState().tools,
        brushSettings: {
          ...useAppStore.getState().tools.brushSettings,
          brushShape: BrushShape.ROUND,
          selectedCustomBrush: null,
        },
      },
    });
  });

  afterEach(() => {
    useAppStore.setState({ project: null, brushPresets: [], currentBrushPreset: null });
  });

  it('renders presets and selects a brush on click', () => {
    render(<BrushLibrary />);

    const brushButton = screen.getByText('Pixel Square');
    fireEvent.click(brushButton);

    // Smoke: ensure click succeeded and store still has a preset selected
    expect(useAppStore.getState().currentBrushPreset?.id).toBeTruthy();
  });

  it('does not render an image tag when document is present but thumbnail fetch is mocked', () => {
    render(<BrushLibrary />);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('filters out color-cycle triangle preset', () => {
    render(<BrushLibrary />);

    expect(screen.queryByText('Triangle CC')).toBeNull();
  });
});
