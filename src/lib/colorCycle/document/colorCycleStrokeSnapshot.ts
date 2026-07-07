export type ColorCycleStrokeBuffers = {
  paint: Uint8Array;
  gid: Uint8Array;
  spd: Uint8Array;
  flow: Uint8Array;
  phase: Uint8Array;
  def: Uint16Array;
};

export type ColorCycleStrokeSnapshot = {
  paintBuffer: ArrayBuffer;
  gradientIdBuffer?: ArrayBuffer;
  gradientDefIdBuffer?: ArrayBuffer;
  speedBuffer?: ArrayBuffer;
  flowBuffer?: ArrayBuffer;
  phaseBuffer?: ArrayBuffer;
  hasContent: boolean;
  strokeCounter: number;
};

export type ColorCycleStrokeSnapshotSource = {
  buffers: ColorCycleStrokeBuffers;
  snapshot?: ColorCycleStrokeSnapshot;
};

const cloneArrayBuffer = (buffer: ArrayBuffer | undefined): ArrayBuffer | undefined =>
  buffer && buffer.byteLength > 0 ? buffer.slice(0) : undefined;

export const cloneStrokeSnapshotBuffers = (
  source: ColorCycleStrokeSnapshotSource
): Omit<ColorCycleStrokeSnapshot, 'hasContent' | 'strokeCounter'> => {
  const { buffers, snapshot } = source;
  return {
    paintBuffer: buffers.paint.length > 0
      ? buffers.paint.slice().buffer
      : cloneArrayBuffer(snapshot?.paintBuffer) ?? new ArrayBuffer(0),
    gradientIdBuffer: buffers.gid.length > 0
      ? buffers.gid.slice().buffer
      : cloneArrayBuffer(snapshot?.gradientIdBuffer),
    gradientDefIdBuffer: buffers.def.length > 0
      ? buffers.def.slice().buffer
      : cloneArrayBuffer(snapshot?.gradientDefIdBuffer),
    speedBuffer: buffers.spd.length > 0
      ? buffers.spd.slice().buffer
      : cloneArrayBuffer(snapshot?.speedBuffer),
    flowBuffer: buffers.flow.length > 0
      ? buffers.flow.slice().buffer
      : cloneArrayBuffer(snapshot?.flowBuffer),
    phaseBuffer: buffers.phase.length > 0
      ? buffers.phase.slice().buffer
      : cloneArrayBuffer(snapshot?.phaseBuffer),
  };
};
