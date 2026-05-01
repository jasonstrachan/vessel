import {
  authorizeSelectionDelete,
  normalizeSelectionDeleteSource,
  resolveSelectionDeleteBounds,
  summarizeColorCycleSelectionPaint,
} from '@/stores/helpers/selectionDeleteAuthorization';
import { createDefaultLayerAlignment } from '@/utils/layoutDefaults';
import type { Layer, Project } from '@/types';

const createProject = (): Project => ({
  id: 'project-auth',
  name: 'auth',
  width: 4,
  height: 4,
  layers: [],
  backgroundColor: 'transparent',
  createdAt: new Date(0),
  updatedAt: new Date(0),
  customBrushes: [],
});

const createLayer = (overrides: Partial<Layer> = {}): Layer => ({
  id: 'layer-auth',
  name: 'Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  order: 0,
  imageData: null,
  framebuffer: null,
  alignment: createDefaultLayerAlignment(),
  layerType: 'normal',
  ...overrides,
} as Layer);

describe('selectionDeleteAuthorization', () => {
  it('normalizes only known delete sources', () => {
    expect(normalizeSelectionDeleteSource('keyboard-delete')).toBe('keyboard-delete');
    expect(normalizeSelectionDeleteSource('deleteSelectedPixels')).toBe('api-delete');
    expect(normalizeSelectionDeleteSource('legacy-delete')).toBeNull();
  });

  it('normalizes valid bounds and rejects empty bounds', () => {
    expect(resolveSelectionDeleteBounds({ x: 3, y: 4 }, { x: 1, y: 2 })).toEqual({
      x: 1,
      y: 2,
      width: 2,
      height: 2,
    });
    expect(resolveSelectionDeleteBounds({ x: 1, y: 1 }, { x: 1, y: 4 })).toBeNull();
  });

  it('summarizes selected CC paint before mutation', () => {
    const paint = new Uint8Array([
      1, 1, 0, 0,
      1, 1, 0, 0,
      0, 0, 2, 2,
      0, 0, 2, 2,
    ]);

    expect(summarizeColorCycleSelectionPaint({
      paintBuffer: paint,
      paintWidth: 4,
      paintHeight: 4,
      bounds: { x: 0, y: 0, width: 2, height: 2 },
    })).toEqual({
      paintWidth: 4,
      paintHeight: 4,
      totalNonZeroPaint: 8,
      selectedNonZeroPaint: 4,
      wouldClearAllPaint: false,
    });

    expect(summarizeColorCycleSelectionPaint({
      paintBuffer: paint,
      paintWidth: 4,
      paintHeight: 4,
      bounds: { x: 0, y: 0, width: 4, height: 4 },
    }).wouldClearAllPaint).toBe(true);
  });

  it('blocks cross-layer provenance before mutation', () => {
    const authorization = authorizeSelectionDelete({
      source: 'keyboard-delete',
      activeLayer: createLayer({ id: 'active' }),
      activeLayerId: 'active',
      project: createProject(),
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
        activeLayerId: 'other',
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
    });

    expect(authorization).toMatchObject({
      ok: false,
      reason: 'selection-layer-mismatch',
      clearSelection: true,
    });
  });

  it('blocks cross-layer masks before mutation', () => {
    const authorization = authorizeSelectionDelete({
      source: 'keyboard-delete',
      activeLayer: createLayer({ id: 'active' }),
      activeLayerId: 'active',
      project: createProject(),
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionMask: new ImageData(2, 2),
      selectionMaskBounds: { x: 0, y: 0, width: 2, height: 2 },
      selectionMaskLayerId: 'other',
      selectionLastAction: {
        action: 'set-bounds',
        source: 'freehand',
        ownerKind: 'mask-selection',
        t: 1,
        activeLayerId: 'active',
        maskLayerId: 'other',
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
    });

    expect(authorization).toMatchObject({
      ok: false,
      reason: 'selection-mask-layer-mismatch',
      clearSelection: true,
    });
  });

  it('blocks history-restored CC keyboard delete even on the active layer', () => {
    const authorization = authorizeSelectionDelete({
      source: 'keyboard-delete',
      activeLayer: createLayer({ id: 'active', layerType: 'color-cycle' }),
      activeLayerId: 'active',
      project: createProject(),
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 2, y: 2 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
      selectionLastAction: {
        action: 'set-bounds',
        source: 'history-selection-backward',
        ownerKind: 'history-restored',
        restoredFromHistory: true,
        t: 1,
        activeLayerId: 'active',
        bounds: { x: 0, y: 0, width: 2, height: 2 },
      },
      colorCyclePaint: {
        buffer: new Uint8Array(16).fill(1),
        width: 4,
        height: 4,
      },
    });

    expect(authorization).toMatchObject({
      ok: false,
      reason: 'history-restored-keyboard-delete',
      clearSelection: false,
    });
  });

  it('blocks normal CC keyboard deletes that would clear all paint', () => {
    const authorization = authorizeSelectionDelete({
      source: 'keyboard-delete',
      activeLayer: createLayer({ id: 'active', layerType: 'color-cycle' }),
      activeLayerId: 'active',
      project: createProject(),
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
        activeLayerId: 'active',
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
      colorCyclePaint: {
        buffer: new Uint8Array(16).fill(1),
        width: 4,
        height: 4,
      },
    });

    expect(authorization).toMatchObject({
      ok: false,
      reason: 'keyboard-full-content-clear-blocked',
      clearSelection: false,
      colorCyclePaintSummary: expect.objectContaining({
        totalNonZeroPaint: 16,
        selectedNonZeroPaint: 16,
        wouldClearAllPaint: true,
      }),
    });
  });

  it('allows explicit same-layer select-all CC delete', () => {
    const authorization = authorizeSelectionDelete({
      source: 'keyboard-delete',
      activeLayer: createLayer({ id: 'active', layerType: 'color-cycle' }),
      activeLayerId: 'active',
      project: createProject(),
      selectionStart: { x: 0, y: 0 },
      selectionEnd: { x: 4, y: 4 },
      selectionMask: null,
      selectionMaskBounds: null,
      selectionMaskLayerId: null,
      selectionLastAction: {
        action: 'select-all',
        source: 'keyboard-select-all',
        ownerKind: 'select-all',
        t: 1,
        activeLayerId: 'active',
        bounds: { x: 0, y: 0, width: 4, height: 4 },
      },
      colorCyclePaint: {
        buffer: new Uint8Array(16).fill(1),
        width: 4,
        height: 4,
      },
    });

    expect(authorization).toMatchObject({
      ok: true,
      allowFullContentClear: true,
      destructiveIntent: 'explicit-full-clear',
    });
  });
});
