/**
 * Type definitions for the brush engine
 * Centralized interfaces and types
 */

import type { BrushShape } from '@/types';

/**
 * Pixel queue state for perfect pixel drawing
 */
export interface PixelQueue {
  initialized: boolean;
  lastDrawnX: number;
  lastDrawnY: number;
  waitingPixelX: number;
  waitingPixelY: number;
  spacingCounter: number;
  lastStrokePosition: { x: number; y: number };
  accumulatedDistance: number;
  lastLiftPosition?: { x: number; y: number } | null;
  stampedGridPositions: Set<string>;
  dashPhasePx: number;
  dashVelocityEma: number;
  dashStampCounter: number;
  drawnPixels: Set<string>; // Track drawn pixels for pixel-perfect brushes
  enqueue: (fn: () => void) => void;
  flushNow: () => void;
  onIdle: (cb: () => void) => void;
  addDirtyRect?: (x: number, y: number, width: number, height: number) => void;
}

/**
 * Rectangle gradient state
 */
export interface RectangleState {
  startPos: { x: number; y: number };
  endPos: { x: number; y: number };
  width: number;
  startColor?: string;
  endColor?: string;
  colors?: string[];
  ditherEnabled?: boolean;
  ditherIntensity?: number;
  risographIntensity?: number;
}

/**
 * Stroke input data
 */
export interface StrokeInput {
  position: { x: number; y: number };
  pressure: number;
  velocity: number;
  timestamp: number;
  direction?: number; // Angle in radians from movement vector
}

/**
 * Render settings for brush strokes
 */
export interface RenderSettings {
  size: number;
  opacity: number;
  color: string;
  antiAliasing: boolean;
  pixelAlignment: boolean;
  spacing: number;
  /** Input-space movement sample used for velocity-linked dash behavior. */
  speedSamplePx?: number;
  rotation: number;
  shape: BrushShape;
  risographIntensity: number;
  pattern?: ImageData;
  centerAlignment?: boolean;
  blendMode?: GlobalCompositeOperation;
  isColorizable?: boolean; // For custom brushes
}

/**
 * Brush component configuration
 */
export interface BrushComponent {
  name: string;
  enabled: boolean;
  params: Record<string, unknown>;
}

/**
 * Canvas bounds for clipping
 */
export interface ClipBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Point with optional metadata
 */
export interface Point {
  x: number;
  y: number;
}

/**
 * Extended point with pressure and timestamp
 */
export interface StrokePoint extends Point {
  pressure?: number;
  timestamp?: number;
}

/**
 * Direction smoothing state
 */
export interface DirectionState {
  history: number[];
  lastDirection: number;
}

/**
 * Velocity smoothing state
 */
export interface VelocityState {
  history: number[];
}

/**
 * Dither algorithm types
 */
export type DitherAlgorithm = 
  | 'ordered'
  | 'diffusion'
  | 'noise'
  | 'pattern'
  | 'threshold'
  | 'random';

/**
 * Pattern style for dithering
 */
export type PatternStyle = 
  | 'dots'
  | 'lines'
  | 'cross'
  | 'diagonal'
  | 'horizontal'
  | 'vertical';

/**
 * Brush cache entry
 */
export interface BrushStampCacheEntry {
  canvas: HTMLCanvasElement;
  timestamp: number;
  size: number;
  color: string;
}

/**
 * Gradient direction
 */
export type GradientDirection = 
  | 'horizontal'
  | 'vertical'
  | 'diagonal'
  | 'radial';

/**
 * Shape tool type
 */
export type ShapeToolType = 
  | 'rectangle'
  | 'ellipse'
  | 'polygon'
  | 'star'
  | 'triangle';

/**
 * Custom brush data
 */
export interface CustomBrushData {
  id: string;
  name: string;
  imageData: ImageData;
  width: number;
  height: number;
  spacing?: number;
  scaleWithSize?: boolean;
}

/**
 * Stroke segment for interpolation
 */
export interface StrokeSegment {
  start: StrokePoint;
  end: StrokePoint;
  distance: number;
  direction: number;
}
