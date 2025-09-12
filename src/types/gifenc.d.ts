declare module 'gifenc' {
  export type RGB = [number, number, number];
  export type RGBA = [number, number, number, number];
  export type Palette = RGB[] | RGBA[];

  export interface QuantizeOptions {
    format?: 'rgb565' | 'rgb444' | 'rgba4444';
    clearAlpha?: boolean;
    clearAlphaColor?: number;
    clearAlphaThreshold?: number;
    oneBitAlpha?: boolean | number;
    useSqrt?: boolean;
  }

  export function quantize(
    rgba: Uint8Array | Uint8ClampedArray,
    maxColors: number,
    opts?: QuantizeOptions
  ): Palette;

  export function applyPalette(
    rgba: Uint8Array | Uint8ClampedArray,
    palette: Palette,
    format?: 'rgb565' | 'rgb444' | 'rgba4444'
  ): Uint8Array;

  export interface GIFEncoderOptions {
    initialCapacity?: number;
    auto?: boolean; // auto-write header on first frame
  }

  export interface WriteFrameOptions {
    transparent?: boolean;
    transparentIndex?: number;
    delay?: number; // ms
    palette?: Palette; // required on first frame
    repeat?: number; // -1 once, 0 forever
    colorDepth?: number; // usually 8
    dispose?: number;
    first?: boolean; // when auto is false
  }

  export interface GIFEncoderInstance {
    reset(): void;
    finish(): void;
    bytes(): Uint8Array;
    bytesView(): Uint8Array;
    readonly buffer: ArrayBufferLike;
    readonly stream: unknown;
    writeHeader(): void;
    writeFrame(
      index: Uint8Array,
      width: number,
      height: number,
      opts?: WriteFrameOptions
    ): void;
  }

  export function GIFEncoder(options?: GIFEncoderOptions): GIFEncoderInstance;

  export function prequantize(
    rgba: Uint8Array | Uint8ClampedArray,
    options?: { roundRGB?: number; roundAlpha?: number; oneBitAlpha?: boolean | number }
  ): void;

  export function nearestColorIndex(
    colors: number[][],
    pixel: number[],
    distanceFn?: (a: number[], b: number[]) => number
  ): number;

  export function nearestColorIndexWithDistance(
    colors: number[][],
    pixel: number[],
    distanceFn?: (a: number[], b: number[]) => number
  ): [number, number];

  export function nearestColor<T extends number[]>(
    colors: T[],
    pixel: T,
    distanceFn?: (a: T, b: T) => number
  ): T;

  export function snapColorsToPalette(
    palette: number[][],
    knownColors: number[][],
    threshold?: number
  ): void;
}

