import { useEffect, useRef } from 'react';

interface AdaptiveHistoryProject {
  width: number;
  height: number;
}

interface UseDrawingCanvasAdaptiveHistorySizeOptions {
  project: AdaptiveHistoryProject | null;
  layerCount: number;
  historyMaxSize: number;
  setHistorySize: (size: number) => void;
}

const DEFAULT_HISTORY_SIZE = 50;
const MIN_HISTORY_SIZE = 8;

const clampHistorySize = (size: number): number =>
  Math.max(MIN_HISTORY_SIZE, Math.min(DEFAULT_HISTORY_SIZE, Math.floor(size)));

const recommendHistorySize = (
  project: AdaptiveHistoryProject | null,
  layerCount: number
): number => {
  if (!project || project.width <= 0 || project.height <= 0) {
    return DEFAULT_HISTORY_SIZE;
  }

  const megapixels = (project.width * project.height) / 1_000_000;
  const normalizedLayers = Math.max(1, layerCount);
  const complexityScore = megapixels * normalizedLayers;

  if (complexityScore >= 64) {
    return 8;
  }
  if (complexityScore >= 36) {
    return 12;
  }
  if (complexityScore >= 20) {
    return 20;
  }
  if (complexityScore >= 10) {
    return 30;
  }
  return DEFAULT_HISTORY_SIZE;
};

export const useDrawingCanvasAdaptiveHistorySize = ({
  project,
  layerCount,
  historyMaxSize,
  setHistorySize,
}: UseDrawingCanvasAdaptiveHistorySizeOptions) => {
  const lastAppliedRef = useRef<number | null>(null);

  useEffect(() => {
    const recommended = clampHistorySize(recommendHistorySize(project, layerCount));
    if (recommended >= historyMaxSize) {
      return;
    }

    if (lastAppliedRef.current === recommended) {
      return;
    }

    setHistorySize(recommended);
    lastAppliedRef.current = recommended;
  }, [historyMaxSize, layerCount, project, setHistorySize]);
};
