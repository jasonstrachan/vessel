import { BrushShape, type BrushSettings } from '@/types';
import { useAppStore } from '@/stores/useAppStore';

jest.mock('@/utils/debug', () => ({
  debugLog: jest.fn(),
}));

import { debugLog } from '@/utils/debug';
import { logContourFillDebug } from '../logContourFillDebug';

describe('logContourFillDebug', () => {
  let originalSettings: BrushSettings;

  beforeEach(() => {
    const store = useAppStore.getState();
    originalSettings = { ...store.tools.brushSettings };
    useAppStore.setState({
      tools: {
        ...store.tools,
        brushSettings: {
          ...store.tools.brushSettings,
          shapeGradientMode: 'contour',
          brushShape: BrushShape.CONTOUR_POLYGON,
        },
      },
    });
  });

  afterEach(() => {
    const store = useAppStore.getState();
    useAppStore.setState({
      tools: {
        ...store.tools,
        brushSettings: {
          ...originalSettings,
        },
      },
    });
    jest.clearAllMocks();
    delete process.env.NEXT_PUBLIC_ENABLE_CONTOUR_DEBUG_LOGS;
  });

  it('logs when contour fill mode is active with supported brush shape', () => {
    logContourFillDebug('spacing-preview', { delta: 4 });

    expect(debugLog).toHaveBeenCalledWith(
      '[ContourFill]',
      'spacing-preview',
      expect.objectContaining({
        fillMode: 'contour',
        brushShape: BrushShape.CONTOUR_POLYGON,
        delta: 4,
      })
    );
  });

  it('skips logging when shape gradient mode is unsupported', () => {
    useAppStore.setState((state) => ({
      tools: {
        ...state.tools,
        brushSettings: {
          ...state.tools.brushSettings,
          shapeGradientMode: 'mesh',
        },
      },
    }));

    logContourFillDebug('spacing-preview', { delta: 2 });

    expect(debugLog).not.toHaveBeenCalled();
  });

  it('respects NEXT_PUBLIC_ENABLE_CONTOUR_DEBUG_LOGS=false', () => {
    const consoleSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    process.env.NEXT_PUBLIC_ENABLE_CONTOUR_DEBUG_LOGS = 'false';

    logContourFillDebug('should-not-log');

    expect(consoleSpy).not.toHaveBeenCalled();
    expect(debugLog).not.toHaveBeenCalled();

    consoleSpy.mockRestore();
  });
});
