import { cloneStrokeSnapshotBuffers } from '@/hooks/brushEngine/colorCycleStrokeSnapshot';

const emptyBuffers = () => ({
  paint: new Uint8Array(0),
  gid: new Uint8Array(0),
  spd: new Uint8Array(0),
  flow: new Uint8Array(0),
  phase: new Uint8Array(0),
  def: new Uint16Array(0),
});

describe('colorCycleStrokeSnapshot', () => {
  it('clones live stroke buffers before snapshot fallbacks', () => {
    const result = cloneStrokeSnapshotBuffers({
      buffers: {
        paint: Uint8Array.from([1, 2]),
        gid: Uint8Array.from([3, 4]),
        spd: Uint8Array.from([5, 6]),
        flow: Uint8Array.from([7, 8]),
        phase: Uint8Array.from([9, 10]),
        def: Uint16Array.from([11, 12]),
      },
      snapshot: {
        paintBuffer: Uint8Array.from([99]).buffer,
        gradientIdBuffer: Uint8Array.from([99]).buffer,
        gradientDefIdBuffer: Uint16Array.from([99]).buffer,
        speedBuffer: Uint8Array.from([99]).buffer,
        flowBuffer: Uint8Array.from([99]).buffer,
        phaseBuffer: Uint8Array.from([99]).buffer,
        hasContent: true,
        strokeCounter: 1,
      },
    });

    expect(Array.from(new Uint8Array(result.paintBuffer))).toEqual([1, 2]);
    expect(Array.from(new Uint8Array(result.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([3, 4]);
    expect(Array.from(new Uint16Array(result.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([11, 12]);
    expect(Array.from(new Uint8Array(result.speedBuffer ?? new ArrayBuffer(0)))).toEqual([5, 6]);
    expect(Array.from(new Uint8Array(result.flowBuffer ?? new ArrayBuffer(0)))).toEqual([7, 8]);
    expect(Array.from(new Uint8Array(result.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([9, 10]);
  });

  it('falls back to snapshot buffers when live buffers are empty', () => {
    const result = cloneStrokeSnapshotBuffers({
      buffers: emptyBuffers(),
      snapshot: {
        paintBuffer: Uint8Array.from([1]).buffer,
        gradientIdBuffer: Uint8Array.from([2]).buffer,
        gradientDefIdBuffer: Uint16Array.from([3]).buffer,
        speedBuffer: Uint8Array.from([4]).buffer,
        flowBuffer: Uint8Array.from([5]).buffer,
        phaseBuffer: Uint8Array.from([6]).buffer,
        hasContent: true,
        strokeCounter: 1,
      },
    });

    expect(Array.from(new Uint8Array(result.paintBuffer))).toEqual([1]);
    expect(Array.from(new Uint8Array(result.gradientIdBuffer ?? new ArrayBuffer(0)))).toEqual([2]);
    expect(Array.from(new Uint16Array(result.gradientDefIdBuffer ?? new ArrayBuffer(0)))).toEqual([3]);
    expect(Array.from(new Uint8Array(result.speedBuffer ?? new ArrayBuffer(0)))).toEqual([4]);
    expect(Array.from(new Uint8Array(result.flowBuffer ?? new ArrayBuffer(0)))).toEqual([5]);
    expect(Array.from(new Uint8Array(result.phaseBuffer ?? new ArrayBuffer(0)))).toEqual([6]);
  });
});
