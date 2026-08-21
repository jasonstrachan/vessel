import { createUiShapeDelta } from '@/history/deltas/uiShapeDelta';
import { createRehydrationTargets } from '@/history/runtimeRehydration';
import { useAppStore } from '@/stores/useAppStore';
import type { Project, UiShape } from '@/types';
import { WINDOWS_31_UI_SHAPE_PALETTE } from '@/utils/uiShape';

const initialState = useAppStore.getState();

const createShape = (value: number, layerId = 'layer-before'): UiShape => ({
  id: 'ui-history',
  layerId,
  x: 0,
  y: 0,
  width: 16,
  height: 48,
  gridSize: 8,
  theme: 'windows-3.1',
  drawMode: 'place',
  regionKind: 'rectangle',
  componentKinds: ['scrollbar-vertical'],
  colorSource: 'default',
  palette: { ...WINDOWS_31_UI_SHAPE_PALETTE },
  components: [{
    id: 'scroll',
    kind: 'scrollbar-vertical',
    x: 0,
    y: 0,
    width: 16,
    height: 48,
    canonicalState: { value },
  }],
  createdAt: 1,
  updatedAt: 1,
});

const createProject = (uiShapes: UiShape[]): Project => ({
  id: 'ui-history-project',
  name: 'UI history',
  width: 100,
  height: 100,
  backgroundColor: 'transparent',
  layers: [],
  layerGroups: [],
  uiShapes,
  customBrushes: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('UiShapeDelta', () => {
  afterEach(() => useAppStore.setState(initialState, true));

  it('restores the canonical component state without replacing layer state', () => {
    const before = [createShape(0.2)];
    const after = [createShape(0.8)];
    const layers = initialState.layers;
    useAppStore.setState({ project: createProject(after), layers });
    const delta = createUiShapeDelta({ before, after });
    const prepared = delta!.prepare('backward');
    if (prepared instanceof Promise) throw new Error('UI Shape delta prepared asynchronously');
    prepared.apply();
    expect(useAppStore.getState().project?.uiShapes).toEqual(before);
    expect(useAppStore.getState().layers).toBe(layers);
  });

  it('rehydrates both previous and next owner layers', () => {
    const delta = createUiShapeDelta({
      before: [createShape(0.2)],
      after: [createShape(0.8, 'layer-after')],
    });
    const targets = createRehydrationTargets();
    delta?.collectRehydrationTargets?.(targets);
    expect([...targets.layerIds].sort()).toEqual(['layer-after', 'layer-before']);
  });

  it('drops a semantic no-op', () => {
    const shape = createShape(0.5);
    expect(createUiShapeDelta({ before: [shape], after: [{ ...shape }] })).toBeNull();
  });
});
