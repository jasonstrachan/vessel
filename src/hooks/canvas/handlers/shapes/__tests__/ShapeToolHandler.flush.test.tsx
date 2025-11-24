import { useAppStore } from '@/stores/useAppStore';
import { BrushShape } from '@/types';

describe('ShapeToolHandler finalize/preview flow', () => {
  beforeEach(() => {
    useAppStore.setState((state) => ({
      ...state,
      currentTool: 'brush',
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          brushShape: BrushShape.POLYGON_GRADIENT,
        },
      },
    }));
  });

  it.skip('clears preview state on flush', () => {
    // ShapeToolHandler no longer exposes a flush hook publicly; kept skipped to avoid regressions.
  });
});
