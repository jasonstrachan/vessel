/**
 * GradientControls - Clean gradient management with presets and custom options
 */

import React, { useState, useCallback } from 'react';

export interface GradientControlsProps {
  gradient: Array<{ position: number; color: string }>;
  onGradientChange: (gradient: Array<{ position: number; color: string }>) => void;
  onExtractColors: () => void;
  disabled?: boolean;
}

const GRADIENT_PRESETS = {
  rainbow: [
    { position: 0, color: '#ff0000' },
    { position: 0.17, color: '#ff8000' },
    { position: 0.33, color: '#ffff00' },
    { position: 0.5, color: '#00ff00' },
    { position: 0.67, color: '#0080ff' },
    { position: 0.83, color: '#8000ff' },
    { position: 1, color: '#ff0000' }
  ],
  fire: [
    { position: 0, color: '#000000' },
    { position: 0.3, color: '#800000' },
    { position: 0.6, color: '#ff4000' },
    { position: 0.8, color: '#ffff00' },
    { position: 1, color: '#ffffff' }
  ],
  ocean: [
    { position: 0, color: '#000040' },
    { position: 0.5, color: '#0080ff' },
    { position: 1, color: '#80ffff' }
  ],
  sunset: [
    { position: 0, color: '#4000ff' },
    { position: 0.3, color: '#ff0080' },
    { position: 0.6, color: '#ff8000' },
    { position: 1, color: '#ffff80' }
  ]
};

export const GradientControls: React.FC<GradientControlsProps> = ({
  gradient,
  onGradientChange,
  onExtractColors,
  disabled = false
}) => {
  const [selectedPreset, setSelectedPreset] = useState<keyof typeof GRADIENT_PRESETS | 'custom'>('custom');

  const handlePresetChange = useCallback((preset: keyof typeof GRADIENT_PRESETS) => {
    setSelectedPreset(preset);
    onGradientChange(GRADIENT_PRESETS[preset]);
  }, [onGradientChange]);

  const handleExtractClick = useCallback(() => {
    setSelectedPreset('custom');
    onExtractColors();
  }, [onExtractColors]);

  // Create CSS gradient for preview
  const gradientCSS = gradient.length > 0 
    ? `linear-gradient(to right, ${gradient.map(stop => `${stop.color} ${stop.position * 100}%`).join(', ')})`
    : 'linear-gradient(to right, #000, #fff)';

  return (
    <div className="gradient-controls">
      <label className="block text-sm font-medium text-gray-300 mb-2">
        Gradient
      </label>

      {/* Gradient Preview */}
      <div 
        className="h-8 rounded-lg border border-gray-600 mb-3"
        style={{ background: gradientCSS }}
      />

      {/* Preset Buttons */}
      <div className="grid grid-cols-2 gap-2 mb-3">
        {Object.keys(GRADIENT_PRESETS).map((presetKey) => {
          const preset = presetKey as keyof typeof GRADIENT_PRESETS;
          const presetGradient = GRADIENT_PRESETS[preset];
          const presetCSS = `linear-gradient(to right, ${presetGradient.map(stop => `${stop.color} ${stop.position * 100}%`).join(', ')})`;
          
          return (
            <button
              key={preset}
              type="button"
              onClick={() => handlePresetChange(preset)}
              disabled={disabled}
              className={`
                relative h-8 rounded-md border-2 transition-colors overflow-hidden
                ${selectedPreset === preset
                  ? 'border-blue-500'
                  : 'border-gray-600 hover:border-gray-500'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
              style={{ background: presetCSS }}
            >
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xs font-medium text-white drop-shadow-lg capitalize">
                  {preset}
                </span>
              </div>
            </button>
          );
        })}
      </div>

      {/* Extract Colors Button */}
      <button
        type="button"
        onClick={handleExtractClick}
        disabled={disabled}
        className={`
          w-full px-3 py-2 text-sm font-medium rounded-lg border transition-colors
          ${selectedPreset === 'custom'
            ? 'bg-green-600 border-green-500 text-white'
            : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
          }
          ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
        `}
      >
        {selectedPreset === 'custom' ? '✓ Custom Gradient' : 'Extract from Layer'}
      </button>

      {/* Gradient Info */}
      {gradient.length > 0 && (
        <div className="mt-2 text-xs text-gray-400">
          {gradient.length} color stops
        </div>
      )}
    </div>
  );
};