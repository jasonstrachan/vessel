/**
 * Grid snapping utilities for brush positioning
 * Forces brush to adhere to a grid where the grid size equals the brush size
 */

import { BrushSettings, BrushShape, CustomBrush } from '../types';

// Cache for grid dimensions to avoid recalculation during strokes
interface GridDimensionsCache {
  [key: string]: {
    dimensions: { width: number; height: number };
    timestamp: number;
  };
}

class GridSnapCache {
  private gridDimensionsCache: GridDimensionsCache = {};
  private readonly maxAge = 30000; // 30 seconds - grid dimensions rarely change
  private readonly maxEntries = 50;

  private getGridCacheKey(
    brushShape: BrushShape,
    customBrushId: string | undefined,
    brushSize: number,
    customBrushWidth?: number,
    customBrushHeight?: number
  ): string {
    const parts = [
      brushShape,
      customBrushId || 'none',
      Math.round(brushSize).toString(),
      customBrushWidth?.toString() || '0',
      customBrushHeight?.toString() || '0'
    ];
    return parts.join('_');
  }

  getCachedGridDimensions(
    brushSettings: BrushSettings,
    customBrush: CustomBrush | undefined,
    actualSize: number
  ): { width: number; height: number } | null {
    const key = this.getGridCacheKey(
      brushSettings.brushShape || BrushShape.ROUND,
      customBrush?.id,
      actualSize,
      customBrush?.width,
      customBrush?.height
    );

    const cached = this.gridDimensionsCache[key];
    if (cached && Date.now() - cached.timestamp < this.maxAge) {
      return cached.dimensions;
    }

    if (cached) {
      delete this.gridDimensionsCache[key];
    }

    return null;
  }

  setCachedGridDimensions(
    brushSettings: BrushSettings,
    customBrush: CustomBrush | undefined,
    actualSize: number,
    dimensions: { width: number; height: number }
  ): void {
    // Clean cache if full
    if (Object.keys(this.gridDimensionsCache).length >= this.maxEntries) {
      this.cleanupGridCache();
    }

    const key = this.getGridCacheKey(
      brushSettings.brushShape || BrushShape.ROUND,
      customBrush?.id,
      actualSize,
      customBrush?.width,
      customBrush?.height
    );

    this.gridDimensionsCache[key] = {
      dimensions,
      timestamp: Date.now()
    };
  }

  private cleanupGridCache(): void {
    const now = Date.now();
    const entries = Object.entries(this.gridDimensionsCache);
    
    // Remove expired entries
    for (const [key, cached] of entries) {
      if (now - cached.timestamp > this.maxAge) {
        delete this.gridDimensionsCache[key];
      }
    }

    // If still too many, remove oldest
    const remaining = Object.entries(this.gridDimensionsCache);
    if (remaining.length >= this.maxEntries) {
      const sorted = remaining.sort((a, b) => a[1].timestamp - b[1].timestamp);
      const toRemove = sorted.slice(0, remaining.length - this.maxEntries + 10);
      
      for (const [key] of toRemove) {
        delete this.gridDimensionsCache[key];
      }
    }
  }

  clear(): void {
    this.gridDimensionsCache = {};
  }
}

const gridSnapCache = new GridSnapCache();

export interface SnappedPosition {
  x: number;
  y: number;
  gridSize: number;
  gridWidth?: number;
  gridHeight?: number;
}

// Quantized pressure levels for performance and consistent grid sizing
const PRESSURE_LEVELS = 8;

/**
 * Quantize pressure to discrete levels for consistent grid sizing
 * Currently unused but kept for potential future optimizations
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function quantizePressure(pressure: number): number {
  if (!isFinite(pressure) || pressure < 0) return 0;
  if (pressure > 1) return 1;
  
  const level = Math.floor(pressure * PRESSURE_LEVELS);
  return Math.min(level, PRESSURE_LEVELS - 1) / (PRESSURE_LEVELS - 1);
}

/**
 * Calculate grid size based on brush settings - grid size = base brush size (ignores pressure)
 * This ensures consistent grid spacing regardless of pressure changes
 */
export function calculateGridSize(brushSettings: BrushSettings, customBrush?: CustomBrush): number {
  let finalSize: number;
  
  if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush && customBrush) {
    if (typeof brushSettings.size === 'number' && Number.isFinite(brushSettings.size)) {
      finalSize = brushSettings.size;
    } else {
      const baseDimension = Math.max(customBrush.width, customBrush.height);
      const percent = brushSettings.customBrushSizePercent ?? 100;
      finalSize = (percent / 100) * baseDimension;
    }
  } else {
    // For regular brushes, size is in pixels
    finalSize = typeof brushSettings.size === 'number' ? brushSettings.size : 1;
  }
  
  // Grid size is always based on base brush size, not pressure-modified size
  // This prevents multiple stamps within a single grid block when pressure changes
  return Math.max(1, Math.round(finalSize));
}

/**
 * Calculate grid dimensions for custom brushes that may have different width/height
 * Returns { width, height } for rectangular grids
 */
export function calculateGridDimensions(brushSettings: BrushSettings, customBrush?: CustomBrush, actualSize?: number): { width: number; height: number } {
  const baseSize = typeof brushSettings.size === 'number' ? brushSettings.size : undefined;
  const estimatedSizeForCustom = (() => {
    if (!customBrush || brushSettings.brushShape !== BrushShape.CUSTOM) {
      return undefined;
    }
    const maxDimension = Math.max(customBrush.width, customBrush.height);
    return Math.max(1, Math.round(((brushSettings.customBrushSizePercent ?? 100) / 100) * maxDimension));
  })();

  const effectiveActualSize = actualSize ?? baseSize ?? estimatedSizeForCustom ?? 1;
  
  // Check cache first
  const cached = gridSnapCache.getCachedGridDimensions(brushSettings, customBrush, effectiveActualSize);
  if (cached) {
    return cached;
  }

  let dimensions: { width: number; height: number };

  if (brushSettings.brushShape === BrushShape.CUSTOM && brushSettings.selectedCustomBrush && customBrush) {
    // For custom brushes, use exact brush dimensions for perfect tiling
    // Scale factor should match the brush engine's calculation: actualSize divided by max dimension
    const customBrushMaxDimension = Math.max(customBrush.width, customBrush.height);
    const sizeForScale = effectiveActualSize || 1;
    const scaleFactor = sizeForScale / customBrushMaxDimension;
    const gridWidth = customBrush.width * scaleFactor;
    const gridHeight = customBrush.height * scaleFactor;
    
    dimensions = { width: gridWidth, height: gridHeight };
  } else {
    // For regular brushes, use square grid
    const size = Math.max(1, Math.round(effectiveActualSize));
    dimensions = { width: size, height: size };
  }

  // Cache the result
  gridSnapCache.setCachedGridDimensions(brushSettings, customBrush, effectiveActualSize, dimensions);
  
  return dimensions;
}

/**
 * Snap a position to the nearest grid point
 */
export function snapToGrid(x: number, y: number, gridSize: number): SnappedPosition {
  const snappedX = Math.round(x / gridSize) * gridSize;
  const snappedY = Math.round(y / gridSize) * gridSize;
  
  return {
    x: snappedX,
    y: snappedY,
    gridSize
  };
}

/**
 * Snap a position to the nearest grid point with rectangular dimensions
 */
export function snapToRectangularGrid(x: number, y: number, gridWidth: number, gridHeight: number): SnappedPosition {
  const snappedX = Math.round(x / gridWidth) * gridWidth;
  const snappedY = Math.round(y / gridHeight) * gridHeight;
  
  return {
    x: snappedX,
    y: snappedY,
    gridSize: Math.max(gridWidth, gridHeight), // Keep gridSize for backward compatibility
    gridWidth,
    gridHeight
  };
}

/**
 * Check if grid snapping is enabled and should be applied
 */
export function shouldApplyGridSnap(brushSettings: BrushSettings): boolean {
  return brushSettings.gridSnapEnabled === true;
}

/**
 * Generate all grid positions between two points to prevent gaps (rectangular grid)
 */
export function getRectangularGridPositionsBetween(
  fromX: number, 
  fromY: number, 
  toX: number, 
  toY: number, 
  gridWidth: number,
  gridHeight: number
): SnappedPosition[] {
  const positions: SnappedPosition[] = [];
  
  // Snap both points to grid
  const startSnapped = snapToRectangularGrid(fromX, fromY, gridWidth, gridHeight);
  const endSnapped = snapToRectangularGrid(toX, toY, gridWidth, gridHeight);
  
  // If they're the same grid position, return just the end position
  if (startSnapped.x === endSnapped.x && startSnapped.y === endSnapped.y) {
    return [endSnapped];
  }
  
  // Calculate grid steps between positions
  const deltaX = endSnapped.x - startSnapped.x;
  const deltaY = endSnapped.y - startSnapped.y;
  const stepsX = Math.abs(deltaX / gridWidth);
  const stepsY = Math.abs(deltaY / gridHeight);
  const maxSteps = Math.max(stepsX, stepsY);
  
  // Generate all grid positions along the path
  for (let i = 0; i <= maxSteps; i++) {
    const t = maxSteps === 0 ? 1 : i / maxSteps;
    const x = startSnapped.x + (deltaX * t);
    const y = startSnapped.y + (deltaY * t);
    
    positions.push({
      x: Math.round(x),
      y: Math.round(y),
      gridSize: Math.max(gridWidth, gridHeight),
      gridWidth,
      gridHeight
    });
  }
  
  // Remove duplicates
  const uniquePositions: SnappedPosition[] = [];
  const seen = new Set<string>();
  
  for (const pos of positions) {
    const key = `${pos.x},${pos.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePositions.push(pos);
    }
  }
  
  return uniquePositions;
}

/**
 * Generate all grid positions between two points to prevent gaps
 */
export function getGridPositionsBetween(
  fromX: number, 
  fromY: number, 
  toX: number, 
  toY: number, 
  gridSize: number
): SnappedPosition[] {
  const positions: SnappedPosition[] = [];
  
  // Snap both points to grid
  const startSnapped = snapToGrid(fromX, fromY, gridSize);
  const endSnapped = snapToGrid(toX, toY, gridSize);
  
  // If they're the same grid position, return just the end position
  if (startSnapped.x === endSnapped.x && startSnapped.y === endSnapped.y) {
    return [endSnapped];
  }
  
  // Calculate grid steps between positions
  const deltaX = endSnapped.x - startSnapped.x;
  const deltaY = endSnapped.y - startSnapped.y;
  const stepsX = Math.abs(deltaX / gridSize);
  const stepsY = Math.abs(deltaY / gridSize);
  const maxSteps = Math.max(stepsX, stepsY);
  
  // Generate all grid positions along the path
  for (let i = 0; i <= maxSteps; i++) {
    const t = maxSteps === 0 ? 1 : i / maxSteps;
    const x = startSnapped.x + (deltaX * t);
    const y = startSnapped.y + (deltaY * t);
    
    positions.push({
      x: Math.round(x),
      y: Math.round(y),
      gridSize
    });
  }
  
  // Remove duplicates
  const uniquePositions: SnappedPosition[] = [];
  const seen = new Set<string>();
  
  for (const pos of positions) {
    const key = `${pos.x},${pos.y}`;
    if (!seen.has(key)) {
      seen.add(key);
      uniquePositions.push(pos);
    }
  }
  
  return uniquePositions;
}
