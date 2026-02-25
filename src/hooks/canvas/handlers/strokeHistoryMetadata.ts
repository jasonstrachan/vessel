import type { AppState } from '@/stores/useAppStore';
import type { CanvasSnapshot } from '@/types';

const getShapeFillHistoryDescription = (state: AppState): string => {
  const { shapeFill } = state;
  const lastFinalize = shapeFill.lastFinalize;
  const label = lastFinalize?.strategy?.label?.trim();
  if (label) {
    return `Shape Fill: ${label}`;
  }
  const fillId = lastFinalize?.fillId;
  if (fillId) {
    return `Shape Fill: ${fillId}`;
  }
  return 'Shape Fill';
};

export const resolveStrokeHistoryMetadata = ({
  state,
  isShapeMode,
  isColorCycleLayer,
  isColorCycleBrush,
  historyActionOverride,
  historyDescriptionOverride,
}: {
  state: AppState;
  isShapeMode: boolean;
  isColorCycleLayer: boolean;
  isColorCycleBrush: boolean;
  historyActionOverride?: CanvasSnapshot['actionType'];
  historyDescriptionOverride?: string;
}): {
  actionType: CanvasSnapshot['actionType'];
  description: string;
} => {
  const actionType = historyActionOverride ?? (isShapeMode ? 'fill' : 'brush');
  if (historyDescriptionOverride) {
    return { actionType, description: historyDescriptionOverride };
  }
  if (isShapeMode) {
    if (isColorCycleLayer && isColorCycleBrush) {
      return { actionType, description: 'Color Cycle Fill' };
    }
    return { actionType, description: getShapeFillHistoryDescription(state) };
  }
  if (isColorCycleLayer && isColorCycleBrush) {
    return { actionType, description: 'Color Cycle Stroke' };
  }
  return { actionType, description: 'Brush Stroke' };
};
