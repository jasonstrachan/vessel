/**
 * Utility for constructing uniform blocks with explicit byte offsets.
 * WGSL uniform structs are laid out in 16-byte multiples (vec4 alignment).
 * This writer exposes typed helpers that always operate on 4-byte boundaries.
 */
export class UniformBufferWriter {
  private readonly arrayBuffer: ArrayBuffer;
  private readonly float32View: Float32Array;
  private readonly uint32View: Uint32Array;

  constructor(byteLength: number) {
    this.arrayBuffer = new ArrayBuffer(byteLength);
    this.float32View = new Float32Array(this.arrayBuffer);
    this.uint32View = new Uint32Array(this.arrayBuffer);
  }

  writeF32(byteOffset: number, value: number): void {
    this.float32View[byteOffset >> 2] = value;
  }

  writeU32(byteOffset: number, value: number): void {
    this.uint32View[byteOffset >> 2] = value >>> 0;
  }

  get buffer(): ArrayBuffer {
    return this.arrayBuffer;
  }
}
