import {
  preflightCcSelectionTransaction,
  type CcCanonicalSelectionPayload,
} from '@/stores/helpers/colorCycleSelectionTransaction';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

const createProject = (): Project => ({
  id: 'project-cc-transaction',
  name: 'CC Transaction',
  width: 4,
  height: 4,
  layers: [],
  backgroundColor: 'transparent',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
});

const createCcLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: 'layer-cc',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: null,
  alignment: createDefaultLayerAlignment(),
  layerType: 'color-cycle',
  colorCycleData: {
    hasContent: true,
    gradientDefStore: [
      {
        id: 2,
        kind: 'linear',
        stops: [
          { position: 0, color: '#000000' },
          { position: 1, color: '#ffffff' },
        ],
        hash: 'def-2',
        source: 'manual',
        createdAtMs: 1,
      },
    ],
  },
  ...overrides,
} as Layer);

const createCanonicalPayload = (
  overrides: Partial<CcCanonicalSelectionPayload> = {}
): CcCanonicalSelectionPayload => ({
  paintBuffer: new Uint8Array([
    1, 1, 0, 0,
    1, 1, 0, 0,
    0, 0, 2, 2,
    0, 0, 2, 2,
  ]),
  gradientIdBuffer: new Uint8Array(16).fill(1),
  gradientDefIdBuffer: new Uint16Array(16).fill(2),
  speedBuffer: new Uint8Array(16),
  flowBuffer: new Uint8Array(16),
  phaseBuffer: new Uint8Array(16),
  width: 4,
  height: 4,
  ...overrides,
});

const baseRequest = () => ({
  operation: 'extract-selection-transform' as const,
  transactionId: 'tx-test',
  activeLayer: createCcLayer(),
  activeLayerId: 'layer-cc',
  project: createProject(),
  selectionStart: { x: 0, y: 0 },
  selectionEnd: { x: 2, y: 2 },
  selectionMask: null,
  selectionMaskBounds: null,
  selectionMaskLayerId: null,
  selectionLastAction: {
    action: 'set-bounds' as const,
    source: 'selection-marquee-final',
    ownerKind: 'direct-marquee' as const,
    t: 1,
    activeLayerId: 'layer-cc',
    bounds: { x: 0, y: 0, width: 2, height: 2 },
  },
  canonical: createCanonicalPayload(),
});

describe('colorCycleSelectionTransaction preflight', () => {
  it('blocks stale layer ownership before mutation', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      selectionLastAction: {
        ...baseRequest().selectionLastAction,
        activeLayerId: 'other-layer',
      },
    });

    expect(result).toMatchObject({
      ok: false,
      transactionId: 'tx-test',
      kind: 'selection-layer-mismatch',
      operation: 'extract-selection-transform',
      clearSelection: true,
    });
  });

  it('blocks stale mask ownership before mutation', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      selectionMask: new ImageData(2, 2),
      selectionMaskBounds: { x: 0, y: 0, width: 2, height: 2 },
      selectionMaskLayerId: 'other-layer',
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'selection-mask-layer-mismatch',
      clearSelection: true,
    });
  });

  it('blocks missing canonical payload before mutation', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      canonical: {
        ...createCanonicalPayload(),
        gradientIdBuffer: new Uint8Array(15),
      },
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'missing-canonical-payload',
      clearSelection: false,
      details: expect.objectContaining({
        expectedPixels: 16,
        gradientIdBytes: 15,
      }),
    });
  });

  it('blocks scalar buffer dimension mismatch before mutation', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      canonical: {
        ...createCanonicalPayload(),
        phaseBuffer: new Uint8Array(12),
      },
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'missing-canonical-payload',
      details: expect.objectContaining({
        phaseBytes: 12,
      }),
    });
  });

  it('blocks referenced gradient def ids that are missing from the def store', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      activeLayer: createCcLayer({
        colorCycleData: {
          hasContent: true,
          gradientDefStore: [],
        },
      } as Partial<Layer>),
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'missing-gradient-definition',
      details: {
        missingDefIds: [2],
      },
    });
  });

  it('allows partial extract and marks payload capture as required', () => {
    const result = preflightCcSelectionTransaction(baseRequest());

    expect(result).toMatchObject({
      ok: true,
      kind: 'partial-clear',
      operation: 'extract-selection-transform',
      bounds: { x: 0, y: 0, width: 2, height: 2 },
      requiresPayload: true,
      paintSummary: expect.objectContaining({
        totalNonZeroPaint: 8,
        selectedNonZeroPaint: 4,
        wouldClearAllPaint: false,
      }),
    });
  });

  it('allows full-object marquee extract and classifies it as a full-object move', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      selectionEnd: { x: 4, y: 4 },
      selectionLastAction: {
        ...baseRequest().selectionLastAction,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'full-object-move',
      operation: 'extract-selection-transform',
      requiresPayload: true,
      paintSummary: expect.objectContaining({
        totalNonZeroPaint: 8,
        selectedNonZeroPaint: 8,
        wouldClearAllPaint: true,
      }),
    });
  });

  it('blocks non-explicit keyboard full delete', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      operation: 'delete-selected',
      source: 'keyboard-delete',
      selectionEnd: { x: 4, y: 4 },
      selectionLastAction: {
        ...baseRequest().selectionLastAction,
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'invalid-selection',
      operation: 'delete-selected',
      clearSelection: false,
      details: expect.objectContaining({
        reason: 'keyboard-full-content-clear-blocked',
      }),
    });
  });

  it('allows explicit select-all delete without requiring a paste payload', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      operation: 'delete-selected',
      source: 'keyboard-delete',
      selectionEnd: { x: 4, y: 4 },
      selectionLastAction: {
        action: 'select-all',
        source: 'keyboard-select-all',
        ownerKind: 'select-all',
        t: 1,
        activeLayerId: 'layer-cc',
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
    });

    expect(result).toMatchObject({
      ok: true,
      kind: 'explicit-full-delete',
      operation: 'delete-selected',
      requiresPayload: false,
    });
  });

  it('blocks color-cycle transaction routing into a non-CC target layer', () => {
    const result = preflightCcSelectionTransaction({
      ...baseRequest(),
      operation: 'commit-floating-paste',
      activeLayer: {
        ...createCcLayer(),
        layerType: 'normal',
        colorCycleData: undefined,
      } as Layer,
    });

    expect(result).toMatchObject({
      ok: false,
      kind: 'unsupported-cross-layer-target',
      operation: 'commit-floating-paste',
      clearSelection: false,
    });
  });
});
