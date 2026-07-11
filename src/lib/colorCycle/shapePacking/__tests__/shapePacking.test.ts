import {
  CcShapePackingError,
  assertCompatibleCcLayerPresentation,
  assertSelectedLayersAreContiguous,
  consolidateCcLayerNamespaces,
  extractCcShapes,
  packCcShapes,
  rewritePackedCcLayers,
  rotateCcShape,
  type CcPackingLayerInput,
} from '@/lib/colorCycle/shapePacking';

const makeLayer = (
  layerId: string,
  width: number,
  height: number,
  paintValues: readonly number[] | Uint8Array,
): CcPackingLayerInput => {
  const paint = Uint8Array.from(paintValues);
  const pixels = width * height;
  if (paint.length !== pixels) throw new Error('Invalid test paint length');
  return {
    layerId,
    width,
    height,
    channels: {
      paint,
      gradientId: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? index + 1 : 0),
      gradientDefId: Uint16Array.from({ length: pixels }, (_, index) => paint[index] ? 300 + index : 0),
      speed: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 10 + index : 0),
      flow: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 20 + index : 0),
      phase: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 30 + index : 0),
    },
  };
};

describe('CC shape extraction', () => {
  it('preserves disconnected and one-pixel shapes using the same CC metadata family', () => {
    const layer = makeLayer('cc-a', 5, 3, [
      1, 1, 0, 0, 0,
      1, 1, 0, 0, 0,
      0, 0, 0, 0, 1,
    ]);

    const shapes = extractCcShapes(layer);

    expect(shapes).toHaveLength(2);
    expect(shapes.map((shape) => shape.area)).toEqual([4, 1]);
    expect(shapes[1].width).toBe(1);
    expect(shapes[1].height).toBe(1);
  });

  it('separates touching pixels with explicit seed groups without dropping pixels', () => {
    const layer = makeLayer('cc-touching', 4, 1, [1, 1, 1, 1]);

    const shapes = extractCcShapes(layer, {
      expectedShapeCount: 2,
      seedGroups: [
        [{ x: 0, y: 0 }],
        [{ x: 3, y: 0 }],
      ],
    });

    expect(shapes).toHaveLength(2);
    expect(shapes.reduce((total, shape) => total + shape.area, 0)).toBe(4);
    expect(shapes.map((shape) => shape.area).sort()).toEqual([2, 2]);
  });

  it('can explicitly use gradient-definition IDs as best-guess touching-shape boundaries', () => {
    const layer = makeLayer('cc-gradient-guess', 4, 1, [1, 1, 1, 1]);
    layer.channels.gradientDefId.set([3, 3, 7, 7]);

    const shapes = extractCcShapes(layer, { splitByGradientDefId: true });

    expect(shapes).toHaveLength(2);
    expect(shapes.map((shape) => shape.area)).toEqual([2, 2]);
  });

  it('keeps disconnected regions separate even when they reuse one gradient definition', () => {
    const layer = makeLayer('cc-gradient-reuse', 5, 1, [1, 1, 0, 1, 1]);
    layer.channels.gradientDefId.set([3, 3, 0, 3, 3]);

    const shapes = extractCcShapes(layer, { splitByGradientDefId: true });

    expect(shapes).toHaveLength(2);
    expect(shapes.map((shape) => shape.area)).toEqual([2, 2]);
  });

  it('uses cuts as traversal barriers without deleting touching pixels', () => {
    const layer = makeLayer('cc-cut', 4, 1, [1, 1, 1, 1]);

    const shapes = extractCcShapes(layer, {
      expectedShapeCount: 2,
      cuts: [{ from: { x: 2, y: -1 }, to: { x: 2, y: 2 } }],
    });

    expect(shapes.map((shape) => shape.area)).toEqual([2, 2]);
    expect(shapes.reduce((total, shape) => total + shape.area, 0)).toBe(4);
  });

  it('fails rather than silently merging an asserted touching-shape count', () => {
    const layer = makeLayer('cc-ambiguous', 4, 1, [1, 1, 1, 1]);

    expect(() => extractCcShapes(layer, { expectedShapeCount: 2 })).toThrow(
      expect.objectContaining<Partial<CcShapePackingError>>({ code: 'shape-count-mismatch' }),
    );
  });

  it('rejects a lone ambiguous connected silhouette without explicit separation intent', () => {
    const layer = makeLayer('cc-unasserted-touching', 4, 1, [1, 1, 1, 1]);

    expect(() => extractCcShapes(layer)).toThrow(
      expect.objectContaining<Partial<CcShapePackingError>>({
        code: 'ambiguous-touching-silhouette',
      }),
    );
  });

  it('excludes fully erased paint from visible occupancy and connectivity', () => {
    const baseLayer = makeLayer('cc-erased-bridge', 5, 1, [1, 1, 1, 1, 1]);
    const layer: CcPackingLayerInput = {
      ...baseLayer,
      channels: {
        ...baseLayer.channels,
        alphaMask: Uint8Array.from([0, 0, 255, 0, 0]),
      },
    };

    const shapes = extractCcShapes(layer, { expectedShapeCount: 2 });

    expect(shapes.map((shape) => shape.area)).toEqual([2, 2]);
    expect(shapes.reduce((total, shape) => total + shape.area, 0)).toBe(4);
  });

  it('extracts a canvas-scale connected region without overflowing the call stack', () => {
    const width = 500;
    const height = 300;
    const layer = makeLayer('cc-large', width, height, new Uint8Array(width * height).fill(1));

    const shapes = extractCcShapes(layer, { expectedShapeCount: 1 });

    expect(shapes).toHaveLength(1);
    expect(shapes[0].area).toBe(width * height);
  });
});

describe('CC shape quarter turns', () => {
  it('rotates every scalar channel with the exact same 90 degree mapping', () => {
    const layer = makeLayer('cc-rotate', 3, 2, [
      1, 0, 0,
      1, 1, 0,
    ]);
    const [shape] = extractCcShapes(layer, { expectedShapeCount: 1 });

    const rotated = rotateCcShape(shape, 90);

    expect({ width: rotated.width, height: rotated.height }).toEqual({ width: 2, height: 2 });
    expect(Array.from(rotated.mask)).toEqual([
      1, 1,
      1, 0,
    ]);
    expect(Array.from(rotated.channels.gradientDefId)).toEqual([
      303, 300,
      304, 0,
    ]);
    expect(Array.from(rotated.channels.phase)).toEqual([
      33, 30,
      34, 0,
    ]);
  });
});

describe('CC bottom packing', () => {
  it('rejects incompatible or noncontiguous source-layer presentation', () => {
    expect(() => assertCompatibleCcLayerPresentation([
      { id: 'a', visible: true, opacity: 1, blendMode: 'source-over' },
      { id: 'b', visible: true, opacity: 0.5, blendMode: 'source-over' },
    ], 'a')).toThrow(expect.objectContaining({ code: 'incompatible-selected-layer-presentation' }));
    expect(() => assertSelectedLayersAreContiguous(['a', 'normal', 'b'], ['a', 'b'])).toThrow(
      expect.objectContaining({ code: 'noncontiguous-selected-layers' }),
    );
  });

  it('preserves occupied gradient slot zero while leaving empty pixels at zero', () => {
    const source = makeLayer('cc-slot-zero', 3, 1, [1, 0, 1]);
    source.channels.gradientId.set([0, 0, 2]);

    const consolidated = consolidateCcLayerNamespaces([source]);
    const remapped = consolidated.layers[0].channels.gradientId;

    expect(consolidated.remap.gradientIdByLayerId.get(source.layerId)?.get(0)).toBe(1);
    expect(Array.from(remapped)).toEqual([1, 0, 2]);
  });

  it('remaps source namespaces and rewrites every placement into one destination layer', () => {
    const first = makeLayer('cc-first', 5, 3, [
      1, 1, 0, 0, 0,
      1, 1, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const second = makeLayer('cc-second', 5, 3, [
      0, 0, 0, 1, 1,
      0, 0, 0, 1, 1,
      0, 0, 0, 0, 0,
    ]);
    first.channels.gradientId.fill(0);
    first.channels.gradientDefId.fill(0);
    second.channels.gradientId.fill(0);
    second.channels.gradientDefId.fill(0);
    first.channels.paint.forEach((value, index) => {
      if (value) {
        first.channels.gradientId[index] = 2;
        first.channels.gradientDefId[index] = 10;
      }
    });
    second.channels.paint.forEach((value, index) => {
      if (value) {
        second.channels.gradientId[index] = 2;
        second.channels.gradientDefId[index] = 10;
      }
    });
    const consolidated = consolidateCcLayerNamespaces([first, second]);
    const shapes = consolidated.layers.map((layer) => extractCcShapes(layer, { expectedShapeCount: 1 })[0]);
    const packing = packCcShapes(shapes, {
      canvasWidth: 5,
      canvasHeight: 3,
      padding: 1,
      rotations: [0],
    });

    const rewritten = rewritePackedCcLayers(consolidated.layers, packing.placements, {
      destinationLayerId: first.layerId,
    });

    expect([...rewritten.keys()]).toEqual([first.layerId]);
    expect(rewritten.get(first.layerId)?.paint.filter(Boolean)).toHaveLength(8);
    expect(new Set(rewritten.get(first.layerId)?.gradientId.filter(Boolean))).toEqual(new Set([1, 2]));
    expect(new Set(rewritten.get(first.layerId)?.gradientDefId.filter(Boolean))).toEqual(new Set([1, 2]));
  });

  it('uses opaque soft-edge defaults for consolidated sources without a mask', () => {
    const firstBase = makeLayer('cc-soft-mask', 3, 1, [1, 0, 0]);
    const first: CcPackingLayerInput = {
      ...firstBase,
      channels: {
        ...firstBase.channels,
        softEdgeMask: Uint8Array.from([128, 0, 0]),
      },
    };
    const second = makeLayer('cc-no-soft-mask', 3, 1, [0, 0, 1]);
    const consolidated = consolidateCcLayerNamespaces([first, second]);
    const shapes = consolidated.layers.map((layer) => extractCcShapes(layer)[0]);
    const packing = packCcShapes(shapes, {
      canvasWidth: 3,
      canvasHeight: 1,
      padding: 0,
      rotations: [0],
    });

    const rewritten = rewritePackedCcLayers(consolidated.layers, packing.placements, {
      destinationLayerId: first.layerId,
    }).get(first.layerId);
    const unmaskedPlacement = packing.placements.find((placement) => placement.layerId === second.layerId);
    expect(unmaskedPlacement).toBeDefined();
    expect(rewritten?.softEdgeMask?.[unmaskedPlacement!.x]).toBe(255);
  });

  it('packs selected shapes on the floor with exact one-pixel clearance', () => {
    const layer = makeLayer('cc-pack', 5, 4, [
      1, 1, 0, 1, 1,
      1, 1, 0, 1, 1,
      0, 0, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const shapes = extractCcShapes(layer);

    const result = packCcShapes(shapes, {
      canvasWidth: 5,
      canvasHeight: 4,
      padding: 1,
      rotations: [0],
      beamWidth: 4,
    });

    expect(result.placements).toHaveLength(2);
    result.placements.forEach((placement) => {
      expect(placement.y + placement.rotated.height).toBe(4);
    });
    const orderedX = result.placements.map((placement) => placement.x).sort((a, b) => a - b);
    expect(orderedX[1] - orderedX[0]).toBe(3);
    expect(result.metrics.packedHeight).toBe(2);
  });

  it('coordinates packing across selected layers without changing shape ownership', () => {
    const firstLayer = makeLayer('cc-first', 5, 3, [
      1, 1, 0, 0, 0,
      1, 1, 0, 0, 0,
      0, 0, 0, 0, 0,
    ]);
    const secondLayer = makeLayer('cc-second', 5, 3, [
      0, 0, 0, 1, 1,
      0, 0, 0, 1, 1,
      0, 0, 0, 0, 0,
    ]);
    const shapes = [
      extractCcShapes(firstLayer, { expectedShapeCount: 1 })[0],
      extractCcShapes(secondLayer, { expectedShapeCount: 1 })[0],
    ];

    const result = packCcShapes(shapes, {
      canvasWidth: 5,
      canvasHeight: 3,
      padding: 1,
      rotations: [0],
    });

    expect(new Set(result.placements.map((placement) => placement.layerId))).toEqual(
      new Set(['cc-first', 'cc-second']),
    );
    const occupied = new Set<string>();
    result.placements.forEach((placement) => {
      placement.rotated.mask.forEach((value, index) => {
        if (!value) return;
        const x = placement.x + index % placement.rotated.width;
        const y = placement.y + Math.floor(index / placement.rotated.width);
        const key = `${x}:${y}`;
        expect(occupied.has(key)).toBe(false);
        occupied.add(key);
      });
    });
  });

  it('creates a floor-anchored support path when selected shapes must stack', () => {
    const firstLayer = makeLayer('cc-stack-a', 3, 3, [
      1, 1, 1,
      0, 0, 0,
      0, 0, 0,
    ]);
    const secondLayer = makeLayer('cc-stack-b', 3, 3, [
      1, 1, 1,
      0, 0, 0,
      0, 0, 0,
    ]);

    const result = packCcShapes([
      extractCcShapes(firstLayer, { expectedShapeCount: 1 })[0],
      extractCcShapes(secondLayer, { expectedShapeCount: 1 })[0],
    ], {
      canvasWidth: 3,
      canvasHeight: 3,
      padding: 0,
      rotations: [0],
    });

    const floor = result.placements.find((placement) => placement.supportShapeIds.length === 0);
    const supported = result.placements.find((placement) => placement.supportShapeIds.length > 0);
    expect(floor?.y).toBe(2);
    expect(supported?.y).toBe(1);
    expect(supported?.supportShapeIds).toEqual([floor?.shapeId]);
    expect(supported?.stabilityMargin).toBeGreaterThanOrEqual(0);
  });

  it('is deterministic and rewrites every CC channel at the packed coordinates', () => {
    const layer = makeLayer('cc-rewrite', 4, 3, [
      1, 0, 0, 1,
      1, 0, 0, 1,
      0, 0, 0, 0,
    ]);
    const shapes = extractCcShapes(layer);
    const options = {
      canvasWidth: 4,
      canvasHeight: 3,
      padding: 0,
      rotations: [0, 90] as const,
      beamWidth: 4,
    };

    const first = packCcShapes(shapes, options);
    const second = packCcShapes(shapes, options);
    const rewritten = rewritePackedCcLayers([layer], first.placements).get(layer.layerId);

    expect(first.placements.map(({ shapeId, x, y, rotation }) => ({ shapeId, x, y, rotation }))).toEqual(
      second.placements.map(({ shapeId, x, y, rotation }) => ({ shapeId, x, y, rotation })),
    );
    expect(rewritten).toBeDefined();
    expect(rewritten?.paint.filter(Boolean)).toHaveLength(4);
    expect(rewritten?.gradientDefId.filter(Boolean)).toHaveLength(4);
    first.placements.forEach((placement) => {
      placement.rotated.mask.forEach((value, index) => {
        if (!value || !rewritten) return;
        const x = placement.x + index % placement.rotated.width;
        const y = placement.y + Math.floor(index / placement.rotated.width);
        const destinationIndex = y * layer.width + x;
        expect(rewritten.gradientDefId[destinationIndex]).toBe(
          placement.rotated.channels.gradientDefId[index],
        );
        expect(rewritten.phase[destinationIndex]).toBe(placement.rotated.channels.phase[index]);
      });
    });
  });
});
