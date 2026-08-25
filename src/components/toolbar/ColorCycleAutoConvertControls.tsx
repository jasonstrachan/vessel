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
import {
  autoConvertActiveImageToColorCycle,
  type ColorCycleAutoConvertProgress,
} from '@/services/colorCycleAutoConvert';
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
  const [progress, setProgress] = React.useState<ColorCycleAutoConvertProgress | null>(null);
  const canConvert = activeLayerType === 'normal';
  const paintingPercent = progress?.phase === 'painting'
    ? Math.round((progress.completed / Math.max(1, progress.total)) * 100)
    : null;
  const buttonLabel = !isConverting
    ? 'Auto Convert'
    : progress?.phase === 'painting'
      ? `Painting ${progress.completed} / ${progress.total}`
      : 'Analyzing…';

  const handleConvert = React.useCallback(async () => {
    if (isConverting) {
      return;
    }
    setIsConverting(true);
    setProgress({ phase: 'analyzing' });
    try {
      const result = await autoConvertActiveImageToColorCycle({
        targetShapes: shapes,
        focus,
        resolutionRange,
        onProgress: setProgress,
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
      setProgress(null);
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
      <div>
        <button
          type="button"
          className={`relative h-8 w-full overflow-hidden border border-[#5A5A5A] bg-[#2A2A2A] px-2 text-sm text-[#E5E5E5] hover:bg-[#333333] disabled:cursor-not-allowed ${canConvert ? '' : 'opacity-45'}`}
          onClick={handleConvert}
          disabled={!canConvert || isConverting}
          aria-busy={isConverting}
          aria-label={buttonLabel}
          title={canConvert ? 'Convert the selected image layer' : 'Select an image layer'}
        >
          {isConverting && progress?.phase === 'analyzing' && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 w-full animate-pulse bg-[#35414A]"
            />
          )}
          {isConverting && progress?.phase === 'painting' && paintingPercent !== null && (
            <span
              aria-hidden="true"
              className="absolute inset-y-0 left-0 bg-[#40586A] transition-[width] duration-150"
              style={{ width: `${paintingPercent}%` }}
            />
          )}
          <span className="relative z-10">{buttonLabel}</span>
        </button>
        {isConverting && progress?.phase === 'painting' && paintingPercent !== null && (
          <span
            role="progressbar"
            aria-label="Auto Convert progress"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={paintingPercent}
            className="sr-only"
          >
            {buttonLabel}
          </span>
        )}
      </div>
    </div>
  );
};
