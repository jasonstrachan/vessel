import type { DisplayFilterConfig } from '@/types';

export interface DisplayFilterPipelineState {
  filterSurfaceCanvas: HTMLCanvasElement | null;
  workCanvasA: HTMLCanvasElement | null;
  workCanvasB: HTMLCanvasElement | null;
  auxCanvas: HTMLCanvasElement | null;
  bloomCanvas: HTMLCanvasElement | null;
  channelCanvas: HTMLCanvasElement | null;
  pixelateCanvas: HTMLCanvasElement | null;
  lcdPatternKey: string;
  lcdPatternCanvas: HTMLCanvasElement | null;
  crtGridPatternKey: string;
  crtGridPatternCanvas: HTMLCanvasElement | null;
  crtGridGlowCanvas: HTMLCanvasElement | null;
  noisePatternKey: string;
  noisePatternCanvas: HTMLCanvasElement | null;
  noiseOverlayKey: string;
  noiseOverlayCanvas: HTMLCanvasElement | null;
  filmGrainPlateKey: string;
  filmGrainDarkPlateCanvas: HTMLCanvasElement | null;
  filmGrainLightPlateCanvas: HTMLCanvasElement | null;
  filmGrainDarkMeanAlpha: number;
  filmGrainLightMeanAlpha: number;
  filmGrainOverlayKey: string;
  filmGrainDarkOverlayCanvas: HTMLCanvasElement | null;
  filmGrainLightOverlayCanvas: HTMLCanvasElement | null;
}

export interface FilmGrainLobe {
  x: number;
  y: number;
  radiusX: number;
  radiusY: number;
  rotation: number;
  strength: number;
  parentIndex: number | null;
}

export interface FilmGrainCluster {
  family: 'single' | 'chain' | 'island';
  polarity: 'dark' | 'light';
  lobes: FilmGrainLobe[];
}

export interface FilmGrainPlateModel {
  version: number;
  plateSize: number;
  grainSize: number;
  clusters: FilmGrainCluster[];
}

export interface FilmGrainFields {
  darkField: Float32Array;
  lightField: Float32Array;
}

export interface FilmGrainRaster {
  darkAlpha: Uint8ClampedArray;
  lightAlpha: Uint8ClampedArray;
  darkMeanAlpha: number;
  lightMeanAlpha: number;
}

export function createDisplayFilterPipelineState(): DisplayFilterPipelineState;
export function getNextFilterWorkCanvas(
  currentCanvas: HTMLCanvasElement,
  workCanvasA: HTMLCanvasElement,
  workCanvasB: HTMLCanvasElement,
): HTMLCanvasElement;
export function ensureDisplayFilterCanvas(
  canvas: HTMLCanvasElement | null,
  width: number,
  height: number,
): HTMLCanvasElement | null;
export function clearDisplayFilterCanvas(
  canvas: HTMLCanvasElement | null,
): CanvasRenderingContext2D | null;
export function getDisplayFilterByIdFromList<I extends DisplayFilterConfig['id']>(
  filters: DisplayFilterConfig[],
  id: I,
): Extract<DisplayFilterConfig, { id: I }> | undefined;
export function hasEnabledDisplayFiltersInList(
  filters: DisplayFilterConfig[],
  mode?: 'any' | 'noise-only' | 'direct-overlay-only',
): boolean;
export function getNoiseOnlyDisplayFilter(
  filters: DisplayFilterConfig[],
): Extract<DisplayFilterConfig, { id: 'noise' }> | null;
export function getDirectOverlayDisplayFilter(
  filters: DisplayFilterConfig[],
): Extract<DisplayFilterConfig, { id: 'noise' | 'film-noise' }> | null;
export function getSeamlessNoisePatternSize(tileStep: number): number;
export function resolveDisplayNoiseTileStep(scale: number): number;
export function resolveFilmNoiseSampleStep(tileStep: number): number;
export function resolveDisplayFilterPixelSize(value: number, fallback?: number, minimum?: number): number;
export function resolveDisplayFilterRadius(value: number, fallback?: number, minimum?: number): number;
export function resolveDownsampledDisplayFilterRadius(
  value: number,
  fallback?: number,
  downsampleFactor?: number,
  minimum?: number,
): number;
export function createTileableNoiseGrid(columns: number, rows: number, seed?: number): number[][];
export function createFilmGrainPlateModel(options?: {
  plateSize?: number;
  grainSize?: number;
  seed?: number;
}): FilmGrainPlateModel;
export function getFilmGrainWrappedLobePositions(
  lobe: FilmGrainLobe,
  plateSize: number,
  extentScale?: number,
): Array<{ x: number; y: number }>;
export function getFilmGrainConnectionFieldStrength(
  startLobe: FilmGrainLobe,
  endLobe: FilmGrainLobe,
  plateSize: number,
): number;
export function buildFilmGrainFields(model: FilmGrainPlateModel): FilmGrainFields;
export function rasterizeFilmGrainFields(args: FilmGrainFields & {
  plateSize: number;
  seed?: number;
  threshold?: number;
  thresholdVariation?: number;
  jitterStrength?: number;
  featherWidth?: number;
  latticeCells?: number;
}): FilmGrainRaster;
export function ensureDisplayNoiseOverlay(args: {
  noiseFilter: Extract<DisplayFilterConfig, { id: 'noise' }>;
  filterState: DisplayFilterPipelineState;
  width: number;
  height: number;
  originX?: number;
  originY?: number;
}): HTMLCanvasElement | null;
export function applyDisplayNoiseOverlay(args: {
  targetCtx: CanvasRenderingContext2D;
  noiseFilter: Extract<DisplayFilterConfig, { id: 'noise' }>;
  filterState: DisplayFilterPipelineState;
  targetRect: { x: number; y: number; width: number; height: number };
  documentOrigin?: { x: number; y: number };
}): boolean;
export function ensureFilmGrainOverlays(args: {
  filmNoiseFilter: Extract<DisplayFilterConfig, { id: 'film-noise' }>;
  filterState: DisplayFilterPipelineState;
  width: number;
  height: number;
  originX?: number;
  originY?: number;
}): { darkCanvas: HTMLCanvasElement; lightCanvas: HTMLCanvasElement } | null;
export function applyFilmGrainOverlay(args: {
  targetCtx: CanvasRenderingContext2D;
  filmNoiseFilter: Extract<DisplayFilterConfig, { id: 'film-noise' }>;
  filterState: DisplayFilterPipelineState;
  targetRect: { x: number; y: number; width: number; height: number };
  documentOrigin?: { x: number; y: number };
}): boolean;
export function applyDisplayFilterStack(args: {
  sourceCanvas: HTMLCanvasElement;
  displayFilters: DisplayFilterConfig[];
  filterState: DisplayFilterPipelineState;
  visibleRect?: { x: number; y: number; width?: number; height?: number } | null;
  lengthScale?: number;
  directOverlayTarget?: {
    ctx: CanvasRenderingContext2D;
    rect: { x: number; y: number; width: number; height: number };
    documentOrigin?: { x: number; y: number };
  };
}): HTMLCanvasElement;
