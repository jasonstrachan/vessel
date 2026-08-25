'use client';

import React from 'react';

import { autoConvertActiveImageToColorCycle } from '@/services/colorCycleAutoConvert';
import { useAppStore } from '@/stores/useAppStore';

import LabeledSlider from '../ui/LabeledSlider';

const DEFAULT_SHAPES = 24;
const DEFAULT_DETAIL = 50;

export const ColorCycleAutoConvertControls = () => {
  const activeLayerId = useAppStore((state) => state.activeLayerId);
  const activeLayerType = useAppStore(
    (state) => state.layers.find((layer) => layer.id === activeLayerId)?.layerType ?? null,
  );
  const addNotification = useAppStore((state) => state.addNotification);
  const [shapes, setShapes] = React.useState(DEFAULT_SHAPES);
  const [detail, setDetail] = React.useState(DEFAULT_DETAIL);
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
        detail,
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
  }, [addNotification, detail, isConverting, shapes]);

  return (
    <div className="mb-3 border-t border-[#3A3A3A] pt-2">
      <LabeledSlider
        label="Shapes"
        value={shapes}
        min={2}
        max={100}
        step={1}
        onChange={(value) => setShapes(Math.max(2, Math.min(100, Math.round(value))))}
        ariaLabel="Auto Convert Shapes"
        className="mb-2"
      />
      <LabeledSlider
        label="Detail"
        value={detail}
        min={0}
        max={100}
        step={1}
        onChange={(value) => setDetail(Math.max(0, Math.min(100, Math.round(value))))}
        ariaLabel="Auto Convert Detail"
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
