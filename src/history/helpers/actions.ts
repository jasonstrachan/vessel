import type { CanvasSnapshot } from '@/types';
import type { HistoryActionId } from '@/history/actionTypes';

export const mapCanvasActionToHistoryId = (
  actionType: CanvasSnapshot['actionType']
): HistoryActionId => {
  switch (actionType) {
    case 'brush':
      return 'brush-stroke';
    case 'eraser':
      return 'eraser-stroke';
    case 'fill':
      return 'fill';
    case 'paste':
    case 'delete':
      return 'layer-bitmap';
    case 'layer':
    case 'layers':
    case 'layer-add':
    case 'layer-remove':
    case 'layer-reorder':
    case 'structure':
      return 'layer-structure';
    case 'crop':
      return 'crop';
    default:
      return 'layer-bitmap';
  }
};

