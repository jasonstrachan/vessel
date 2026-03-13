import type { RecolorOptions } from '@/lib/colorCycle/RecolorManager';
import type { Layer, Rectangle } from '@/types';

export type NormalizedCropRect = Rectangle;

export interface CroppedAnimatorIndexSnapshot {
  width: number;
  height: number;
  data: ArrayBuffer;
  gradientIdData?: ArrayBuffer;
  speedData?: ArrayBuffer;
  flowData?: ArrayBuffer;
  gradientStops?: Array<{ position: number; color: string }>;
  gradientDefs?: Array<{ id: string; name?: string; currentSlot: number }>;
  slotPalettes?: Array<{ slot: number; stops: Array<{ position: number; color: string }> }>;
  activeGradientId?: string;
  paintSlot?: number;
  legacyRemap?: { from: number; to: number };
}

export interface ColorCycleBrushResetEntry {
  id: string;
  width: number;
  height: number;
  croppedCanvas: HTMLCanvasElement | null;
  imageData: ImageData | null;
  gradientStops?: Array<{ position: number; color: string }>;
  wasAnimating: boolean;
  layerBaseSpeedCps?: number;
  brushSpeed?: number;
  controllerSpeedCps?: number;
  mode?: 'brush' | 'recolor';
  wasActiveLayer: boolean;
  strokeSnapshot?: {
    paintBuffer: ArrayBuffer;
    gradientIdBuffer?: ArrayBuffer;
    gradientDefIdBuffer?: ArrayBuffer;
    speedBuffer?: ArrayBuffer;
    flowBuffer?: ArrayBuffer;
    hasContent: boolean;
    strokeCounter: number;
  };
  animatorIndex?: CroppedAnimatorIndexSnapshot;
}

export interface RecolorRebuildRequest {
  id: string;
  options: Partial<RecolorOptions>;
}

export interface LayerCropReadResult {
  layerId: string;
  updatedLayer: Layer;
  brushReset?: ColorCycleBrushResetEntry;
  recolorRequest?: RecolorRebuildRequest;
}

export interface LayerCropReadContext {
  activeLayerId: string | null;
}
