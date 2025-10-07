/**
 * ExtractColorsDialog - Modal for extracting colors from layers to build gradients
 * Enhanced with OKLab color analysis for perceptually accurate extraction
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import { Layer } from '../../../types';
import { RecolorManager } from '../../../lib/colorCycle/RecolorManager';
import { OKLabConverter, ColorAnalysis, OKLabColor, RGBColor } from '../../../lib/colorCycle/colorSpace/OKLabConverter';

export interface ExtractColorsDialogProps {
  layer: Layer;
  isOpen: boolean;
  onClose: (gradient?: Array<{ position: number; color: string }>) => void;
  recolorManager: RecolorManager;
}

export interface ExtractOptions {
  method: 'fast' | 'quality' | 'oklab';
  gradientStops: number;
  buildMode: 'dominant' | 'full-range' | 'perceptual';
  sortBy: 'hue' | 'luminance' | 'saturation' | 'perceptual';
  colorSpace: 'rgb' | 'oklab';
  minColorDifference: number;
  preserveOriginalColors: boolean;
}

type OKLabSortMode = Parameters<typeof OKLabConverter.sortColors>[1];

const mapSortMode = (mode: ExtractOptions['sortBy']): OKLabSortMode => {
  switch (mode) {
    case 'luminance':
      return 'lightness';
    case 'saturation':
      return 'chroma';
    case 'hue':
      return 'hue';
    case 'perceptual':
    default:
      return 'perceptual';
  }
};

export const ExtractColorsDialog: React.FC<ExtractColorsDialogProps> = ({
  layer,
  isOpen,
  onClose,
  recolorManager
}) => {
  const [options, setOptions] = useState<ExtractOptions>({
    method: 'quality',
    gradientStops: 8,
    buildMode: 'perceptual',
    sortBy: 'perceptual',
    colorSpace: 'oklab',
    minColorDifference: 0.05,
    preserveOriginalColors: true
  });
  const [isExtracting, setIsExtracting] = useState(false);
  const [previewGradient, setPreviewGradient] = useState<Array<{ position: number; color: string }> | null>(null);
  const [colorAnalysis, setColorAnalysis] = useState<ColorAnalysis | null>(null);
  const [processingStats, setProcessingStats] = useState<{
    originalColors: number;
    extractedColors: number;
    compressionRatio: number;
    processingTime: number;
  } | null>(null);

  // Generate preview CSS
  const previewCSS = useMemo(() => {
    if (!previewGradient || previewGradient.length === 0) {
      return 'linear-gradient(to right, #000, #fff)';
    }
    return `linear-gradient(to right, ${previewGradient.map(stop => `${stop.color} ${stop.position * 100}%`).join(', ')})`;
  }, [previewGradient]);

  // Update options with intelligent defaults
  const updateOptions = useCallback(<K extends keyof ExtractOptions>(
    key: K, 
    value: ExtractOptions[K]
  ) => {
    setOptions(prev => {
      const newOptions = { ...prev, [key]: value };
      
      // Auto-adjust related settings
      if (key === 'method') {
        if (value === 'oklab') {
          newOptions.colorSpace = 'oklab';
          newOptions.buildMode = 'perceptual';
          newOptions.sortBy = 'perceptual';
        } else if (value === 'fast') {
          newOptions.colorSpace = 'rgb';
          newOptions.buildMode = 'dominant';
        }
      }
      
      if (key === 'colorSpace' && value === 'oklab') {
        newOptions.sortBy = 'perceptual';
      }
      
      return newOptions;
    });
  }, []);
  
  // Auto-analyze on mount
  useEffect(() => {
    if (layer.imageData && options.colorSpace === 'oklab') {
      const analysis = OKLabConverter.analyzeImageColors(layer.imageData, 500);
      setColorAnalysis(analysis);
    }
  }, [layer.imageData, options.colorSpace]);

  // Helper to build gradient from RGB colors
  const buildGradientFromColors = useCallback((colors: RGBColor[]): Array<{ position: number; color: string }> => {
    return colors.map((color, index) => ({
      position: index / (colors.length - 1),
      color: `rgb(${color.r}, ${color.g}, ${color.b})`
    }));
  }, []);
  
  // Count unique colors in image
  const countUniqueColors = useCallback((imageData: ImageData): number => {
    const { data } = imageData;
    const colors = new Set<string>();
    
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      
      if (a >= 128) {
        colors.add(`${r},${g},${b}`);
      }
    }
    
    return colors.size;
  }, []);

  // Helper method to extract full range colors
  const extractFullRangeColors = useCallback(async (imageData: ImageData, count: number): Promise<OKLabColor[]> => {
    const { data, width, height } = imageData;
    const colors: RGBColor[] = [];
    
    // Sample pixels uniformly across the image
    const stepX = Math.max(1, Math.floor(width / Math.sqrt(count * 2)));
    const stepY = Math.max(1, Math.floor(height / Math.sqrt(count * 2)));
    
    for (let y = 0; y < height; y += stepY) {
      for (let x = 0; x < width; x += stepX) {
        const idx = (y * width + x) * 4;
        const r = data[idx];
        const g = data[idx + 1];
        const b = data[idx + 2];
        const a = data[idx + 3];
        
        if (a >= 128) {
          colors.push({ r, g, b });
        }
      }
    }
    
    // Convert to OKLab and filter by minimum difference
    const oklabColors = OKLabConverter.batchRGBToOKLab(colors);
    const filtered: OKLabColor[] = [];
    
    for (const color of oklabColors) {
      const isDifferent = filtered.every(existing => 
        OKLabConverter.deltaE(color, existing) > options.minColorDifference
      );
      
      if (isDifferent) {
        filtered.push(color);
        if (filtered.length >= count) break;
      }
    }
    
    return filtered;
  }, [options.minColorDifference]);

  // Enhanced color extraction with OKLab analysis
  const handleExtract = useCallback(async () => {
    setIsExtracting(true);
    const startTime = performance.now();
    
    try {
      if (!layer.imageData) {
        throw new Error('No image data available');
      }
      
      // Analyze colors using OKLab if selected
      let extractedCount = 0;

      if (options.colorSpace === 'oklab' || options.method === 'oklab') {
        const analysis = OKLabConverter.analyzeImageColors(layer.imageData, 2000);
        setColorAnalysis(analysis);

        // Extract dominant colors
        let colors = analysis.dominantColors;
        
        if (options.buildMode === 'perceptual') {
          // Generate perceptually uniform palette
          colors = OKLabConverter.generatePalette(colors, options.gradientStops, {
            brightnessRange: [0.15, 0.85],
            chromaRange: [0.02, 0.25],
            preserveHue: false
          });
        } else if (options.buildMode === 'full-range') {
          // Sample across full color range
          colors = await extractFullRangeColors(layer.imageData, options.gradientStops);
        }
        
        // Sort colors perceptually
        const sortMode = mapSortMode(options.sortBy);
        colors = OKLabConverter.sortColors(colors, sortMode);
        
        // Convert to gradient format
        const rgbColors = OKLabConverter.batchOKLabToRGB(colors);
        const gradient = buildGradientFromColors(rgbColors);
        setPreviewGradient(gradient);
        extractedCount = gradient.length;
      } else {
        // Use existing RGB-based extraction
        const gradient = await recolorManager.extractColors(layer, options);
        setPreviewGradient(gradient);
        extractedCount = gradient?.length ?? 0;
      }

      // Calculate processing statistics
      const processingTime = performance.now() - startTime;
      const originalColors = countUniqueColors(layer.imageData!);

      setProcessingStats({
        originalColors,
        extractedColors: extractedCount,
        compressionRatio: originalColors / Math.max(extractedCount, 1),
        processingTime
      });

    } catch (error) {
      console.error('Failed to extract colors:', error);
    } finally {
      setIsExtracting(false);
    }
  }, [layer, options, recolorManager, extractFullRangeColors, buildGradientFromColors, countUniqueColors]);

  // Apply gradient
  const handleApply = useCallback(() => {
    onClose(previewGradient || undefined);
  }, [onClose, previewGradient]);

  // Cancel dialog
  const handleCancel = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!isOpen) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
      <div className="bg-gray-800 rounded-lg border border-gray-600 w-96 max-w-full mx-4">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-600">
          <h3 className="text-lg font-semibold text-white">Extract Colors</h3>
          <button
            onClick={handleCancel}
            className="text-gray-400 hover:text-white text-xl"
            aria-label="Close dialog"
          >
            ×
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {/* Layer Info with Analysis */}
          <div className="p-3 bg-gray-700 rounded-lg">
            <div className="flex justify-between items-start">
              <div>
                <div className="text-sm text-gray-300">
                  <strong>{layer.name}</strong>
                </div>
                <div className="text-xs text-gray-400">
                  {layer.imageData?.width}×{layer.imageData?.height} pixels
                </div>
              </div>
              {colorAnalysis && (
                <div className="text-xs text-right">
                  <div className={`font-medium ${
                    colorAnalysis.temperature === 'warm' ? 'text-orange-400' :
                    colorAnalysis.temperature === 'cool' ? 'text-blue-400' : 'text-gray-400'
                  }`}>
                    {colorAnalysis.temperature} tone
                  </div>
                  <div className="text-gray-400">
                    {Math.round(colorAnalysis.brightness * 100)}% bright
                  </div>
                </div>
              )}
            </div>
            {colorAnalysis && (
              <div className="mt-2 pt-2 border-t border-gray-600">
                <div className="flex justify-between text-xs text-gray-400">
                  <span>Contrast: {Math.round(colorAnalysis.contrast * 100)}%</span>
                  <span>Colorfulness: {Math.round(colorAnalysis.colorfulness * 100)}%</span>
                </div>
              </div>
            )}
          </div>

          {/* Extraction Method */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Extraction Method
            </label>
            <div className="grid grid-cols-3 gap-2">
              {([
                { value: 'fast', label: 'Fast', desc: 'Quick RGB sampling' },
                { value: 'quality', label: 'Quality', desc: 'Advanced clustering' },
                { value: 'oklab', label: 'OKLab', desc: 'Perceptual uniform' }
              ] as Array<{ value: ExtractOptions['method']; label: string; desc: string }>).map(({ value, label, desc }) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => updateOptions('method', value)}
                  className={`
                    p-2 text-left rounded-lg border transition-colors
                    ${options.method === value
                      ? 'bg-blue-600 border-blue-500 text-white'
                      : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                    }
                  `}
                >
                  <div className="font-medium text-xs">{label}</div>
                  <div className="text-xs opacity-75">{desc}</div>
                </button>
              ))}
            </div>
          </div>

          {/* Color Space Selection */}
          {(options.method === 'quality' || options.method === 'oklab') && (
            <div>
              <label className="block text-sm font-medium text-gray-300 mb-2">
                Color Space
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: 'rgb', label: 'RGB', desc: 'Standard RGB' },
                  { value: 'oklab', label: 'OKLab', desc: 'Perceptual uniform' }
                ].map(({ value, label, desc }) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => updateOptions('colorSpace', value as 'rgb' | 'oklab')}
                    className={`
                      p-2 text-left rounded-lg border transition-colors
                      ${options.colorSpace === value
                        ? 'bg-green-600 border-green-500 text-white'
                        : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                      }
                    `}
                  >
                    <div className="font-medium text-xs">{label}</div>
                    <div className="text-xs opacity-75">{desc}</div>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Gradient Stops */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Gradient Stops: {options.gradientStops}
            </label>
            <input
              type="range"
              min="4"
              max="32"
              value={options.gradientStops}
              onChange={(e) => updateOptions('gradientStops', parseInt(e.target.value))}
              className="slider w-full"
              style={{
                '--slider-track-gradient': 'linear-gradient(to right, rgba(217,217,217,0.12), rgba(217,217,217,0.6))',
                '--ascii-thumb-size': '14px',
                '--slider-progress': `${((options.gradientStops - 4) / 28) * 100}%`
              } as React.CSSProperties & { '--slider-progress': string }}
            />
            <div className="flex justify-between text-xs text-gray-500 mt-1">
              <span>4 (Simple)</span>
              <span>32 (Complex)</span>
            </div>
          </div>

          {/* Build Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Extraction Strategy
            </label>
            <select
              value={options.buildMode}
              onChange={(e) => updateOptions('buildMode', e.target.value as ExtractOptions['buildMode'])}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
            >
              <option value="dominant">Dominant Colors</option>
              <option value="full-range">Full Color Range</option>
              <option value="perceptual">Perceptual Palette</option>
            </select>
            <div className="text-xs text-gray-500 mt-1">
              {options.buildMode === 'dominant' && 'Extract most frequently used colors'}
              {options.buildMode === 'full-range' && 'Sample across full color spectrum'}
              {options.buildMode === 'perceptual' && 'Generate perceptually uniform palette'}
            </div>
          </div>

          {/* Sort By */}
          <div>
            <label className="block text-sm font-medium text-gray-300 mb-2">
              Color Ordering
            </label>
            <select
              value={options.sortBy}
              onChange={(e) => updateOptions('sortBy', e.target.value as ExtractOptions['sortBy'])}
              className="w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white text-sm"
            >
              <option value="hue">Hue</option>
              <option value="luminance">Luminance</option>
              <option value="saturation">Saturation</option>
              <option value="perceptual">Perceptual</option>
            </select>
            <div className="text-xs text-gray-500 mt-1">
              {options.sortBy === 'perceptual' && 'Sort by visual similarity and lightness'}
            </div>
          </div>

          {/* Advanced Options */}
          {options.colorSpace === 'oklab' && (
            <div className="space-y-3 p-3 bg-gray-750 rounded-lg border border-gray-600">
              <div className="text-sm font-medium text-gray-300">Advanced Options</div>
              
              {/* Min Color Difference */}
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs text-gray-400">Min Color Difference</label>
                  <span className="text-xs text-gray-300">{options.minColorDifference.toFixed(2)}</span>
                </div>
                <input
                  type="range"
                  min="0.01"
                  max="0.2"
                  step="0.01"
                  value={options.minColorDifference}
                  onChange={(e) => updateOptions('minColorDifference', parseFloat(e.target.value))}
                  className="slider w-full"
                  style={{
                    '--slider-track-gradient': 'linear-gradient(to right, rgba(217,217,217,0.12), rgba(217,217,217,0.6))',
                    '--ascii-thumb-size': '14px',
                    '--slider-progress': `${((options.minColorDifference - 0.01) / 0.19) * 100}%`
                  } as React.CSSProperties & { '--slider-progress': string }}
                />
                <div className="text-xs text-gray-500 mt-1">
                  Higher values = more distinct colors
                </div>
              </div>
              
              {/* Preserve Original Colors */}
              <div className="flex items-center justify-between">
                <label className="text-xs text-gray-400">Preserve Original Colors</label>
                <button
                  type="button"
                  onClick={() => updateOptions('preserveOriginalColors', !options.preserveOriginalColors)}
                  className={`
                    relative inline-flex h-4 w-7 items-center rounded-full transition-colors
                    ${options.preserveOriginalColors ? 'bg-blue-600' : 'bg-gray-600'}
                  `}
                >
                  <span
                    className={`
                      inline-block h-2 w-2 transform rounded-full bg-white transition-transform
                      ${options.preserveOriginalColors ? 'translate-x-4' : 'translate-x-1'}
                    `}
                  />
                </button>
              </div>
            </div>
          )}

          {/* Extract Button */}
          <button
            type="button"
            onClick={handleExtract}
            disabled={isExtracting}
            className={`
              w-full px-4 py-3 font-medium rounded-lg transition-colors
              ${isExtracting
                ? 'bg-gray-600 text-gray-400 cursor-not-allowed'
                : 'bg-green-600 hover:bg-green-700 text-white'
              }
            `}
          >
            {isExtracting ? (
              <div className="flex items-center justify-center gap-2">
                <div className="animate-spin w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
                Extracting...
              </div>
            ) : (
              'Extract Colors'
            )}
          </button>

          {/* Enhanced Preview with Statistics */}
          {previewGradient && (
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <label className="block text-sm font-medium text-gray-300">
                  Extracted Gradient
                </label>
                {processingStats && (
                  <div className="text-xs text-gray-400">
                    {processingStats.processingTime.toFixed(1)}ms
                  </div>
                )}
              </div>
              
              <div 
                className="h-12 rounded-lg border border-gray-600 relative overflow-hidden"
                style={{ background: previewCSS }}
              >
                {/* Gradient color stops overlay */}
                <div className="absolute inset-0 flex">
                  {previewGradient.map((stop, index) => (
                    <div
                      key={index}
                      className="flex-1 border-r border-black/20 last:border-r-0"
                      title={`${Math.round(stop.position * 100)}% - ${stop.color}`}
                    />
                  ))}
                </div>
              </div>
              
              {/* Processing Statistics */}
              {processingStats && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-gray-750 rounded-lg text-xs">
                  <div>
                    <div className="text-gray-400">Original Colors</div>
                    <div className="font-medium text-white">{processingStats.originalColors.toLocaleString()}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Extracted</div>
                    <div className="font-medium text-white">{processingStats.extractedColors}</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Compression</div>
                    <div className="font-medium text-green-400">{processingStats.compressionRatio.toFixed(1)}:1</div>
                  </div>
                  <div>
                    <div className="text-gray-400">Method</div>
                    <div className="font-medium text-blue-400">
                      {options.method === 'oklab' ? 'OKLab' : options.method}
                    </div>
                  </div>
                </div>
              )}
              
              {/* Individual Color Swatches */}
              <div>
                <div className="text-xs text-gray-400 mb-2">Color Breakdown</div>
                <div className="grid grid-cols-8 gap-1">
                  {previewGradient.slice(0, 16).map((stop, index) => (
                    <div
                      key={index}
                      className="aspect-square rounded border border-gray-600 relative group cursor-pointer"
                      style={{ backgroundColor: stop.color }}
                      title={`${stop.color} (${Math.round(stop.position * 100)}%)`}
                    >
                      <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center">
                        <span className="text-white text-xs font-mono">
                          {Math.round(stop.position * 100)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
                {previewGradient.length > 16 && (
                  <div className="text-xs text-gray-500 mt-1">
                    +{previewGradient.length - 16} more colors
                  </div>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex gap-3 p-4 border-t border-gray-600">
          <button
            type="button"
            onClick={handleCancel}
            className="flex-1 px-4 py-2 text-gray-300 hover:text-white border border-gray-600 hover:border-gray-500 rounded-lg transition-colors"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            disabled={!previewGradient}
            className={`
              flex-1 px-4 py-2 font-medium rounded-lg transition-colors
              ${previewGradient
                ? 'bg-blue-600 hover:bg-blue-700 text-white'
                : 'bg-gray-600 text-gray-400 cursor-not-allowed'
              }
            `}
          >
            Apply Gradient
          </button>
        </div>
      </div>
    </div>
  );
};
