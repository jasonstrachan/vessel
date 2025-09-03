/**
 * QualityControls - Advanced quality and performance settings
 * Enhanced with median cut and spatial hashing options
 */

import React, { useCallback } from 'react';

export interface QualityControlsProps {
  quantizationMode: 'rgb332' | 'oklab-median-cut';
  ditherMode: 'off' | 'bayer4' | 'bayer8';
  currentLOD: 'full' | 'half' | 'quarter';
  performanceMode: 'auto' | 'quality' | 'performance';
  quality: 'fast' | 'balanced' | 'best';
  useSpatialHash: boolean;
  onQuantizationModeChange: (mode: 'rgb332' | 'oklab-median-cut') => void;
  onDitherModeChange: (mode: 'off' | 'bayer4' | 'bayer8') => void;
  onPerformanceModeChange: (mode: 'auto' | 'quality' | 'performance') => void;
  onQualityChange: (quality: 'fast' | 'balanced' | 'best') => void;
  onSpatialHashChange: (enabled: boolean) => void;
  disabled?: boolean;
}

export const QualityControls: React.FC<QualityControlsProps> = ({
  quantizationMode,
  ditherMode,
  currentLOD,
  performanceMode,
  quality,
  useSpatialHash,
  onQuantizationModeChange,
  onDitherModeChange,
  onPerformanceModeChange,
  onQualityChange,
  onSpatialHashChange,
  disabled = false
}) => {
  const handleQuantizationChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onQuantizationModeChange(e.target.value as 'rgb332' | 'oklab-median-cut');
  }, [onQuantizationModeChange]);

  const handleDitherChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onDitherModeChange(e.target.value as 'off' | 'bayer4' | 'bayer8');
  }, [onDitherModeChange]);

  const handlePerformanceChange = useCallback((mode: 'auto' | 'quality' | 'performance') => {
    onPerformanceModeChange(mode);
  }, [onPerformanceModeChange]);

  const handleQualityChange = useCallback((e: React.ChangeEvent<HTMLSelectElement>) => {
    onQualityChange(e.target.value as 'fast' | 'balanced' | 'best');
  }, [onQualityChange]);

  const handleSpatialHashToggle = useCallback(() => {
    onSpatialHashChange(!useSpatialHash);
  }, [useSpatialHash, onSpatialHashChange]);

  // Get LOD status color
  const getLODColor = (lod: string) => {
    switch (lod) {
      case 'full': return 'text-green-400';
      case 'half': return 'text-yellow-400';
      case 'quarter': return 'text-red-400';
      default: return 'text-gray-400';
    }
  };

  return (
    <div className="quality-controls space-y-4 p-4 bg-gray-700 rounded-lg border border-gray-600">
      <div className="flex items-center justify-between">
        <h4 className="text-sm font-medium text-gray-300">Quality Settings</h4>
        <div className={`text-xs ${getLODColor(currentLOD)}`}>
          {currentLOD.toUpperCase()} Quality
        </div>
      </div>

      {/* Quantization Mode */}
      <div className="space-y-2">
        <label className="block text-sm text-gray-400">
          Color Quantization
        </label>
        <select
          value={quantizationMode}
          onChange={handleQuantizationChange}
          disabled={disabled}
          className={`
            w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg
            text-white text-sm focus:border-blue-500 focus:outline-none
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <option value="rgb332">RGB332 (Fast)</option>
          <option value="oklab-median-cut">OKLab Median Cut (Quality)</option>
        </select>
        <div className="text-xs text-gray-500">
          {quantizationMode === 'rgb332' 
            ? 'Fast 256-color quantization, <50ms at 1080p'
            : 'High-quality perceptual quantization, <200ms at 4K'
          }
        </div>
      </div>

      {/* Dither Mode */}
      <div className="space-y-2">
        <label className="block text-sm text-gray-400">
          Dithering
        </label>
        <select
          value={ditherMode}
          onChange={handleDitherChange}
          disabled={disabled}
          className={`
            w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg
            text-white text-sm focus:border-blue-500 focus:outline-none
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <option value="off">Off</option>
          <option value="bayer4">Bayer 4×4</option>
          <option value="bayer8">Bayer 8×8</option>
        </select>
        <div className="text-xs text-gray-500">
          {ditherMode === 'off' && 'No dithering - fastest rendering'}
          {ditherMode === 'bayer4' && 'Basic dithering - reduces color banding'}
          {ditherMode === 'bayer8' && 'High-quality dithering - smoothest gradients'}
        </div>
      </div>

      {/* Algorithm Quality */}
      <div className="space-y-2">
        <label className="block text-sm text-gray-400">
          Algorithm Quality
        </label>
        <select
          value={quality}
          onChange={handleQualityChange}
          disabled={disabled}
          className={`
            w-full px-3 py-2 bg-gray-800 border border-gray-600 rounded-lg
            text-white text-sm focus:border-blue-500 focus:outline-none
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          <option value="fast">Fast</option>
          <option value="balanced">Balanced</option>
          <option value="best">Best</option>
        </select>
        <div className="text-xs text-gray-500">
          {quality === 'fast' && 'Optimized for speed - basic algorithms'}
          {quality === 'balanced' && 'Good balance of speed and quality'}
          {quality === 'best' && 'Highest quality - advanced algorithms'}
        </div>
      </div>

      {/* Spatial Hash Toggle */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">
            Spatial Hashing
          </label>
          <button
            type="button"
            onClick={handleSpatialHashToggle}
            disabled={disabled}
            className={`
              relative inline-flex h-5 w-9 items-center rounded-full transition-colors
              ${useSpatialHash ? 'bg-blue-600' : 'bg-gray-600'}
              ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
            `}
          >
            <span
              className={`
                inline-block h-3 w-3 transform rounded-full bg-white transition-transform
                ${useSpatialHash ? 'translate-x-5' : 'translate-x-1'}
              `}
            />
          </button>
        </div>
        <div className="text-xs text-gray-500">
          {useSpatialHash 
            ? 'Fast O(1) color lookups - recommended for large images'
            : 'Linear O(n) search - may be slower with many colors'
          }
        </div>
      </div>

      {/* Performance Mode */}
      <div className="space-y-2">
        <label className="block text-sm text-gray-400">
          Performance Mode
        </label>
        <div className="grid grid-cols-3 gap-2">
          {[
            { value: 'auto', label: 'Auto', desc: 'Adaptive quality' },
            { value: 'quality', label: 'Quality', desc: 'Best visuals' },
            { value: 'performance', label: 'Speed', desc: 'Best performance' }
          ].map(({ value, label, desc }) => (
            <button
              key={value}
              type="button"
              onClick={() => handlePerformanceChange(value as any)}
              disabled={disabled}
              className={`
                px-3 py-2 text-xs font-medium rounded-lg border transition-colors
                ${performanceMode === value
                  ? 'bg-orange-600 border-orange-500 text-white'
                  : 'bg-gray-800 border-gray-600 text-gray-300 hover:bg-gray-700'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              title={desc}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Quality Indicator */}
      <div className="pt-3 border-t border-gray-600">
        <div className="flex items-center justify-between text-xs">
          <span className="text-gray-400">Current Quality</span>
          <div className="flex items-center gap-2">
            <div className={`w-2 h-2 rounded-full ${getLODColor(currentLOD).replace('text-', 'bg-')}`} />
            <span className={getLODColor(currentLOD)}>
              {currentLOD.charAt(0).toUpperCase() + currentLOD.slice(1)}
              {currentLOD !== 'full' && ' (Adaptive)'}
            </span>
          </div>
        </div>
      </div>

      {/* Algorithm Information */}
      <div className="p-3 bg-blue-900/20 border border-blue-500/30 rounded text-xs text-blue-300">
        <div className="font-medium mb-1">💡 Algorithm Details</div>
        <div>
          {quantizationMode === 'rgb332' && (
            <span>RGB332: 256 fixed colors, 3+3+2 bit distribution</span>
          )}
          {quantizationMode === 'oklab-median-cut' && (
            <span>Median Cut: Perceptually optimal {quality} palette generation</span>
          )}
          {ditherMode !== 'off' && (
            <span> + Bayer {ditherMode.slice(-1)}×{ditherMode.slice(-1)} dithering</span>
          )}
          {useSpatialHash && <span> + Spatial hash acceleration</span>}
        </div>
      </div>

      {/* Processing Warning */}
      {(quantizationMode !== 'rgb332' || ditherMode !== 'off' || quality !== 'balanced') && (
        <div className="p-2 bg-yellow-900/30 border border-yellow-500/50 rounded text-xs text-yellow-300">
          ⚠️ Quality settings changes require layer reprocessing
        </div>
      )}
    </div>
  );
};