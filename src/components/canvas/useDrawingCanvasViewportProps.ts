import { useMemo } from 'react';
import type { DrawingCanvasViewportProps } from './DrawingCanvasViewport';
import { useDrawingCanvasCursorModel } from './useDrawingCanvasCursorModel';
import { useDrawingCanvasStyles } from './useDrawingCanvasStyles';

type ViewportPropSubset = Omit<
  DrawingCanvasViewportProps,
  | 'wrapperRef'
  | 'canvasRef'
  | 'overlayCanvasRef'
  | 'onBlur'
  | 'onPointerDown'
  | 'onPointerUp'
  | 'onPointerMove'
  | 'onPointerEnter'
  | 'onPointerLeave'
  | 'onPointerCancel'
>;

interface UseDrawingCanvasViewportPropsOptions {
  styleOptions: Parameters<typeof useDrawingCanvasStyles>[0];
  cursorModelOptions: Parameters<typeof useDrawingCanvasCursorModel>[0];
  viewportOptions: Omit<
    ViewportPropSubset,
    | 'canvasStyle'
    | 'overlayCanvasStyle'
    | 'cursorSize'
    | 'brushShapeForCursor'
    | 'brushCursorVisible'
  >;
}

export const useDrawingCanvasViewportProps = ({
  styleOptions,
  cursorModelOptions,
  viewportOptions,
}: UseDrawingCanvasViewportPropsOptions): ViewportPropSubset => {
  const { canvasStyle, overlayCanvasStyle } = useDrawingCanvasStyles(styleOptions);
  const { brushShapeForCursor, cursorSize, brushCursorVisible } =
    useDrawingCanvasCursorModel(cursorModelOptions);

  return useMemo(
    () => ({
      ...viewportOptions,
      canvasStyle,
      overlayCanvasStyle,
      cursorSize,
      brushShapeForCursor,
      brushCursorVisible,
    }),
    [
      viewportOptions,
      canvasStyle,
      overlayCanvasStyle,
      cursorSize,
      brushShapeForCursor,
      brushCursorVisible,
    ]
  );
};
