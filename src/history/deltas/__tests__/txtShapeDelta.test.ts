import { createRehydrationTargets } from '@/history/runtimeRehydration';
import { createTxtShapeDelta } from '@/history/deltas/txtShapeDelta';
import { useAppStore } from '@/stores/useAppStore';
import type { Project, TxtShape } from '@/types';

const initialState = useAppStore.getState();

const createShape = (content: string): TxtShape => ({
  id: 'txt-history',
  layerId: 'layer-history',
  x: 1,
  y: 2,
  width: 100,
  height: 40,
  columns: 1,
  colorCount: 2,
  content,
  fontFamily: 'mek-mono',
  fontSize: 12,
  lineHeight: 1.2,
  textAlign: 'left',
  colorSource: 'manual',
  color: '#000000',
  selectionColor: '#ffffff',
  selectionBackgroundColor: '#000000',
  selections: content ? [{ start: 0, end: content.length }] : [],
  createdAt: 1,
  updatedAt: 1,
});

const createProject = (txtShapes: TxtShape[]): Project => ({
  id: 'txt-history-project',
  name: 'TXT history',
  width: 100,
  height: 100,
  backgroundColor: 'transparent',
  layers: [],
  layerGroups: [],
  txtShapes,
  customBrushes: [],
  createdAt: new Date(0),
  updatedAt: new Date(0),
});

describe('TxtShapeDelta', () => {
  afterEach(() => {
    useAppStore.setState(initialState, true);
  });

  it('restores semantic objects without snapshotting or replacing layer state', () => {
    const before = [createShape('BEFORE')];
    const after = [createShape('AFTER')];
    const layers = initialState.layers;
    useAppStore.setState({
      project: createProject(after),
      layers,
    });
    const delta = createTxtShapeDelta({ before, after });
    expect(delta).not.toBeNull();

    const prepared = delta!.prepare('backward');
    if (prepared instanceof Promise) throw new Error('TXT Shape delta unexpectedly prepared asynchronously');
    prepared.apply();

    expect(useAppStore.getState().project?.txtShapes).toEqual(before);
    expect(useAppStore.getState().layers).toBe(layers);
  });

  it('marks every before and after owner for compositor rehydration', () => {
    const before = [createShape('BEFORE')];
    const after = [{ ...createShape('AFTER'), layerId: 'layer-after' }];
    const delta = createTxtShapeDelta({ before, after });
    const targets = createRehydrationTargets();

    delta?.collectRehydrationTargets?.(targets);

    expect([...targets.layerIds].sort()).toEqual(['layer-after', 'layer-history']);
  });

  it('does not retain a no-op history delta', () => {
    const shape = createShape('SAME');
    expect(createTxtShapeDelta({ before: [shape], after: [{ ...shape }] })).toBeNull();
  });

  it('retains column and mapped-colour changes as semantic history', () => {
    const before = [createShape('COLOUR BLOCKS')];
    const after = [{
      ...createShape('COLOUR BLOCKS'),
      columns: 3,
      colorCount: 5,
      colorRanges: [{ start: 0, end: 6, color: '#336699' }],
    }];

    expect(createTxtShapeDelta({ before, after })).not.toBeNull();
  });

  it('retains rendering and sampled-reference changes as semantic history', () => {
    const before = [createShape('SAMPLED')];
    const variants: TxtShape[] = [
      { ...createShape('SAMPLED'), letterSpacing: 2 },
      { ...createShape('SAMPLED'), referenceMapped: true },
      { ...createShape('SAMPLED'), renderMode: 'glyph-map' },
      { ...createShape('SAMPLED'), sampledBackgroundColor: '#123456' },
      {
        ...createShape('SAMPLED'),
        sampledColorRanges: [{ start: 0, end: 3, color: '#123456' }],
      },
      {
        ...createShape('SAMPLED'),
        sampleTone: { darks: 10, lights: 90, contrast: 20 },
      },
    ];

    variants.forEach((shape) => {
      expect(createTxtShapeDelta({ before, after: [shape] })).not.toBeNull();
    });
  });

  it('retains and restores treatment-only changes as semantic history', () => {
    const before = [createShape('TREATMENT')];
    const after = [{
      ...createShape('TREATMENT'),
      selectionTreatments: [{
        start: 0,
        end: 9,
        treatment: 'crossed-out' as const,
      }],
    }];
    const delta = createTxtShapeDelta({ before, after });
    expect(delta).not.toBeNull();

    useAppStore.setState({ project: createProject(after) });
    const prepared = delta!.prepare('backward');
    if (prepared instanceof Promise) throw new Error('TXT Shape delta unexpectedly prepared asynchronously');
    prepared.apply();

    expect(useAppStore.getState().project?.txtShapes).toEqual(before);
  });
});
