import type { ColorCycleLayerDocumentState } from '@/lib/colorCycle/documentState';

import {
  COLOR_CYCLE_DOCUMENT_CONTRACT_KEYS,
  COLOR_CYCLE_DOCUMENT_FIELD_MAPPING,
  mapDocumentSnapshotToArchiveState,
  mapDocumentSnapshotToGobletBrushState,
} from '../colorCycleDocumentContract';

const makeBuffer = (values: number[]): ArrayBuffer => new Uint8Array(values).buffer;
const makeDefBuffer = (values: number[]): ArrayBuffer => new Uint16Array(values).buffer;

const readBytes = (value: unknown): number[] => {
  if (Array.isArray(value)) {
    return value.map(Number);
  }
  if (value instanceof Uint8Array || value instanceof Uint16Array) {
    return Array.from(value);
  }
  if (value instanceof ArrayBuffer) {
    return Array.from(new Uint8Array(value));
  }
  return [];
};

const makeState = (): ColorCycleLayerDocumentState => ({
  layerId: 'contract-layer',
  width: 2,
  height: 2,
  paintBuffer: makeBuffer([1, 2, 0, 4]),
  gradientIdBuffer: makeBuffer([3, 3, 0, 3]),
  gradientDefIdBuffer: makeDefBuffer([7, 8, 0, 9]),
  speedBuffer: makeBuffer([10, 11, 0, 12]),
  flowBuffer: makeBuffer([1, 1, 0, 1]),
  phaseBuffer: makeBuffer([4, 5, 0, 6]),
  slotPalettes: [{
    slot: 3,
    stops: [
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ],
  }],
  gradientDefs: [{ id: 'def-a', currentSlot: 3 }],
  gradientDefStore: [{
    id: 7,
    kind: 'linear',
    stops: [{ position: 0, color: '#111111' }],
    hash: 'hash-a',
    source: 'manual',
    createdAtMs: 0,
    slot: 3,
  }],
  activeGradientId: 'def-a',
  paintSlot: 3,
  fgActiveSlot: 3,
  layerBaseSpeedCps: 0.25,
  flowMode: 'reverse',
  hasContent: true,
  sources: {
    brushStateSnapshot: true,
    topLevelBuffers: false,
    legacyStateRefs: false,
  },
});

describe('color-cycle document contract', () => {
  it('has an explicit mapping decision for every document field', () => {
    expect(Object.keys(COLOR_CYCLE_DOCUMENT_FIELD_MAPPING).sort()).toEqual(
      [...COLOR_CYCLE_DOCUMENT_CONTRACT_KEYS].sort(),
    );

    for (const key of COLOR_CYCLE_DOCUMENT_CONTRACT_KEYS) {
      expect(COLOR_CYCLE_DOCUMENT_FIELD_MAPPING[key].archive).toBeTruthy();
      expect(COLOR_CYCLE_DOCUMENT_FIELD_MAPPING[key].goblet).toBeTruthy();
    }
  });

  it('narrows document snapshots to archive state with cloned buffers and metadata', () => {
    const state = makeState();
    const archiveState = mapDocumentSnapshotToArchiveState(state);

    expect(archiveState).toMatchObject({
      layerId: 'contract-layer',
      width: 2,
      height: 2,
      hasContent: true,
      paintSlot: 3,
      flowMode: 'reverse',
    });
    expect(readBytes(archiveState.paintBuffer)).toEqual([1, 2, 0, 4]);
    expect(archiveState.paintBuffer).not.toBe(state.paintBuffer);
    expect(archiveState.slotPalettes?.[0]?.stops[0]).toEqual({ position: 0, color: '#111111' });
    expect(archiveState.slotPalettes?.[0]?.stops).not.toBe(state.slotPalettes?.[0]?.stops);
  });

  it('narrows document snapshots to Goblet brush payloads from the same schema family', () => {
    const brushState = mapDocumentSnapshotToGobletBrushState(makeState(), {
      targetFPS: 24,
    });

    expect(brushState).toMatchObject({
      width: 2,
      height: 2,
      animationOffset: 0,
      animationSpeed: 0.25,
      targetFPS: 24,
      flowDirection: 'reverse',
      alphaMode: 'opaque-indices',
    });
    expect(readBytes(brushState?.indexBuffer)).toEqual([1, 2, 0, 4]);
    expect(readBytes(brushState?.gradientIdBuffer)).toEqual([3, 3, 0, 3]);
    expect(readBytes(brushState?.gradientDefIdBuffer)).toEqual([7, 8, 0, 9]);
    expect(readBytes(brushState?.speedBuffer)).toEqual([10, 11, 0, 12]);
    expect(readBytes(brushState?.flowBuffer)).toEqual([1, 1, 0, 1]);
    expect(readBytes(brushState?.phaseBuffer)).toEqual([4, 5, 0, 6]);
    expect(brushState?.gradientStops).toEqual([
      { position: 0, color: '#111111' },
      { position: 1, color: '#eeeeee' },
    ]);
  });

  it('does not produce an animated Goblet brush payload without canonical paint', () => {
    expect(mapDocumentSnapshotToGobletBrushState({
      ...makeState(),
      paintBuffer: undefined,
    })).toBeUndefined();
  });
});
