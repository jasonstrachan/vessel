import {
  generateDuplicateLayerName,
  getInsertionIndexAboveActiveLayer,
  insertLayerAtIndex,
  normalizeLayerOrder,
  reorderLayerAtIndex,
  reorderLayerBlock,
} from '@/stores/layers/layerCrudService';

type TestLayer = {
  id: string;
  name: string;
  order: number;
};

const layer = (id: string, order: number = 0): TestLayer => ({
  id,
  name: id,
  order,
});

describe('layerCrudService', () => {
  it('normalizes layer order by array position', () => {
    expect(normalizeLayerOrder([layer('a', 10), layer('b', 4)])).toEqual([
      { id: 'a', name: 'a', order: 0 },
      { id: 'b', name: 'b', order: 1 },
    ]);
  });

  it('inserts above the active layer or appends when active is missing', () => {
    const layers = [layer('bottom'), layer('middle'), layer('top')];

    expect(getInsertionIndexAboveActiveLayer(layers, 'middle')).toBe(2);
    expect(getInsertionIndexAboveActiveLayer(layers, 'missing')).toBe(3);
    expect(getInsertionIndexAboveActiveLayer(layers, null)).toBe(3);
  });

  it('generates duplicate names using existing suffix behavior', () => {
    expect(generateDuplicateLayerName('Ink', [])).toBe('Ink Copy');
    expect(generateDuplicateLayerName('', [])).toBe('Layer Copy');
    expect(generateDuplicateLayerName('Ink', [
      { name: 'Ink Copy' },
      { name: 'Ink Copy 2' },
    ])).toBe('Ink Copy 3');
  });

  it('inserts a layer at an index without mutating the original array', () => {
    const original = [layer('a'), layer('c')];
    const next = insertLayerAtIndex(original, layer('b'), 1);

    expect(next.map((entry) => entry.id)).toEqual(['a', 'b', 'c']);
    expect(original.map((entry) => entry.id)).toEqual(['a', 'c']);
  });

  it('reorders a layer by source and destination index', () => {
    const next = reorderLayerAtIndex([layer('a'), layer('b'), layer('c')], 0, 2);

    expect(next.map((entry) => entry.id)).toEqual(['b', 'c', 'a']);
  });

  it('reorders a block using requested id order and adjusted destination', () => {
    const result = reorderLayerBlock(
      [layer('a'), layer('b'), layer('c'), layer('d')],
      ['c', 'a'],
      4
    );

    expect(result.didReorder).toBe(true);
    expect(result.layers.map((entry) => entry.id)).toEqual(['b', 'd', 'c', 'a']);
  });

  it('reports no-op contiguous block moves', () => {
    const layers = [layer('a'), layer('b'), layer('c')];
    const result = reorderLayerBlock(layers, ['b', 'c'], 1);

    expect(result.didReorder).toBe(false);
    expect(result.layers).toBe(layers);
  });
});
