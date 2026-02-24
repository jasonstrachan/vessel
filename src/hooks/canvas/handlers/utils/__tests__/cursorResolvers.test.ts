import { resolveSpacePanCursor } from '@/hooks/canvas/handlers/utils/spacePanCursor';
import { resolveToolCursorState } from '@/hooks/canvas/handlers/utils/toolCursor';

describe('cursor resolvers', () => {
  describe('resolveSpacePanCursor', () => {
    it('prefers grabbing while panning', () => {
      expect(
        resolveSpacePanCursor({
          isSpaceActive: true,
          isPanning: true,
          defaultCursorStyle: 'crosshair',
        })
      ).toBe('grabbing');
    });

    it('returns grab when space is active and not panning', () => {
      expect(
        resolveSpacePanCursor({
          isSpaceActive: true,
          isPanning: false,
          defaultCursorStyle: 'none',
        })
      ).toBe('grab');
    });

    it('falls back to default cursor when space is inactive', () => {
      expect(
        resolveSpacePanCursor({
          isSpaceActive: false,
          isPanning: false,
          defaultCursorStyle: 'crosshair',
        })
      ).toBe('crosshair');
    });
  });

  describe('resolveToolCursorState', () => {
    it('uses move cursor while dragging floating paste', () => {
      expect(
        resolveToolCursorState({
          isDraggingFloatingPaste: true,
          isColorPicker: false,
          useCrosshair: false,
          defaultCursorStyle: 'none',
        })
      ).toEqual({
        cursorStyle: 'move',
        showBrushCursor: false,
      });
    });

    it('uses crosshair for color picker', () => {
      expect(
        resolveToolCursorState({
          isColorPicker: true,
          useCrosshair: false,
          defaultCursorStyle: 'none',
        })
      ).toEqual({
        cursorStyle: 'crosshair',
        showBrushCursor: false,
      });
    });

    it('uses default cursor for regular tools', () => {
      expect(
        resolveToolCursorState({
          isColorPicker: false,
          useCrosshair: false,
          defaultCursorStyle: 'none',
        })
      ).toEqual({
        cursorStyle: 'none',
        showBrushCursor: true,
      });
    });
  });
});
