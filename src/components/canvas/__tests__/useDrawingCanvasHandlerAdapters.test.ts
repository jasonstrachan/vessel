import { renderHook } from '@testing-library/react';

import { useDrawingCanvasHandlerAdapters } from '@/components/canvas/useDrawingCanvasHandlerAdapters';
import type { BrushCursorHandle } from '@/components/canvas/BrushCursor';

describe('useDrawingCanvasHandlerAdapters', () => {
  it('preserves color-cycle phase when forwarding floating paste from handlers', () => {
    const setFloatingPaste = jest.fn();
    const colorCyclePhase = new Uint8Array([1, 2, 3, 4]);
    const { result } = renderHook(() =>
      useDrawingCanvasHandlerAdapters({
        switchTool: jest.fn(),
        setFloatingPaste,
        mousePositionRef: { current: { x: 0, y: 0 } },
        brushCursorHandleRef: { current: null as BrushCursorHandle | null },
      })
    );

    result.current.setFloatingPasteFromHandlers({
      active: true,
      imageData: new ImageData(2, 2),
      position: { x: 1, y: 2 },
      originalPosition: { x: 1, y: 2 },
      width: 2,
      height: 2,
      displayWidth: 2,
      displayHeight: 2,
      rotation: 0,
      sourceLayerId: 'layer-cc',
      colorCycleIndices: new Uint8Array([5, 6, 7, 8]),
      colorCyclePhase,
    });

    expect(setFloatingPaste).toHaveBeenCalledWith(
      expect.objectContaining({
        sourceLayerId: 'layer-cc',
        colorCyclePhase,
      })
    );
  });
});
