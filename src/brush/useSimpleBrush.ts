/**
 * Simplified brush hook - replaces complex useBrushEngine
 */

import { useRef, useCallback } from 'react';
import { SimpleBrushEngine, StrokeInputFactory } from './BrushEngine';
import { BrushSettings } from '@/types';

export function useSimpleBrush() {
  const brushEngine = useRef(new SimpleBrushEngine());
  const strokeFactory = useRef(new StrokeInputFactory());

  /**
   * Execute a brush stroke
   */
  const executeBrushStroke = useCallback((
    x: number,
    y: number,
    pressure: number,
    settings: BrushSettings,
    p5Instance: any,
    isNewStroke = false
  ): boolean => {
    try {
      // Reset for new stroke
      if (isNewStroke) {
        brushEngine.current.startNewStroke();
        strokeFactory.current.reset();
      }

      // Create stroke input
      const strokeInput = strokeFactory.current.createStrokeInput(x, y, pressure);
      
      // Execute brush calculation
      const result = brushEngine.current.executeBrushStroke(settings, strokeInput);
      
      // Draw to canvas
      brushEngine.current.drawToCanvas(result, strokeInput, p5Instance, settings.brushShape);
      
      return result.shouldDraw;
    } catch (error) {
      console.error('Brush stroke failed:', error);
      return false;
    }
  }, []);

  /**
   * Start a new stroke
   */
  const startStroke = useCallback(() => {
    brushEngine.current.startNewStroke();
    strokeFactory.current.reset();
  }, []);

  return {
    executeBrushStroke,
    startStroke
  };
}