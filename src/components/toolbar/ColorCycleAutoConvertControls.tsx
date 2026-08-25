'use client';

import React from 'react';

import {
  AUTO_CONVERT_MAX_FOCUS,
  AUTO_CONVERT_MAX_RESOLUTION,
  AUTO_CONVERT_MAX_SHAPES,
  AUTO_CONVERT_MIN_FOCUS,
  AUTO_CONVERT_MIN_RESOLUTION,
  AUTO_CONVERT_MIN_SHAPES,
} from '@/constants/colorCycleAutoConvert';
import { autoConvertActiveImageToColorCycle } from '@/services/colorCycleAutoConvert';
import { useAppStore } from '@/stores/useAppStore';

import LabeledSlider from '../ui/LabeledSlider';
import LabeledRangeSlider from '../ui/LabeledRangeSlider';

const DEFAULT_SHAPES = 24;
const DEFAULT_FOCUS = 50;
const DEFAULT_RESOLUTION_RANGE: [number, number] = [1, 8];

export const ColorCycleAutoConvertControls = () => {
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const activeLayerType = useAppStore(
    (state) => state.layers.find((layer) => layer.id === activeLayerId)?.layerType ?? null,
  );
  const addNotification = useAppStore((state) => state.addNotification);
  const [shapes, setShapes] = React.useState(DEFAULT_SHAPES);
  const [focus, setFocus] = React.useState(DEFAULT_FOCUS);
  const [resolutionRange, setResolutionRange] = React.useState<[number, number]>(
    DEFAULT_RESOLUTION_RANGE,
  );
  const [isConverting, setIsConverting] = React.useState(false);
  const canConvert = activeLayerType === 'normal';

  const handleConvert = React.useCallback(async () => {
    if (isConverting) {
      return;
    }
    setIsConverting(true);
    try {
      const result = await autoConvertActiveImageToColorCycle({
        targetShapes: shapes,
        focus,
        resolutionRange,
      });
      addNotification?.({
        type: 'success',
        title: 'Auto Convert complete',
        message: `Created ${result.shapeCount} CC shapes in one Color Cycle layer.`,
        timestamp: new Date(),
      });
    } catch (error) {
      addNotification?.({
        type: 'error',
        title: 'Auto Convert failed',
        message: error instanceof Error ? error.message : 'Unable to auto convert this image layer.',
        timestamp: new Date(),
      });
    } finally {
      setIsConverting(false);
    }
  }, [addNotification, focus, isConverting, resolutionRange, shapes]);

  return (
    <div className="mb-3 border-t border-[#3A3A3A] pt-2">
      <LabeledSlider
        label="Shapes"
        value={shapes}
        min={AUTO_CONVERT_MIN_SHAPES}
        max={AUTO_CONVERT_MAX_SHAPES}
        step={1}
        onChange={(value) => setShapes(Math.max(
          AUTO_CONVERT_MIN_SHAPES,
          Math.min(AUTO_CONVERT_MAX_SHAPES, Math.round(value)),
        ))}
        ariaLabel="Auto Convert Shapes"
        className="mb-2"
      />
      <LabeledSlider
        label="Focus"
        value={focus}
        min={AUTO_CONVERT_MIN_FOCUS}
        max={AUTO_CONVERT_MAX_FOCUS}
        step={1}
        onChange={(value) => setFocus(Math.max(
          AUTO_CONVERT_MIN_FOCUS,
          Math.min(AUTO_CONVERT_MAX_FOCUS, Math.round(value)),
        ))}
        ariaLabel="Auto Convert Focus"
        className="mb-2"
      />
      <LabeledRangeSlider
        label="Res"
        value={resolutionRange}
        min={AUTO_CONVERT_MIN_RESOLUTION}
        max={AUTO_CONVERT_MAX_RESOLUTION}
        step={1}
        onChange={setResolutionRange}
        minAriaLabel="Auto Convert Resolution Minimum"
        maxAriaLabel="Auto Convert Resolution Maximum"
        className="mb-2"
      />
      <button
        type="button"
        className="h-8 w-full border border-[#5A5A5A] bg-[#2A2A2A] px-2 text-sm text-[#E5E5E5] hover:bg-[#333333] disabled:cursor-not-allowed disabled:opacity-45"
        onClick={handleConvert}
        disabled={!canConvert || isConverting}
        aria-busy={isConverting}
        title={canConvert ? 'Convert the selected image layer' : 'Select an image layer'}
      >
        {isConverting ? 'Converting…' : 'Auto Convert'}
      </button>
    </div>
  );
};
