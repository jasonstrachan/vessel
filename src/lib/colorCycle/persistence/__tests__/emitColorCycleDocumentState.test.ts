import type { Layer } from '@/types';
import { decodeColorCycleSpeedByte, encodeColorCycleSpeedByte } from '@/utils/colorCycleSpeed';

import { emitColorCycleDocumentStateFromBrushState } from '../emitColorCycleDocumentState';

describe('emitColorCycleDocumentStateFromBrushState', () => {
  it('uses persisted write speed and the layer multiplier when motion buffers are missing', () => {
    const persistedWriteSpeed = 0.35;
    const layerMultiplier = 2;
    const layer = {
      id: 'cc-layer',
      layerType: 'color-cycle',
      colorCycleData: {
        mode: 'brush',
        hasContent: true,
        canvasWidth: 2,
        canvasHeight: 2,
        layerBaseSpeedCps: layerMultiplier,
      },
    } as Layer;
    const brushState = {
      canonicalPaint: true,
      schemaVersion: 1,
      cycleSpeed: persistedWriteSpeed,
      layers: [{
        layerId: layer.id,
        dimensions: { width: 2, height: 2 },
        strokeData: {
          hasContent: true,
          paintBuffer: new Uint8Array([1, 0, 0, 0]).buffer,
          gradientIdBuffer: new Uint8Array(4).buffer,
          gradientDefIdBuffer: new Uint16Array([1, 0, 0, 0]).buffer,
        },
      }],
    };

    const state = emitColorCycleDocumentStateFromBrushState(layer, brushState, 2, 2);

    expect(state?.speedBuffer).toBeInstanceOf(ArrayBuffer);
    const speeds = new Uint8Array(state?.speedBuffer as ArrayBuffer);
    expect(speeds[0]).toBe(encodeColorCycleSpeedByte(persistedWriteSpeed * layerMultiplier));
    expect(decodeColorCycleSpeedByte(speeds[0])).toBeCloseTo(
      decodeColorCycleSpeedByte(
        encodeColorCycleSpeedByte(persistedWriteSpeed * layerMultiplier),
      ),
      5,
    );
    expect(Array.from(speeds.slice(1))).toEqual([0, 0, 0]);
  });
});
