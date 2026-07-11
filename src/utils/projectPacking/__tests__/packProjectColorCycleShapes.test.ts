import type { ColorCycleLayerDocumentSnapshot } from '@/lib/colorCycle/document';
import type { Layer } from '@/types';
import { planProjectColorCycleShapePacking, resolvePackingLayers } from '@/utils/projectPacking';

const makeLayer = (id: string, name: string, layerType: Layer['layerType'] = 'color-cycle'): Layer => ({
  id,
  name,
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: {} as OffscreenCanvas,
  alignment: {
    fit: 'none',
    positioning: 'anchor',
    horizontal: 'center',
    vertical: 'center',
    offsetPx: { x: 0, y: 0 },
  },
  layerType,
  colorCycleData: layerType === 'color-cycle' ? {} : undefined,
});

const makeSnapshot = (
  layerId: string,
  width: number,
  height: number,
  paintValues: readonly number[],
): ColorCycleLayerDocumentSnapshot => {
  const paint = Uint8Array.from(paintValues);
  const pixels = width * height;
  return {
    layerId,
    width,
    height,
    paintBuffer: paint.buffer,
    gradientIdBuffer: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 2 : 0).buffer,
    gradientDefIdBuffer: Uint16Array.from({ length: pixels }, (_, index) => paint[index] ? 501 : 0).buffer,
    speedBuffer: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 120 : 0).buffer,
    flowBuffer: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 1 : 0).buffer,
    phaseBuffer: Uint8Array.from({ length: pixels }, (_, index) => paint[index] ? 8 : 0).buffer,
    hasContent: paint.some((value) => value !== 0),
    sources: {
      brushStateSnapshot: true,
      topLevelBuffers: false,
      legacyStateRefs: false,
    },
  };
};

describe('project CC shape packing', () => {
  it('rejects incompatible and noncontiguous layer collapses before reading documents', () => {
    const first = makeLayer('cc-first', 'First');
    const middle = makeLayer('normal-middle', 'Middle', 'normal');
    const second = makeLayer('cc-second', 'Second');
    second.opacity = 0.5;
    const readSnapshot = jest.fn();

    expect(() => planProjectColorCycleShapePacking({
      width: 1,
      height: 1,
      layers: [first, second],
    }, {
      selectors: [{ id: first.id }, { id: second.id }],
      destinationLayerId: first.id,
    }, readSnapshot)).toThrow(expect.objectContaining({
      code: 'incompatible-selected-layer-presentation',
    }));

    second.opacity = 1;
    expect(() => planProjectColorCycleShapePacking({
      width: 1,
      height: 1,
      layers: [first, middle, second],
    }, {
      selectors: [{ id: first.id }, { id: second.id }],
      destinationLayerId: first.id,
    }, readSnapshot)).toThrow(expect.objectContaining({
      code: 'noncontiguous-selected-layers',
    }));
    expect(readSnapshot).not.toHaveBeenCalled();
  });

  it('never turns a partial preview into destructive project state', () => {
    const destination = makeLayer('cc-partial-a', 'Partial A');
    const source = makeLayer('cc-partial-b', 'Partial B');
    const snapshots = new Map([
      [destination.id, makeSnapshot(destination.id, 1, 1, [1])],
      [source.id, makeSnapshot(source.id, 1, 1, [1])],
    ]);

    expect(() => planProjectColorCycleShapePacking({
      width: 1,
      height: 1,
      layers: [destination, source],
    }, {
      selectors: [{ id: destination.id }, { id: source.id }],
      destinationLayerId: destination.id,
      allowPartialPreview: true,
      padding: 0,
      rotations: [0],
    }, (layerId) => snapshots.get(layerId) ?? null)).toThrow(expect.objectContaining({
      code: 'partial-packing-cannot-be-materialized',
    }));
  });

  it('requires exact selected-layer resolution', () => {
    const layers = [
      makeLayer('cc-1', 'Repeated'),
      makeLayer('cc-2', 'Repeated'),
      makeLayer('normal-1', 'Normal', 'normal'),
    ];

    expect(() => resolvePackingLayers({ layers }, [{ name: 'Repeated' }])).toThrow(
      expect.objectContaining({ code: 'ambiguous-layer-name' }),
    );
    expect(() => resolvePackingLayers({ layers }, [{ id: 'normal-1' }])).toThrow(
      expect.objectContaining({ code: 'selected-layer-not-color-cycle' }),
    );
  });

  it('reads and rewrites only explicitly selected CC layers', () => {
    const selected = makeLayer('cc-selected', 'Selected');
    const unselected = makeLayer('cc-unselected', 'Unselected');
    const selectedSnapshot = makeSnapshot('cc-selected', 4, 3, [
      1, 1, 0, 0,
      1, 1, 0, 0,
      0, 0, 0, 0,
    ]);
    const unselectedSnapshot = makeSnapshot('cc-unselected', 4, 3, [
      0, 0, 1, 1,
      0, 0, 1, 1,
      0, 0, 0, 0,
    ]);
    const readSnapshot = jest.fn((layerId: string) => (
      layerId === selected.id ? selectedSnapshot : unselectedSnapshot
    ));

    const plan = planProjectColorCycleShapePacking({
      width: 4,
      height: 3,
      layers: [selected, unselected],
    }, {
      selectors: [{ id: selected.id }],
      separationByLayerId: { [selected.id]: { expectedShapeCount: 1 } },
      padding: 0,
      rotations: [0],
    }, readSnapshot);

    expect(readSnapshot).toHaveBeenCalledTimes(1);
    expect(readSnapshot).toHaveBeenCalledWith(selected.id);
    expect(plan.selectedLayerIds).toEqual([selected.id]);
    expect([...plan.nextDocumentStates.keys()]).toEqual([selected.id]);
    expect(plan.nextDocumentStates.has(unselected.id)).toBe(false);
    expect(new Uint8Array(plan.nextDocumentStates.get(selected.id)?.paintBuffer ?? new ArrayBuffer(0))).toEqual(
      Uint8Array.from([
        0, 0, 0, 0,
        1, 1, 0, 0,
        1, 1, 0, 0,
      ]),
    );
    expect(new Uint8Array(unselectedSnapshot.paintBuffer ?? new ArrayBuffer(0))).toEqual(
      Uint8Array.from([
        0, 0, 1, 1,
        0, 0, 1, 1,
        0, 0, 0, 0,
      ]),
    );
  });

  it('does not use fully erased .vs paint as packing geometry', () => {
    const selected = makeLayer('cc-erased-bridge', 'Erased Bridge');
    const eraseData = new Uint8ClampedArray(5 * 4);
    eraseData[2 * 4 + 3] = 255;
    selected.colorCycleData!.eraseMaskImageData = {
      width: 5,
      height: 1,
      data: eraseData,
      colorSpace: 'srgb',
    } as ImageData;
    const snapshot = makeSnapshot(selected.id, 5, 1, [1, 1, 1, 1, 1]);

    const plan = planProjectColorCycleShapePacking({
      width: 5,
      height: 1,
      layers: [selected],
    }, {
      selectors: [{ id: selected.id }],
      separationByLayerId: { [selected.id]: { expectedShapeCount: 2 } },
      padding: 0,
      rotations: [0],
    }, () => snapshot);

    expect(plan.shapes.map((shape) => shape.area)).toEqual([2, 2]);
    expect(plan.packing.metrics.occupiedArea).toBe(4);
  });

  it('publishes gradient metadata in the same consolidated namespace as packed pixels', () => {
    const destination = makeLayer('cc-metadata-a', 'Metadata A');
    const source = makeLayer('cc-metadata-b', 'Metadata B');
    const first = {
      ...makeSnapshot(destination.id, 2, 1, [1, 0]),
      slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#111111' }] }],
      gradientDefStore: [{
        id: 501,
        kind: 'linear' as const,
        stops: [{ position: 0, color: '#111111' }],
        hash: 'first',
        source: 'manual' as const,
        createdAtMs: 1,
        slot: 2,
      }],
    };
    const second = {
      ...makeSnapshot(source.id, 2, 1, [0, 1]),
      slotPalettes: [{ slot: 2, stops: [{ position: 0, color: '#eeeeee' }] }],
      gradientDefStore: [{
        id: 501,
        kind: 'linear' as const,
        stops: [{ position: 0, color: '#eeeeee' }],
        hash: 'second',
        source: 'manual' as const,
        createdAtMs: 2,
        slot: 2,
      }],
    };

    const plan = planProjectColorCycleShapePacking({
      width: 2,
      height: 1,
      layers: [destination, source],
    }, {
      selectors: [{ id: destination.id }, { id: source.id }],
      destinationLayerId: destination.id,
      padding: 0,
      rotations: [0],
    }, (layerId) => layerId === destination.id ? first : second);

    const state = plan.nextDocumentStates.get(destination.id);
    expect(new Set(new Uint8Array(state?.gradientIdBuffer ?? new ArrayBuffer(0)).filter(Boolean))).toEqual(new Set([1, 2]));
    expect(new Set(new Uint16Array(state?.gradientDefIdBuffer ?? new ArrayBuffer(0)).filter(Boolean))).toEqual(new Set([1, 2]));
    expect(state?.slotPalettes?.map((entry) => entry.slot)).toEqual([1, 2]);
    expect(state?.gradientDefStore?.map((entry) => ({ id: entry.id, slot: entry.slot }))).toEqual([
      { id: 1, slot: 1 },
      { id: 2, slot: 2 },
    ]);
  });
});
