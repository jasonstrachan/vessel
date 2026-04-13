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
export function hasEnabledDisplayFiltersInList(filters: DisplayFilterConfig[]): boolean;
export function getSeamlessNoisePatternSize(tileStep: number): number;
export function applyDisplayFilterStack(args: {
  sourceCanvas: HTMLCanvasElement;
  displayFilters: DisplayFilterConfig[];
  filterState: DisplayFilterPipelineState;
  visibleRect?: { x: number; y: number; width?: number; height?: number } | null;
  lengthScale?: number;
}): HTMLCanvasElement;
