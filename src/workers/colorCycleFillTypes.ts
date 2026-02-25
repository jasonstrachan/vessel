export interface PaletteMapEntry {
  rgb: [number, number, number];
  index: number;
}

export interface PerceptualDitherJob {
  type: 'perceptual-dither';
  mode: 'linear' | 'concentric';
  width: number;
  height: number;
  baseOffset: number;
  quantLevels: number;
  ditherPixelSize: number;
  paletteCss: string[];
  paletteMapEntries: PaletteMapEntry[];
  pixels: ArrayBuffer;
}

export interface PerceptualDitherResult {
  width: number;
  height: number;
  indices: ArrayBuffer;
}

export interface ConcentricFillJob {
  type: 'concentric-fill';
  vertices: Float32Array;
  bbox: { minX: number; minY: number; width: number; height: number };
  bands: number;
  baseOffset: number;
  maxDist: number;
  ditherEnabled: boolean;
  ditherStrength: number;
  ditherPixelSize: number;
  noiseSeed?: number;
}

export interface ConcentricFillResult {
  width: number;
  height: number;
  indices: ArrayBuffer;
}
export type ColorCycleFillJob = PerceptualDitherJob | ConcentricFillJob;
export type ColorCycleFillResult = PerceptualDitherResult | ConcentricFillResult;

export type ColorCycleFillWorkerMessage = {
  id: number;
  job: ColorCycleFillJob;
};

export type ColorCycleFillWorkerResponse = {
  id: number;
  ok: boolean;
  type: ColorCycleFillJob['type'];
  result?: ColorCycleFillResult;
  error?: string;
};
