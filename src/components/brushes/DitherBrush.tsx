/**
 * Pressure-Sensitive Dithering Brush Component
 * Integrates with Vessel engine for real-time dithered drawing
 */

import React from 'react';
import { BrushSettings } from '../../types';
import { 
  applyPressureDither, 
  applyPressureDitherChunked,
  DitherSettings, 
  DitherAlgorithm, 
  BayerMatrixSize,
  PatternStyle,
  APPLE_II_PALETTE,
  createGrayscalePalette,
  calculatePressureDitherThreshold
} from '../../utils/ditherAlgorithms';

export interface DitherBrushSettings extends BrushSettings {
  ditherAlgorithm: DitherAlgorithm;
  ditherIntensity: number; // 0-100
  pressureSensitiveDither: boolean;
  ditherPalette: 'apple-ii' | 'grayscale-2' | 'grayscale-4' | 'grayscale-8' | 'custom';
  bayerMatrixSize: BayerMatrixSize;
  patternStyle: PatternStyle;
  realtimeProcessing: boolean; // true = chunked processing for large strokes
}

export const DEFAULT_DITHER_SETTINGS: DitherBrushSettings = {
  // Base brush settings
  size: 20,
  opacity: 100,
  color: '#000000',
  blendMode: 'source-over',
  spacing: 1,
  pressure: 50,
  rotation: 0,
  antialiasing: false,
  pressureEnabled: false,
  minPressure: 90,
  maxPressure: 0,
  rotationEnabled: false,
  dashedEnabled: false,
  dashLength: 5,
  useSwatchColor: true,
  dashGap: 3,
  gridSnapEnabled: false,
  shapeEnabled: false,
  colorJitter: 0,
  risographIntensity: 0,
  risographOutline: false,
  ditherEnabled: true,
  
  // Dithering-specific settings
  ditherAlgorithm: 'bayer',
  ditherIntensity: 75,
  pressureSensitiveDither: true,
  ditherPalette: 'apple-ii',
  bayerMatrixSize: 8,
  patternStyle: 'dots',
  realtimeProcessing: true
};

/**
 * Get palette based on dither palette setting
 */
export const getDitherPalette = (paletteType: DitherBrushSettings['ditherPalette']): [number, number, number][] => {
  switch (paletteType) {
    case 'apple-ii':
      return APPLE_II_PALETTE;
    case 'grayscale-2':
      return createGrayscalePalette(2);
    case 'grayscale-4':
      return createGrayscalePalette(4);
    case 'grayscale-8':
      return createGrayscalePalette(8);
    case 'custom':
      // Could be extended to support custom palettes
      return APPLE_II_PALETTE;
    default:
      return APPLE_II_PALETTE;
  }
};

/**
 * Apply dithering to a canvas region based on brush stroke
 */
export const applyDitherBrushStroke = (
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  brushSettings: DitherBrushSettings,
  pressure: number = 0.5
): void => {
  const brushSize = Math.max(1, brushSettings.size * (brushSettings.pressureEnabled ? pressure : 1));
  const halfSize = Math.floor(brushSize / 2);
  
  // Get the region to dither
  const regionX = Math.max(0, x - halfSize);
  const regionY = Math.max(0, y - halfSize);
  const regionWidth = Math.min(brushSize, ctx.canvas.width - regionX);
  const regionHeight = Math.min(brushSize, ctx.canvas.height - regionY);
  
  if (regionWidth <= 0 || regionHeight <= 0) return;
  
  try {
    // Get image data for the region
    const imageData = ctx.getImageData(regionX, regionY, regionWidth, regionHeight);
    
    // Set up dithering parameters
    const ditherSettings: DitherSettings = {
      algorithm: brushSettings.ditherAlgorithm,
      pressure: brushSettings.pressureSensitiveDither ? pressure : 0.5,
      intensity: brushSettings.ditherIntensity / 100,
      bayerMatrixSize: brushSettings.bayerMatrixSize,
      patternStyle: brushSettings.patternStyle,
      palette: getDitherPalette(brushSettings.ditherPalette)
    };
    
    // Apply dithering
    if (brushSettings.realtimeProcessing && regionWidth * regionHeight > 4096) {
      // Use chunked processing for large areas
      applyPressureDitherChunked(imageData, ditherSettings, 32).then(ditheredData => {
        ctx.putImageData(ditheredData, regionX, regionY);
      });
    } else {
      // Immediate processing for small areas
      const ditheredData = applyPressureDither(imageData, ditherSettings);
      ctx.putImageData(ditheredData, regionX, regionY);
    }
  } catch (error) {
    console.warn('Dither brush stroke failed:', error);
  }
};

/**
 * Create a circular dither brush stamp
 */
export const createDitherBrushStamp = (
  size: number,
  ditherSettings: DitherSettings,
  color: string = '#000000'
): HTMLCanvasElement => {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  
  if (!ctx) return canvas;
  
  const radius = size / 2;
  const centerX = radius;
  const centerY = radius;
  
  // Create a gradient from center color to transparent
  const gradient = ctx.createRadialGradient(centerX, centerY, 0, centerX, centerY, radius);
  gradient.addColorStop(0, color);
  gradient.addColorStop(0.8, color);
  gradient.addColorStop(1, 'rgba(0,0,0,0)');
  
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(centerX, centerY, radius, 0, Math.PI * 2);
  ctx.fill();
  
  // Apply dithering to the stamp
  const imageData = ctx.getImageData(0, 0, size, size);
  const ditheredData = applyPressureDither(imageData, ditherSettings);
  ctx.putImageData(ditheredData, 0, 0);
  
  return canvas;
};

/**
 * DitherBrush Component - UI controls for dithering brush
 */
interface DitherBrushControlsProps {
  settings: DitherBrushSettings;
  onChange: (newSettings: Partial<DitherBrushSettings>) => void;
}

export const DitherBrushControls: React.FC<DitherBrushControlsProps> = ({
  settings,
  onChange
}) => {
  return (
    <div className="dither-brush-controls space-y-3">
      <div className="text-xs font-medium text-gray-300 mb-2">Dither Settings</div>
      
      {/* Algorithm Selection */}
      <div className="space-y-1">
        <label className="text-xs text-gray-400">Algorithm</label>
        <select
          value={settings.ditherAlgorithm}
          onChange={(e) => onChange({ ditherAlgorithm: e.target.value as DitherAlgorithm })}
          className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white"
        >
          <option value="bayer">Bayer Matrix</option>
          <option value="floyd-steinberg">Floyd-Steinberg</option>
          <option value="sierra-lite">Sierra Lite</option>
          <option value="atkinson">Atkinson</option>
          <option value="blue-noise">Blue Noise</option>
          <option value="pattern">Pattern</option>
        </select>
      </div>
      
      {/* Intensity Slider */}
      <div className="space-y-1">
        <label className="text-xs text-gray-400">
          Intensity: {settings.ditherIntensity}%
        </label>
        <input
          type="range"
          min="0"
          max="100"
          value={settings.ditherIntensity}
          onChange={(e) => onChange({ ditherIntensity: parseInt(e.target.value) })}
          className="slider w-full"
          style={{
            '--slider-track-gradient': 'linear-gradient(to right, rgba(217,217,217,0.15), rgba(217,217,217,0.55))',
            '--ascii-thumb-size': '14px',
            '--slider-progress': `${settings.ditherIntensity}%`
          } as React.CSSProperties & { '--slider-progress': string }}
        />
      </div>
      
      {/* Pressure Sensitivity Toggle */}
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id="pressure-sensitive-dither"
          checked={settings.pressureSensitiveDither}
          onChange={(e) => onChange({ pressureSensitiveDither: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="pressure-sensitive-dither" className="text-xs text-gray-400">
          Pressure Sensitive
        </label>
      </div>
      
      {/* Palette Selection */}
      <div className="space-y-1">
        <label className="text-xs text-gray-400">Palette</label>
        <select
          value={settings.ditherPalette}
          onChange={(e) => onChange({ ditherPalette: e.target.value as DitherBrushSettings['ditherPalette'] })}
          className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white"
        >
          <option value="apple-ii">Apple II (16 colors)</option>
          <option value="grayscale-2">B&W (2 colors)</option>
          <option value="grayscale-4">Grayscale (4 levels)</option>
          <option value="grayscale-8">Grayscale (8 levels)</option>
        </select>
      </div>
      
      {/* Bayer Matrix Size (only for Bayer algorithm) */}
      {settings.ditherAlgorithm === 'bayer' && (
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Matrix Size</label>
          <select
            value={settings.bayerMatrixSize}
            onChange={(e) => onChange({ bayerMatrixSize: parseInt(e.target.value) as BayerMatrixSize })}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white"
          >
            <option value={2}>2×2 (Subtle)</option>
            <option value={4}>4×4 (Medium)</option>
            <option value={8}>8×8 (Detailed)</option>
          </select>
        </div>
      )}
      
      {/* Pattern Style (only for Pattern algorithm) */}
      {settings.ditherAlgorithm === 'pattern' && (
        <div className="space-y-1">
          <label className="text-xs text-gray-400">Pattern Style</label>
          <select
            value={settings.patternStyle}
            onChange={(e) => onChange({ patternStyle: e.target.value as PatternStyle })}
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-xs text-white"
          >
            <option value="dots">Dots</option>
            <option value="lines">Diagonal Lines</option>
            <option value="vertical-lines">Vertical Lines</option>
            <option value="horizontal-lines">Horizontal Lines</option>
            <option value="crosshatch">Crosshatch</option>
            <option value="diagonal">Diamond</option>
          </select>
        </div>
      )}
      
      {/* Performance Toggle */}
      <div className="flex items-center space-x-2">
        <input
          type="checkbox"
          id="realtime-processing"
          checked={settings.realtimeProcessing}
          onChange={(e) => onChange({ realtimeProcessing: e.target.checked })}
          className="rounded"
        />
        <label htmlFor="realtime-processing" className="text-xs text-gray-400">
          Smooth Processing
        </label>
      </div>
      
      {/* Pressure Visualization */}
      {settings.pressureSensitiveDither && (
        <div className="space-y-1">
          <div className="text-xs text-gray-400">Pressure Effect Preview</div>
          <div className="h-4 bg-gray-800 rounded overflow-hidden">
            <div 
              className="h-full bg-gradient-to-r from-blue-600 to-blue-300 transition-all duration-200"
              style={{ 
                width: `${calculatePressureDitherThreshold(settings.pressure / 100, settings.ditherIntensity / 100) * 100}%` 
              }}
            />
          </div>
          <div className="text-xs text-gray-500">Light pressure = more dither</div>
        </div>
      )}
    </div>
  );
};

export default DitherBrushControls;
