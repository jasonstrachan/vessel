/**
 * AnimationControls - Clean animation control interface with all playback options
 */

import React, { useCallback } from 'react';
import LabeledSlider from '../../ui/LabeledSlider';
import ButtonGroup from '../../ui/ButtonGroup';

const MAPPING_MODES = ['banded', 'continuous'] as const;
const FLOW_MAPPINGS = ['palette', 'directional', 'luminance'] as const;
type MappingMode = typeof MAPPING_MODES[number];
type FlowMapping = typeof FLOW_MAPPINGS[number];

const isMappingMode = (value: string): value is MappingMode => (
  MAPPING_MODES.includes(value as MappingMode)
);

const isFlowMapping = (value: string): value is FlowMapping => (
  FLOW_MAPPINGS.includes(value as FlowMapping)
);

export interface AnimationControlsProps {
  speed: number;
  fps: number;
  cycleColors: number;
  flowDirection: 'forward' | 'reverse' | 'pingpong' | 'bounce';
  mappingMode?: 'banded' | 'continuous';
  flowMapping?: 'palette' | 'directional' | 'luminance';
  onSpeedChange: (speed: number) => void;
  onFPSChange: (fps: number) => void;
  onCycleColorsChange: (cycleColors: number) => void;
  onFlowDirectionChange: (direction: 'forward' | 'reverse' | 'pingpong' | 'bounce') => void;
  onMappingModeChange?: (mode: 'banded' | 'continuous') => void;
  onFlowMappingChange?: (mode: 'palette' | 'directional' | 'luminance') => void;
}

export const AnimationControls: React.FC<AnimationControlsProps> = ({
  speed,
  fps,
  cycleColors,
  flowDirection,
  mappingMode = 'banded',
  flowMapping = 'palette',
  onSpeedChange,
  onFPSChange,
  onCycleColorsChange,
  onFlowDirectionChange,
  onMappingModeChange,
  onFlowMappingChange
}) => {
  // FPS preset handler
  const handleFPSChange = useCallback((newFPS: number) => {
    onFPSChange(newFPS);
  }, [onFPSChange]);

  const handleFlowDirectionChange = useCallback((value: string) => {
    onFlowDirectionChange(value as AnimationControlsProps['flowDirection']);
  }, [onFlowDirectionChange]);

  const handleMappingModeChange = useCallback((value: string) => {
    if (!onMappingModeChange || !isMappingMode(value)) return;
    onMappingModeChange(value);
  }, [onMappingModeChange]);

  const handleFlowMappingChange = useCallback((value: string) => {
    if (!onFlowMappingChange || !isFlowMapping(value)) return;
    onFlowMappingChange(value);
  }, [onFlowMappingChange]);

  return (
    <div className="animation-controls space-y-4">
      {/* Speed */}
      <LabeledSlider
        label="Speed"
        value={speed}
        min={0.02}
        max={2.0}
        step={0.02}
        onChange={onSpeedChange}
        ariaLabel="Animation speed"
        className="mb-2"
      />

      {/* Bands */}
      <LabeledSlider
        label="Bands"
        value={cycleColors}
        min={8}
        max={256}
        step={8}
        onChange={onCycleColorsChange}
        ariaLabel="Bands"
        className="mb-2"
      />

      {/* FPS Control - match Color Cycle Shape button group EXACTLY */}
      <div className="mb-2">
        <ButtonGroup
          options={[
            { label: '15 FPS', value: '15' },
            { label: '30 FPS', value: '30' },
            { label: '60 FPS', value: '60' }
          ]}
          value={String(fps)}
          onChange={(value) => handleFPSChange(parseInt(value, 10))}
          className="w-full"
          size="sm"
        />
      </div>

      {/* Flow Direction - use Tabs like Color Cycle Shape */}
      <div className="mb-2">
        <ButtonGroup
          options={[
            { label: 'Forward', value: 'forward' },
            { label: 'Reverse', value: 'reverse' },
            { label: 'Pong', value: 'pingpong' },
            { label: 'Bounce', value: 'bounce' }
          ]}
          value={flowDirection}
          onChange={handleFlowDirectionChange}
          className="w-full"
          size="sm"
        />
      </div>

      {/* Mapping Mode */}
      {onMappingModeChange && (
        <div className="space-y-2">
          <ButtonGroup
            options={[
              { value: 'banded', label: 'Banded' },
              { value: 'continuous', label: 'Continuous' }
            ]}
            value={mappingMode}
            onChange={handleMappingModeChange}
            className="w-full"
            size="sm"
          />
        </div>
      )}

      {/* Flow Mapping Mode */}
      {onFlowMappingChange && (
        <div className="space-y-2">
          <ButtonGroup
            options={[
              { value: 'palette', label: 'Palette' },
              { value: 'directional', label: 'Directional' },
              { value: 'luminance', label: 'Luminance' }
            ]}
            value={flowMapping}
            onChange={handleFlowMappingChange}
            className="w-full"
            size="sm"
          />
        </div>
      )}
    </div>
  );
};
