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

export interface ShapeGradientSampleJob {
  type: 'shape-gradient-sample';
  width: number;
  height: number;
  originX: number;
  originY: number;
  sampleScaleX: number;
  sampleScaleY: number;
  vertices: Float32Array;
  compositePixels: ArrayBuffer;
  referencePixels?: ArrayBuffer;
  maxColors: number;
  mode: 'linear' | 'concentric';
  directionX?: number;
  directionY?: number;
}

export interface ShapeGradientSampleResult {
  stops: Array<{ position: number; color: string }>;
  dominantColor: string;
  stats: {
    sampledPixels: number;
    uniqueColorBins: number;
    outputColors: number;
    alphaWeight: number;
  };
}

export type ColorCycleFillJob = PerceptualDitherJob | ConcentricFillJob | ShapeGradientSampleJob;
export type ColorCycleFillResult = PerceptualDitherResult | ConcentricFillResult | ShapeGradientSampleResult;

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
