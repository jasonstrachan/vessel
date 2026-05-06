import { resolvePersistedColorCycleExportEligibility } from '@/utils/export/goblet/colorCycleExportSourceEligibility';
import type { Layer } from '@/types';

const createLayer = (colorCycleData: NonNullable<Layer['colorCycleData']>): Layer => ({
  id: 'cc-layer',
  name: 'CC Layer',
  visible: true,
  opacity: 1,
  blendMode: 'source-over',
  locked: false,
  transparencyLocked: false,
  order: 0,
  imageData: null,
  framebuffer: { width: 2, height: 2 } as HTMLCanvasElement,
  alignment: {
    fit: 'none',
    horizontal: 'left',
    vertical: 'top',
    positioning: 'anchor',
  },
  layerType: 'color-cycle',
  colorCycleData,
  version: 1,
});

const completeStrokeData = () => ({
  paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
  gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
  gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
});

describe('resolvePersistedColorCycleExportEligibility', () => {
  it.each([
    {
      name: 'canonical complete persisted state',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'cc-layer',
            strokeData: completeStrokeData(),
          }],
        },
      },
      expected: 'ok',
    },
    {
      name: 'non-canonical persisted state with buffers',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        brushState: {
          layers: [{
            layerId: 'cc-layer',
            strokeData: completeStrokeData(),
          }],
        },
      },
      expected: 'non-canonical',
    },
    {
      name: 'unsupported persisted schema',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 2,
          layers: [{
            layerId: 'cc-layer',
            strokeData: completeStrokeData(),
          }],
        },
      },
      expected: 'unsupported-schema',
    },
    {
      name: 'canonical state missing gradient bindings',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'cc-layer',
            strokeData: {
              paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
            },
          }],
        },
      },
      expected: 'missing-export-buffers',
    },
    {
      name: 'canonical state with top-level gradient binding fallbacks',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        gradientIdBuffer: Uint8Array.from([0, 0, 0, 0]).buffer,
        gradientDefIdBuffer: new Uint16Array([1, 1, 1, 1]).buffer,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'cc-layer',
            strokeData: {
              paintBuffer: Uint8Array.from([1, 2, 3, 4]).buffer,
            },
          }],
        },
      },
      expected: 'ok',
    },
    {
      name: 'single fallback entry with snapshot canonical marker',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        brushState: {
          schemaVersion: 1,
          layers: [{
            layerId: 'stale-layer-id',
            canonicalPaint: true,
            schemaVersion: 1,
            strokeData: completeStrokeData(),
          }],
        },
      },
      expected: 'ok',
    },
    {
      name: 'single fallback entry with unsupported snapshot schema',
      colorCycleData: {
        mode: 'brush',
        isAnimating: true,
        hasContent: true,
        brushState: {
          canonicalPaint: true,
          schemaVersion: 1,
          layers: [{
            layerId: 'stale-layer-id',
            schemaVersion: 2,
            strokeData: completeStrokeData(),
          }],
        },
      },
      expected: 'unsupported-schema',
    },
  ])('$name -> $expected', ({ colorCycleData, expected }) => {
    const result = resolvePersistedColorCycleExportEligibility(createLayer(colorCycleData as NonNullable<Layer['colorCycleData']>));

    expect(result.ok ? 'ok' : result.reason).toBe(expected);
  });
});
