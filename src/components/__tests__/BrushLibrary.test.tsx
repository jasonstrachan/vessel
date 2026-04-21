/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react';
import BrushLibrary from '@/components/BrushLibrary';
import { BrushShape } from '@/types';

const mockSwitchTool = jest.fn().mockResolvedValue(undefined);

jest.mock('@/utils/toolSwitch', () => ({
  useToolSwitcher: () => mockSwitchTool,
}));

type MockState = {
  currentBrushPreset: unknown;
  brushPresets: unknown[];
  project: any;
  tools: { brushSettings: { brushShape: BrushShape; selectedCustomBrush: string | null } };
  ui: {
    panels: {
      leftToolbar: boolean;
      rightToolbar: boolean;
      timeline: boolean;
      layerPanel: boolean;
      brushPanel: boolean;
    };
    modals: {
      export: boolean;
      settings: boolean;
      help: boolean;
      document: boolean;
      loadProject: boolean;
    };
    theme: 'dark' | 'light';
    grid: { enabled: boolean; rows: number; columns: number };
    notifications: unknown[];
    brushPanelSection: 'tool' | 'filters';
    settingsSection: string;
    keyboardScope: { active: string; stack: unknown[] };
  };
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
  setBrushPanelSection: jest.Mock;
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
    ui: {
      panels: {
        leftToolbar: true,
        rightToolbar: true,
        timeline: true,
        layerPanel: true,
        brushPanel: true,
      },
      modals: {
        export: false,
        settings: false,
        help: false,
        document: false,
        loadProject: false,
      },
      theme: 'dark',
      grid: { enabled: false, rows: 8, columns: 8 },
      notifications: [],
      brushPanelSection: 'tool',
      settingsSection: 'display',
      keyboardScope: { active: 'canvas', stack: [] },
    },
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
    setBrushPanelSection: jest.fn((section: 'tool' | 'filters') => {
      state.ui.brushPanelSection = section;
      listeners.forEach((l) => l(state));
    }),
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
  const ccStrokePreset = {
    id: 'color-cycle-stroke',
    name: 'CC Stroke',
    isDefault: false,
    category: 'Color Cycle',
    components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE } }],
  };
  const ccShapePreset = {
    id: 'color-cycle-shape',
    name: 'Color Cycle Shape',
    isDefault: false,
    category: 'Color Cycle',
    components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE_SHAPE } }],
  };
  const ccGradientPreset = {
    id: 'color-cycle-gradient',
    name: 'Color Cycle Gradient',
    isDefault: false,
    category: 'Color Cycle',
    components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE_SHAPE } }],
  };
  const shapeFillPreset = {
    id: 'shape-fill',
    name: 'Shape Fill',
    isDefault: false,
    category: 'Special',
    components: [{ type: 'shape', parameters: { shape: BrushShape.SHAPE_FILL } }],
  };
  const checkeredStaticPreset = {
    id: 'checkered',
    name: 'Checkered',
    isDefault: false,
    category: 'Special',
    thumbnail: '/assets/images/checkered-brush.svg',
    components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE } }],
  };

describe('BrushLibrary', () => {
  beforeEach(() => {
    jest.clearAllMocks();
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
      ui: {
        ...useAppStore.getState().ui,
        brushPanelSection: 'tool',
      },
    });
  });

  afterEach(() => {
    useAppStore.setState({ project: null, brushPresets: [], currentBrushPreset: null });
    (globalThis as any).__NEXT_DATA__ = undefined;
  });

  it('renders presets and selects a brush on click', () => {
    render(<BrushLibrary />);

    const brushButton = screen.getByText('Pixel Square');
    fireEvent.click(brushButton);

    // Smoke: ensure click succeeded and store still has a preset selected
    expect(useAppStore.getState().currentBrushPreset?.id).toBeTruthy();
  });

  it('switches back to the brush tool section when selecting a library brush from filters', () => {
    useAppStore.setState({
      ...useAppStore.getState(),
      ui: {
        ...useAppStore.getState().ui,
        brushPanelSection: 'filters',
      },
    });

    render(<BrushLibrary />);

    fireEvent.click(screen.getByText('Pixel Square'));

    expect(useAppStore.getState().setBrushPanelSection).toHaveBeenCalledWith('tool');
    expect(mockSwitchTool).toHaveBeenCalledWith('brush');
  });

  it('does not render an image tag when document is present but thumbnail fetch is mocked', () => {
    render(<BrushLibrary />);
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
  });

  it('filters out color-cycle triangle preset', () => {
    render(<BrushLibrary />);

    expect(screen.queryByText('Triangle CC')).toBeNull();
  });

  it('orders Color Cycle Gradient directly below Color Cycle Stroke', () => {
    useAppStore.setState({
      ...useAppStore.getState(),
      currentBrushPreset: ccStrokePreset as any,
      brushPresets: [
        basePreset as any,
        ccShapePreset as any,
        ccGradientPreset as any,
        ccStrokePreset as any,
      ],
    });

    render(<BrushLibrary />);

    const stroke = screen.getByText('Color Cycle Stroke');
    const gradient = screen.getByText('Color Cycle Gradient');
    const relation = stroke.compareDocumentPosition(gradient);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orders Shape Fill above Color Cycle Stroke', () => {
    useAppStore.setState({
      ...useAppStore.getState(),
      currentBrushPreset: shapeFillPreset as any,
      brushPresets: [
        basePreset as any,
        ccStrokePreset as any,
        shapeFillPreset as any,
        ccGradientPreset as any,
      ],
    });

    render(<BrushLibrary />);

    const shapeFill = screen.getByText('Shape Fill');
    const stroke = screen.getByText('Color Cycle Stroke');
    const relation = shapeFill.compareDocumentPosition(stroke);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('orders Checkered directly after Color Cycle Gradient', () => {
    useAppStore.setState({
      ...useAppStore.getState(),
      currentBrushPreset: {
        id: 'checkered',
        name: 'Checkered',
        category: 'Special',
        components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE } }],
        isDefault: false,
      } as any,
      brushPresets: [
        ccShapePreset as any,
        {
          id: 'checkered',
          name: 'Checkered',
          category: 'Special',
          components: [{ type: 'shape', parameters: { shape: BrushShape.COLOR_CYCLE } }],
          isDefault: false,
        } as any,
        ccGradientPreset as any,
      ],
    });

    render(<BrushLibrary />);

    const gradient = screen.getByText('Color Cycle Gradient');
    const checkered = screen.getByText('Checkered');
    const relation = gradient.compareDocumentPosition(checkered);
    expect(relation & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('prefers a dedicated preset thumbnail asset over generated thumbnails', () => {
    useAppStore.setState({
      ...useAppStore.getState(),
      currentBrushPreset: checkeredStaticPreset as any,
      brushPresets: [checkeredStaticPreset as any],
    });

    render(<BrushLibrary />);

    const image = screen.getByAltText('Checkered thumbnail');
    expect(image).toHaveAttribute('src', '/assets/images/checkered-brush.svg');
  });

  it('prefixes dedicated preset thumbnail assets with the Next assetPrefix when present', () => {
    (globalThis as any).__NEXT_DATA__ = {
      assetPrefix: '/vessel/',
    };

    useAppStore.setState({
      ...useAppStore.getState(),
      currentBrushPreset: checkeredStaticPreset as any,
      brushPresets: [checkeredStaticPreset as any],
    });

    render(<BrushLibrary />);

    const image = screen.getByAltText('Checkered thumbnail');
    expect(image).toHaveAttribute('src', '/vessel/assets/images/checkered-brush.svg');
  });
});
