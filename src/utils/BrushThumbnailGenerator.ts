'use client';

import { BrushPreset } from '@/types/brush';

/**
 * BrushThumbnailGenerator - Generates actual brush stroke previews
 * Creates 20x12px thumbnails showing characteristic brush strokes
 */
export class BrushThumbnailGenerator {
  private static canvas: HTMLCanvasElement | null = null;
  private static ctx: CanvasRenderingContext2D | null = null;
  private static cache = new Map<string, string>();

  private static initCanvas() {
    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.canvas.width = 20;
      this.canvas.height = 12;
      this.ctx = this.canvas.getContext('2d');
    }
  }

  /**
   * Generate thumbnail for a brush preset
   * Returns data URL for use in img src
   */
  static generateThumbnail(brush: BrushPreset): string {
    // Check cache first
    const cacheKey = this.getCacheKey(brush);
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    this.initCanvas();
    if (!this.ctx || !this.canvas) return '';

    // Clear canvas
    this.ctx.clearRect(0, 0, 20, 12);
    
    // Set brush properties
    this.ctx.strokeStyle = '#ffffff';
    this.ctx.lineCap = 'round';
    this.ctx.lineJoin = 'round';
    
    // Generate stroke based on brush type
    this.drawBrushStroke(brush);
    
    // Convert to data URL and cache
    const dataUrl = this.canvas.toDataURL();
    this.cache.set(cacheKey, dataUrl);
    
    return dataUrl;
  }

  private static drawBrushStroke(brush: BrushPreset) {
    if (!this.ctx) return;

    // Determine stroke characteristics from brush name and settings
    const size = this.getBrushSize(brush);
    const opacity = this.getBrushOpacity(brush);
    const isDotted = brush.name.toLowerCase().includes('dotted');
    
    this.ctx.lineWidth = size;
    this.ctx.globalAlpha = opacity;

    if (isDotted) {
      this.drawDottedStroke();
    } else {
      this.drawSmoothStroke();
    }
  }

  private static drawSmoothStroke() {
    if (!this.ctx) return;
    
    // Draw characteristic curved stroke: M2,10 Q6,2 10,6 T18,4
    this.ctx.beginPath();
    this.ctx.moveTo(2, 10);
    this.ctx.quadraticCurveTo(6, 2, 10, 6);
    this.ctx.quadraticCurveTo(14, 10, 18, 4);
    this.ctx.stroke();
  }

  private static drawDottedStroke() {
    if (!this.ctx) return;
    
    // Draw dotted line with varying spacing
    const points = [
      [3, 9], [6, 4], [9, 7], [12, 3], [15, 6], [17, 5]
    ];
    
    points.forEach(([x, y]) => {
      this.ctx!.beginPath();
      this.ctx!.arc(x, y, this.ctx!.lineWidth / 2, 0, Math.PI * 2);
      this.ctx!.fill();
    });
  }

  private static getBrushSize(brush: BrushPreset): number {
    // Extract size info from brush name
    if (brush.name.includes('1px')) return 1;
    if (brush.name.includes('3px')) return 2;
    if (brush.name.includes('5px')) return 3;
    if (brush.name.includes('10px')) return 4;
    
    // Default based on brush type
    if (brush.name.toLowerCase().includes('fine')) return 1;
    if (brush.name.toLowerCase().includes('thick')) return 4;
    
    return 2; // Medium default
  }

  private static getBrushOpacity(brush: BrushPreset): number {
    if (brush.name.toLowerCase().includes('soft')) return 0.7;
    if (brush.name.toLowerCase().includes('light')) return 0.5;
    return 1.0;
  }

  private static getCacheKey(brush: BrushPreset): string {
    // Create cache key from brush characteristics
    return `${brush.id}-${brush.name}-${JSON.stringify(brush.components)}`;
  }

  /**
   * Clear cache - useful when brush settings change
   */
  static clearCache() {
    this.cache.clear();
  }

  /**
   * Preload thumbnails for a list of brushes
   * Useful for performance optimization
   */
  static preloadThumbnails(brushes: BrushPreset[]) {
    brushes.forEach(brush => {
      this.generateThumbnail(brush);
    });
  }
}