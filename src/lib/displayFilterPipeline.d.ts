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
  filmNoisePatternKey: string;
  filmNoiseBaseCanvas: HTMLCanvasElement | null;
  filmNoiseClumpCanvas: HTMLCanvasElement | null;
  filmNoiseBasePatternData: Uint8ClampedArray | null;
  filmNoiseClumpPatternData: Uint8ClampedArray | null;
  filmNoiseCombinedKey: string;
  filmNoiseCombinedField: Float32Array | null;
  filmNoiseImageData: ImageData | null;
  filmNoiseToneKey: string;
  filmNoiseToneLookup: Float32Array | null;
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
  mode?: 'any' | 'noise-only',
): boolean;
export function getNoiseOnlyDisplayFilter(
  filters: DisplayFilterConfig[],
): Extract<DisplayFilterConfig, { id: 'noise' }> | null;
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
export function applyDisplayFilterStack(args: {
  sourceCanvas: HTMLCanvasElement;
  displayFilters: DisplayFilterConfig[];
  filterState: DisplayFilterPipelineState;
  visibleRect?: { x: number; y: number; width?: number; height?: number } | null;
  lengthScale?: number;
  noiseOnlyTarget?: {
    ctx: CanvasRenderingContext2D;
    rect: { x: number; y: number; width: number; height: number };
    documentOrigin?: { x: number; y: number };
  };
}): HTMLCanvasElement;
