import { ColorCycleRuntimeDocumentState } from '@/hooks/brushEngine/colorCycleRuntimeDocumentState';
import {
  ColorCycleLayerDocument,
  type ColorCycleBrushPersistenceStrokeState,
  type ColorCycleLayerDocumentState,
} from '@/lib/colorCycle/document';

const makeState = (paint: number[], hasContent: boolean): ColorCycleLayerDocumentState => ({
  layerId: 'cc-layer',
  width: 2,
  height: 2,
  paintBuffer: new Uint8Array(paint).buffer,
  hasContent,
  sources: { brushStateSnapshot: true, topLevelBuffers: false, legacyStateRefs: false },
});

describe('ColorCycleRuntimeDocumentState restore rebase', () => {
  it('uses one preview version for runtime reads and cache keys during finalization', () => {
    const runtime = new ColorCycleRuntimeDocumentState<ColorCycleBrushPersistenceStrokeState>();
    const document = new ColorCycleLayerDocument(makeState([1, 0, 0, 0], true));
    runtime.setLayerDocument('cc-layer', document);
    const edit = document.beginEdit('stroke-finalize');
    document.replaceState(makeState([2, 0, 0, 0], true), 'pending-pixels');
    expect(document.read().version).toBe(0);
    expect(runtime.getLayerDocumentRead('cc-layer')?.version).toBe(1);
    expect(runtime.getLayerDocumentVersion('cc-layer')).toBe(1);
    document.cancelEdit(edit);
    expect(runtime.getLayerDocumentVersion('cc-layer')).toBe(0);
  });

  it('rejects invalid publication before installing replacement runtime state', () => {
    const runtime = new ColorCycleRuntimeDocumentState<ColorCycleBrushPersistenceStrokeState>();
    const document = new ColorCycleLayerDocument(makeState([9, 0, 0, 0], true));
    const makeStroke = (value: number): ColorCycleBrushPersistenceStrokeState => ({
      hasContent: true,
      buffers: {
        paint: new Uint8Array([value, 0, 0, 0]), gid: new Uint8Array(4),
        def: new Uint16Array(4), spd: new Uint8Array(4), flow: new Uint8Array(4), phase: new Uint8Array(4),
      },
    });
    const previous = makeStroke(9);
    runtime.setLayerDocument('cc-layer', document);
    runtime.setStrokeState('cc-layer', previous);
    expect(() => runtime.setStrokeStateWithDocumentPublish({
      layerId: 'cc-layer', strokeState: makeStroke(1), publishToDocument: true,
      buildDocumentState: () => ({ ...makeState([1, 0, 0, 0], true), width: 3 }),
    })).toThrow();
    expect(runtime.getStrokeState('cc-layer')).toBe(previous);
    expect(document.version).toBe(0);
  });

  it('rejects an empty candidate over populated canonical paint without moving anchors', () => {
    const runtime = new ColorCycleRuntimeDocumentState<ColorCycleBrushPersistenceStrokeState>();
    const document = new ColorCycleLayerDocument(makeState([9, 0, 0, 0], true), {
      initialVersion: 7,
      initialPixelVersion: 5,
    });
    runtime.setLayerDocument('cc-layer', document);

    runtime.rebaseLayerDocument({
      layerId: 'cc-layer',
      preserveVersion: true,
      buildState: () => makeState([0, 0, 0, 0], false),
    });

    const read = document.read();
    expect(read.version).toBe(7);
    expect(read.pixelVersion).toBe(5);
    expect(Array.from(new Uint8Array(read.snapshot.paintBuffer ?? new ArrayBuffer(0))))
      .toEqual([9, 0, 0, 0]);
  });

  it('accepts populated restore candidates while preserving both requested anchors', () => {
    const runtime = new ColorCycleRuntimeDocumentState<ColorCycleBrushPersistenceStrokeState>();
    const document = new ColorCycleLayerDocument(makeState([3, 0, 0, 0], true), {
      initialVersion: 9,
      initialPixelVersion: 4,
    });
    runtime.setLayerDocument('cc-layer', document);

    runtime.rebaseLayerDocument({
      layerId: 'cc-layer',
      preserveVersion: true,
      clearAudit: false,
      buildState: () => makeState([0, 6, 0, 0], false),
    });

    const read = document.read();
    expect(read.version).toBe(9);
    expect(read.pixelVersion).toBe(4);
    expect(read.snapshot.hasContent).toBe(false);
    expect(Array.from(new Uint8Array(read.snapshot.paintBuffer ?? new ArrayBuffer(0))))
      .toEqual([0, 6, 0, 0]);
  });

  it.each([
    ['missing paint', { ...makeState([0, 0, 0, 0], false), paintBuffer: undefined }],
    ['contradictory marker', makeState([0, 0, 0, 0], true)],
  ])('rejects an invalid %s candidate', (_label, candidate) => {
    const runtime = new ColorCycleRuntimeDocumentState<ColorCycleBrushPersistenceStrokeState>();
    const document = new ColorCycleLayerDocument(makeState([4, 0, 0, 0], true), {
      initialVersion: 3,
      initialPixelVersion: 2,
    });
    runtime.setLayerDocument('cc-layer', document);

    runtime.rebaseLayerDocument({
      layerId: 'cc-layer',
      preserveVersion: true,
      buildState: () => candidate,
    });

    expect(document.read()).toEqual(expect.objectContaining({
      version: 3,
      pixelVersion: 2,
      snapshot: expect.objectContaining({ hasContent: true }),
    }));
  });
});
