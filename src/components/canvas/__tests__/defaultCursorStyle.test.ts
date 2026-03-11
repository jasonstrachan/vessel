import { BrushShape } from '@/types';
import { resolveDefaultCursorStyle } from '../defaultCursorStyle';

describe('resolveDefaultCursorStyle', () => {
  it('uses the brush cursor path for custom brushes on the brush tool', () => {
    expect(
      resolveDefaultCursorStyle({
        currentTool: 'brush',
        brushShape: BrushShape.CUSTOM,
        shapeMode: false,
      })
    ).toBe('none');
  });

  it('still uses crosshair for the custom capture tool', () => {
    expect(
      resolveDefaultCursorStyle({
        currentTool: 'custom',
        brushShape: BrushShape.ROUND,
        shapeMode: false,
      })
    ).toBe('crosshair');
  });
});
