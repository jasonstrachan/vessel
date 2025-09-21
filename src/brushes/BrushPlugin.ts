import { BrushSettings } from '../types';

/**
 * Metadata for a brush plugin
 */
export interface BrushMetadata {
  id: string;
  name: string;
  description?: string;
  author?: string;
  version?: string;
  thumbnail?: string;
  category?: string;
  tags?: string[];
}

/**
 * Drawing context passed to brush plugins
 */
export interface BrushDrawContext {
  ctx: CanvasRenderingContext2D;
  x: number;
  y: number;
  pressure: number;
  tilt?: { x: number; y: number };
  rotation?: number;
  settings: BrushSettings;
  lastPoint?: { x: number; y: number; pressure: number } | null;
  deltaTime?: number;
}

/**
 * Configuration options for brush plugins
 */
export interface BrushConfig {
  [key: string]: unknown;
}

/**
 * Core interface for user-created brush plugins
 */
export interface BrushPlugin {
  /**
   * Unique identifier for this brush
   */
  readonly id: string;

  /**
   * Metadata about this brush
   */
  readonly metadata: BrushMetadata;

  /**
   * Initialize the brush with configuration
   */
  initialize?(config?: BrushConfig): Promise<void> | void;

  /**
   * Called when brush is activated
   */
  onActivate?(): void;

  /**
   * Called when brush is deactivated
   */
  onDeactivate?(): void;

  /**
   * Main drawing method - called for each point in a stroke
   * Should be highly optimized for performance
   */
  draw(context: BrushDrawContext): void;

  /**
   * Draw a line between two points (optional optimization)
   * If not implemented, the registry will call draw() multiple times
   */
  drawLine?(
    ctx: CanvasRenderingContext2D,
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    settings: BrushSettings
  ): void;

  /**
   * Get custom UI controls for this brush (optional)
   * Returns React component or null
   */
  getControls?(): React.ComponentType | null;

  /**
   * Validate if brush can work with given settings
   */
  validateSettings?(settings: BrushSettings): boolean;

  /**
   * Clean up resources when brush is unloaded
   */
  cleanup?(): void;

  /**
   * Performance hints for the engine
   */
  performanceHints?: {
    preferredFPS?: number;
    usesGPU?: boolean;
    requiresImageData?: boolean;
    maxStrokePoints?: number;
  };
}

/**
 * Base class for brush plugins (optional - can implement interface directly)
 */
export abstract class BaseBrushPlugin implements BrushPlugin {
  abstract readonly id: string;
  abstract readonly metadata: BrushMetadata;

  abstract draw(context: BrushDrawContext): void;

  initialize?(): Promise<void> | void {
    // Override in subclass if needed
  }

  onActivate?(): void {
    // Override in subclass if needed
  }

  onDeactivate?(): void {
    // Override in subclass if needed
  }

  cleanup?(): void {
    // Override in subclass if needed
  }
}