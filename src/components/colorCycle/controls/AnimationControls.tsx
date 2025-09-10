/**
 * AnimationControls - Clean animation control interface with all playback options
 */

import React, { useCallback } from 'react';
import Button from '../../ui/Button';
import ProgressSlider from '../../ui/ProgressSlider';

export interface AnimationControlsProps {
  isPlaying: boolean;
  speed: number;
  fps: number;
  cycleColors: number;
  flowDirection: 'forward' | 'reverse' | 'pingpong' | 'bounce';
  mappingMode?: 'banded' | 'continuous';
  flowMapping?: 'palette' | 'directional' | 'luminance';
  onToggleAnimation: () => void;
  onSpeedChange: (speed: number) => void;
  onFPSChange: (fps: number) => void;
  onCycleColorsChange: (cycleColors: number) => void;
  onFlowDirectionChange: (direction: 'forward' | 'reverse' | 'pingpong' | 'bounce') => void;
  onMappingModeChange?: (mode: 'banded' | 'continuous') => void;
  onFlowMappingChange?: (mode: 'palette' | 'directional' | 'luminance') => void;
  disabled?: boolean;
}

export const AnimationControls: React.FC<AnimationControlsProps> = ({
  isPlaying,
  speed,
  fps,
  cycleColors,
  flowDirection,
  mappingMode = 'banded',
  flowMapping = 'palette',
  onToggleAnimation,
  onSpeedChange,
  onFPSChange,
  onCycleColorsChange,
  onFlowDirectionChange,
  onMappingModeChange,
  onFlowMappingChange,
  disabled = false
}) => {
  // FPS preset handler
  const handleFPSChange = useCallback((newFPS: number) => {
    onFPSChange(newFPS);
  }, [onFPSChange]);

  return (
    <div className="animation-controls space-y-4">
      <label className="block text-sm font-medium text-gray-300">Animation</label>

      {/* Speed Control - match pixel square brush opacity slider style */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Speed
          </label>
          <ProgressSlider
            value={speed}
            min={0.1}
            max={2.0}
            step={0.1}
            onChange={(value) => onSpeedChange(value)}
            aria-label="Animation speed"
            className="flex-1"
          />
        </div>
      </div>

      {/* Color Bands Control - match pixel square brush opacity slider style */}
      <div className="mb-2">
        <div className="flex items-center gap-2">
          <label className="text-[#D9D9D9] w-16" style={{ fontSize: '14px' }}>
            Color Bands
          </label>
          <ProgressSlider
            value={cycleColors}
            min={8}
            max={256}
            step={8}
            onChange={(value) => onCycleColorsChange(value)}
            aria-label="Color bands"
            className="flex-1"
          />
        </div>
      </div>

      {/* FPS Control */}
      <div className="space-y-2">
        <label className="text-sm text-gray-400">Frame Rate</label>
        <div className="flex gap-2">
          {[15, 30, 60].map((fpsOption) => (
            <Button
              key={fpsOption}
              type="button"
              onClick={() => handleFPSChange(fpsOption)}
              disabled={disabled}
              title={`Set frame rate to ${fpsOption} FPS`}
              variant={fps === fpsOption ? 'primary' : 'secondary'}
              size="sm"
              className="flex-1"
            >
              {fpsOption} FPS
            </Button>
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
            <Button
              key={value}
              type="button"
              onClick={() => onFlowDirectionChange(value as any)}
              disabled={disabled}
              title={`Animation flows ${label.toLowerCase()}`}
              variant={flowDirection === value ? 'primary' : 'secondary'}
              size="sm"
            >
              <span className="mr-1">{icon}</span>
              <span>{label}</span>
            </Button>
          ))}
        </div>
      </div>

      {/* Mapping Mode */}
      {onMappingModeChange && (
        <div className="space-y-2">
          <label className="text-sm text-gray-400">Mapping</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'banded', label: 'Banded' },
              { value: 'continuous', label: 'Continuous' }
            ].map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                onClick={() => onMappingModeChange(value as any)}
                disabled={disabled}
                variant={mappingMode === value ? 'primary' : 'secondary'}
                size="sm"
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            Continuous uses full gradient; banded keeps {cycleColors} color steps.
          </div>
        </div>
      )}

      {/* Flow Mapping Mode */}
      {onFlowMappingChange && (
        <div className="space-y-2">
          <label className="text-sm text-gray-400">Flow Map</label>
          <div className="grid grid-cols-3 gap-2">
            {[
              { value: 'palette', label: 'Palette' },
              { value: 'directional', label: 'Directional' },
              { value: 'luminance', label: 'Luminance' }
            ].map(({ value, label }) => (
              <Button
                key={value}
                type="button"
                onClick={() => onFlowMappingChange(value as any)}
                disabled={disabled}
                variant={flowMapping === value ? 'primary' : 'secondary'}
                size="sm"
              >
                {label}
              </Button>
            ))}
          </div>
          <div className="text-xs text-gray-500">
            Directional sweeps along an angle; Luminance uses brightness.
          </div>
        </div>
      )}
    </div>
  );
};
