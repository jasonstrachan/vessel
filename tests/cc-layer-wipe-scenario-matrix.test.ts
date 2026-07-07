import {
  captureColorCyclePersistenceSnapshot,
  emitColorCycleDocumentStateFromBrushState,
  emitColorCycleDocumentStateFromDeferredArchive,
  type ColorCycleLayerDocumentReader,
  type ColorCyclePersistenceDocumentState,
  type DeferredColorCycleArchiveRuntime,
  type PersistedColorCycleBrushState,
} from '@/lib/colorCycle/persistence';
import * as colorCycleBrushManager from '@/stores/colorCycleBrushManager';
import { hasColorCycleCanonicalEditSource } from '@/hooks/canvas/handlers/colorCycle/colorCycleRuntimeWarmup';
import { authorizeSelectionDelete } from '@/stores/helpers/selectionDeleteAuthorization';
import { __TESTING__ } from '@/utils/export/webglExporter';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

const { serializeColorCycleData } = __TESTING__;

const managerDocuments = new Map<string, ColorCycleLayerDocumentReader>();

beforeEach(() => {
  managerDocuments.clear();
  jest.spyOn(colorCycleBrushManager, 'getColorCycleBrushManager').mockReturnValue({
    getBrush: () => null,
    getDocument: (layerId: string) => managerDocuments.get(layerId),
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const project: Project = {
  id: 'project-cc-matrix',
  name: 'CC Matrix',
  width: 4,
  height: 4,
  layers: [],
  backgroundColor: 'transparent',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
};

const bytes = (values: number[]): ArrayBuffer => Uint8Array.from(values).buffer;
const defIds = (values: number[]): ArrayBuffer => Uint16Array.from(values).buffer;

const createDocumentReader = (
  snapshot: ColorCyclePersistenceDocumentState,
  version = 1,
): ColorCycleLayerDocumentReader => ({
  runtimePolicy: {
    hasEditableSource: Boolean(
      snapshot.paintBuffer &&
      snapshot.gradientIdBuffer &&
      snapshot.gradientDefIdBuffer &&
      snapshot.speedBuffer &&
      snapshot.flowBuffer &&
      snapshot.phaseBuffer,
    ),
    hasRuntimeRestoreSource: Boolean(snapshot.paintBuffer),
    hasPlaybackWarmupSource: Boolean(snapshot.paintBuffer),
    isPreviewOnly: !snapshot.paintBuffer,
  },
  read: () => ({
    snapshot: snapshot as ReturnType<ColorCycleLayerDocumentReader['read']>['snapshot'],
    version,
  }),
} as unknown as ColorCycleLayerDocumentReader);

const attachDocumentReader = (layer: Layer, document: ColorCycleLayerDocumentReader): void => {
  managerDocuments.set(layer.id, document);
  layer.colorCycleData = {
    ...layer.colorCycleData!,
    colorCycleBrush: {
      getColorCycleLayerDocument: () => document,
    } as unknown as NonNullable<Layer['colorCycleData']>['colorCycleBrush'],
  };
};

const getAttachedDocumentReader = (layer: Layer): ColorCycleLayerDocumentReader => {
  const brush = layer.colorCycleData?.colorCycleBrush as {
    getColorCycleLayerDocument?: (layerId: string) => ColorCycleLayerDocumentReader | undefined;
  } | undefined;
  const document = brush?.getColorCycleLayerDocument?.(layer.id);
  if (!document) {
    throw new Error(`Missing test color-cycle document for ${layer.id}`);
  }
  return document;
};

const makeCanonicalLayer = (overrides: Partial<Layer> = {}): Layer => {
  const paint = bytes([
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 2, 2,
    0, 0, 2, 2,
  ]);
  const gradientId = bytes([
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 2, 2,
    0, 0, 2, 2,
  ]);
  const gradientDefId = defIds([
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 2, 2,
    0, 0, 2, 2,
  ]);
  const speed = bytes(new Array(16).fill(64));
  const flow = bytes(new Array(16).fill(1));
  const phase = bytes(new Array(16).fill(0));

  const layer = {
    id: 'layer-cc-matrix',
    name: 'CC Matrix Layer',
    visible: true,
    opacity: 1,
    blendMode: 'source-over',
    locked: false,
    order: 0,
    imageData: null,
    framebuffer: { width: 4, height: 4 } as HTMLCanvasElement,
    alignment: createDefaultLayerAlignment(),
    layerType: 'color-cycle',
    colorCycleData: {
      mode: 'brush',
      hasContent: true,
      canvasWidth: 4,
      canvasHeight: 4,
      gradient: [
        { position: 0, color: '#000000' },
        { position: 1, color: '#ffffff' },
      ],
      gradientIdBuffer: gradientId,
      gradientDefIdBuffer: gradientDefId,
      phaseBuffer: phase,
      brushState: {
        canonicalPaint: true,
        schemaVersion: 1,
        layers: [{
          layerId: 'layer-cc-matrix',
          canonicalPaint: true,
          schemaVersion: 1,
          dimensions: { width: 4, height: 4 },
          strokeData: {
            hasContent: true,
            paintBuffer: paint,
            gradientIdBuffer: gradientId,
            gradientDefIdBuffer: gradientDefId,
            speedBuffer: speed,
            flowBuffer: flow,
            phaseBuffer: phase,
          },
        }],
      },
    },
    version: 1,
    ...overrides,
  } as Layer;

  const brushState = layer.colorCycleData?.brushState as PersistedColorCycleBrushState | undefined;
  if (brushState) {
    const documentState = emitColorCycleDocumentStateFromBrushState(
      layer,
      brushState,
      project.width,
      project.height,
    );
    if (documentState) {
      attachDocumentReader(layer, createDocumentReader(documentState));
    }
  }

  return layer;
};

describe('CC layer wipe/data-loss scenario matrix', () => {
  it('keeps cold archive refs canonical for save/autosave/reload proof without turning unresolved refs into Goblet brush payload', async () => {
    const coldLayer = makeCanonicalLayer({
      id: 'layer-cold-archive',
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        runtimeHydrationState: 'cold',
        deferredRuntimeRestore: true,
        canvasWidth: 4,
        canvasHeight: 4,
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
      },
      state: {
        hasContent: true,
        paintRef: 'zip:buffers/color-cycle/layer-cold-archive/paint.bin',
        gradientIdRef: 'zip:buffers/color-cycle/layer-cold-archive/gradient-id.bin',
        gradientDefIdRef: 'zip:buffers/color-cycle/layer-cold-archive/gradient-def-id.bin',
        speedRef: 'zip:buffers/color-cycle/layer-cold-archive/speed.bin',
        flowRef: 'zip:buffers/color-cycle/layer-cold-archive/flow.bin',
        phaseRef: 'zip:buffers/color-cycle/layer-cold-archive/phase.bin',
      },
    } as Partial<Layer>);
    coldLayer.colorCycleData!.brushState = undefined;
    coldLayer.colorCycleData!.gradientIdBuffer = undefined;
    coldLayer.colorCycleData!.gradientDefIdBuffer = undefined;
    coldLayer.colorCycleData!.phaseBuffer = undefined;

    const deferredRuntime: DeferredColorCycleArchiveRuntime = {
      paintRef: 'zip:buffers/color-cycle/layer-cold-archive/paint.bin',
      gradientIdRef: 'zip:buffers/color-cycle/layer-cold-archive/gradient-id.bin',
      gradientDefIdRef: 'zip:buffers/color-cycle/layer-cold-archive/gradient-def-id.bin',
      speedRef: 'zip:buffers/color-cycle/layer-cold-archive/speed.bin',
      flowRef: 'zip:buffers/color-cycle/layer-cold-archive/flow.bin',
      phaseRef: 'zip:buffers/color-cycle/layer-cold-archive/phase.bin',
    };
    const archiveManifest = {
      has: (path: string) => path.startsWith('buffers/color-cycle/layer-cold-archive/'),
    };
    const documentState = emitColorCycleDocumentStateFromDeferredArchive(
      coldLayer,
      deferredRuntime,
      project.width,
      project.height,
    );
    expect(documentState).toBeDefined();
    const document = createDocumentReader(documentState!);
    attachDocumentReader(coldLayer, document);

    for (const mode of ['canonical-save', 'autosave', 'diagnostic'] as const) {
      expect(captureColorCyclePersistenceSnapshot(coldLayer, {
        projectWidth: 4,
        projectHeight: 4,
        requirePaint: true,
        mode,
        document,
        deferredRuntime,
        archiveManifest,
      })).toMatchObject({ ok: true, source: 'document' });
    }
    expect(hasColorCycleCanonicalEditSource(coldLayer)).toBe(true);
    await expect(serializeColorCycleData(coldLayer, project)).rejects.toThrow('missing animated brush data');
  });

  it('uses the same canonical payload proof for save, autosave, export, warmup, selection, and reload-like validation', async () => {
    const layer = makeCanonicalLayer();
    const document = getAttachedDocumentReader(layer);

    for (const mode of ['canonical-save', 'autosave', 'export', 'diagnostic'] as const) {
      expect(captureColorCyclePersistenceSnapshot(layer, {
        projectWidth: 4,
        projectHeight: 4,
        requirePaint: true,
        mode,
        document,
      })).toMatchObject({ ok: true, layerId: layer.id });
    }

    expect(hasColorCycleCanonicalEditSource(layer)).toBe(true);

    const partialSelection = authorizeSelectionDelete({
      source: 'keyboard-delete',
      activeLayer: layer,
      activeLayerId: layer.id,
      project,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
      selectionLastAction: {
        action: 'set-bounds',
        source: 'selection-marquee-final',
        ownerKind: 'direct-marquee',
        t: 1,
        activeLayerId: layer.id,
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
      colorCyclePaint: {
        buffer: new Uint8Array(layer.colorCycleData!.brushState!.layers![0].strokeData!.paintBuffer as ArrayBuffer),
        width: 4,
        height: 4,
        hasFullCanonicalPayload: true,
      },
    });
    expect(partialSelection).toMatchObject({ ok: true, destructiveIntent: 'normal' });

    const fullKeyboardSelection = authorizeSelectionDelete({
      source: 'keyboard-delete',
      activeLayer: layer,
      activeLayerId: layer.id,
      project,
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
      selectionLastAction: {
        action: 'set-bounds',
        source: 'selection-marquee-final',
        ownerKind: 'direct-marquee',
        t: 1,
        activeLayerId: layer.id,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
      colorCyclePaint: {
        buffer: new Uint8Array(layer.colorCycleData!.brushState!.layers![0].strokeData!.paintBuffer as ArrayBuffer),
        width: 4,
        height: 4,
        hasFullCanonicalPayload: true,
      },
    });
    expect(fullKeyboardSelection).toMatchObject({
      ok: false,
      reason: 'keyboard-full-content-clear-blocked',
    });

    const goblet = await serializeColorCycleData(layer, project);
    expect(goblet?.colorCycle?.brushState).toMatchObject({
      width: 4,
      height: 4,
      indexBuffer: expect.any(Array),
      gradientIdBuffer: expect.any(Array),
      gradientDefIdBuffer: expect.any(Array),
      flowBuffer: expect.any(Array),
      phaseBuffer: expect.any(Array),
    });
  });

  it('blocks gradient-only payloads from becoming editable or animated export data', async () => {
    const layer = makeCanonicalLayer({
      id: 'layer-gradient-only',
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 4,
        canvasHeight: 4,
        gradientIdBuffer: bytes(new Array(16).fill(1)),
        gradientDefIdBuffer: defIds(new Array(16).fill(1)),
        gradient: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
      },
    } as Partial<Layer>);

    expect(hasColorCycleCanonicalEditSource(layer)).toBe(false);
    expect(captureColorCyclePersistenceSnapshot(layer, {
      projectWidth: 4,
      projectHeight: 4,
      requirePaint: true,
      mode: 'export',
    })).toMatchObject({
      ok: false,
      reason: 'missing-document-source',
    });
    await expect(serializeColorCycleData(layer, project)).rejects.toThrow('missing animated brush data');
  });
});
