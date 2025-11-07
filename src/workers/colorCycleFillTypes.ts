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

export type ColorCycleFillWorkerMessage = {
  id: number;
  job: PerceptualDitherJob;
};

export type ColorCycleFillWorkerResponse = {
  id: number;
  ok: boolean;
  result?: PerceptualDitherResult;
  error?: string;
};
