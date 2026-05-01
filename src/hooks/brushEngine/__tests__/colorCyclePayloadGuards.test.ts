import {
  brushStateHasCcPayload,
  bufferHasNonZeroPayload,
  hasCcPayload,
} from '@/hooks/brushEngine/colorCyclePayloadGuards';

describe('colorCyclePayloadGuards', () => {
  it('treats non-empty refs and buffers as payload presence', () => {
    expect(hasCcPayload('zip:layers/layer-1/paint.bin')).toBe(true);
    expect(hasCcPayload(new Uint8Array([0, 0]).buffer)).toBe(true);
    expect(hasCcPayload(new Uint8Array([0, 0]))).toBe(true);
    expect(hasCcPayload('')).toBe(false);
    expect(hasCcPayload(new ArrayBuffer(0))).toBe(false);
  });

  it('distinguishes non-zero hydrated buffers from allocated zero buffers', () => {
    expect(bufferHasNonZeroPayload(new Uint8Array([0, 0, 0]).buffer)).toBe(false);
    expect(bufferHasNonZeroPayload(new Uint8Array([0, 1, 0]).buffer)).toBe(true);
    expect(bufferHasNonZeroPayload(Uint16Array.from([0, 9]))).toBe(true);
    expect(bufferHasNonZeroPayload('zip:payload.bin')).toBe(false);
  });

  it('finds canonical-looking payload in serialized brush snapshots', () => {
    expect(brushStateHasCcPayload({
      layers: [{
        strokeData: {
          paintBuffer: new Uint8Array([0, 0]).buffer,
          gradientIdBuffer: new Uint8Array([0, 3]).buffer,
        },
      }],
    })).toBe(true);
    expect(brushStateHasCcPayload({
      layers: [{
        strokeData: {
          hasContent: true,
          paintBuffer: new Uint8Array([0, 0]).buffer,
        },
      }],
    })).toBe(true);
    expect(brushStateHasCcPayload({
      layers: [{
        strokeData: {
          paintBuffer: new Uint8Array([0, 0]).buffer,
          gradientIdBuffer: new Uint8Array([0, 0]).buffer,
        },
      }],
    })).toBe(false);
  });
});
