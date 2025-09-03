/**
 * AnimationControls - Clean animation control interface with all playback options
 */

import React, { useCallback } from 'react';

export interface AnimationControlsProps {
  isPlaying: boolean;
  speed: number;
  fps: number;
  cycleColors: number;
  flowDirection: 'forward' | 'reverse' | 'pingpong' | 'bounce';
  onToggleAnimation: () => void;
  onSpeedChange: (speed: number) => void;
  onFPSChange: (fps: number) => void;
  onCycleColorsChange: (cycleColors: number) => void;
  onFlowDirectionChange: (direction: 'forward' | 'reverse' | 'pingpong' | 'bounce') => void;
  disabled?: boolean;
}

export const AnimationControls: React.FC<AnimationControlsProps> = ({
  isPlaying,
  speed,
  fps,
  cycleColors,
  flowDirection,
  onToggleAnimation,
  onSpeedChange,
  onFPSChange,
  onCycleColorsChange,
  onFlowDirectionChange,
  disabled = false
}) => {
  // Slider change handlers
  const handleSpeedChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onSpeedChange(parseFloat(e.target.value));
  }, [onSpeedChange]);

  const handleCycleColorsChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    onCycleColorsChange(parseInt(e.target.value, 10));
  }, [onCycleColorsChange]);

  // FPS preset handler
  const handleFPSChange = useCallback((newFPS: number) => {
    onFPSChange(newFPS);
  }, [onFPSChange]);

  return (
    <div className="animation-controls space-y-4">
      <label className="block text-sm font-medium text-gray-300">
        Animation
      </label>

      {/* Play/Pause Button */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onToggleAnimation}
          disabled={disabled}
          title={isPlaying ? 'Stop animation (Space)' : 'Start animation (Space)'}
          className={`
            flex items-center justify-center w-12 h-12 rounded-full transition-colors
            ${isPlaying
              ? 'bg-red-600 hover:bg-red-700 text-white'
              : 'bg-green-600 hover:bg-green-700 text-white'
            }
            ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
          `}
        >
          {isPlaying ? (
            <span className="text-lg">⏸️</span>
          ) : (
            <span className="text-lg ml-1">▶️</span>
          )}
        </button>
        
        <div className="flex-1">
          <div className="text-sm font-medium text-gray-300">
            {isPlaying ? 'Playing' : 'Paused'}
          </div>
          <div className="text-xs text-gray-400">
            {speed}× speed, {fps} FPS, {cycleColors} colors
          </div>
        </div>
      </div>

      {/* Speed Control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">Speed</label>
          <span className="text-sm text-gray-300">{speed.toFixed(1)}×</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="2.0"
          step="0.1"
          value={speed}
          onChange={handleSpeedChange}
          disabled={disabled}
          className={`
            w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          style={{
            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((speed - 0.1) / 1.9) * 100}%, #374151 ${((speed - 0.1) / 1.9) * 100}%, #374151 100%)`
          }}
        />
      </div>

      {/* Cycle Colors Control */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <label className="text-sm text-gray-400">Color Bands</label>
          <span className="text-sm text-gray-300">{cycleColors}</span>
        </div>
        <input
          type="range"
          min="8"
          max="256"
          step="8"
          value={cycleColors}
          onChange={handleCycleColorsChange}
          disabled={disabled}
          className={`
            w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer
            ${disabled ? 'opacity-50 cursor-not-allowed' : ''}
          `}
          style={{
            background: `linear-gradient(to right, #10b981 0%, #10b981 ${((cycleColors - 8) / 248) * 100}%, #374151 ${((cycleColors - 8) / 248) * 100}%, #374151 100%)`
          }}
        />
        <div className="text-xs text-gray-500">
          More bands = smoother gradients, fewer bands = distinct color steps
        </div>
      </div>

      {/* FPS Control */}
      <div className="space-y-2">
        <label className="text-sm text-gray-400">Frame Rate</label>
        <div className="flex gap-2">
          {[15, 30, 60].map((fpsOption) => (
            <button
              key={fpsOption}
              type="button"
              onClick={() => handleFPSChange(fpsOption)}
              disabled={disabled}
              title={`Set frame rate to ${fpsOption} FPS`}
              className={`
                flex-1 px-3 py-2 text-sm font-medium rounded-lg border transition-colors
                ${fps === fpsOption
                  ? 'bg-blue-600 border-blue-500 text-white'
                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              {fpsOption} FPS
            </button>
          ))}
        </div>
      </div>

      {/* Flow Direction Control */}
      <div className="space-y-2">
        <label className="text-sm text-gray-400">Flow Direction</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: 'forward', label: 'Forward', icon: '→' },
            { value: 'reverse', label: 'Reverse', icon: '←' },
            { value: 'pingpong', label: 'Ping Pong', icon: '↔' },
            { value: 'bounce', label: 'Bounce', icon: '⤴' }
          ].map(({ value, label, icon }) => (
            <button
              key={value}
              type="button"
              onClick={() => onFlowDirectionChange(value as any)}
              disabled={disabled}
              title={`Animation flows ${label.toLowerCase()}`}
              className={`
                px-3 py-2 text-sm font-medium rounded-lg border transition-colors
                flex items-center justify-center gap-1
                ${flowDirection === value
                  ? 'bg-purple-600 border-purple-500 text-white'
                  : 'bg-gray-700 border-gray-600 text-gray-300 hover:bg-gray-600'
                }
                ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}
              `}
            >
              <span>{icon}</span>
              <span>{label}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};