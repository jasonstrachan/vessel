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
  | 'onDoubleClick'
>;

interface UseDrawingCanvasViewportPropsOptions {
  styleOptions: Parameters<typeof useDrawingCanvasStyles>[0];
  cursorModelOptions: Parameters<typeof useDrawingCanvasCursorModel>[0];
  viewportOptions: Omit<
    ViewportPropSubset,
    | 'canvasStyle'
    | 'overlayCanvasStyle'
    | 'viewportStyle'
    | 'cursorDescriptor'
    | 'brushCursorVisible'
  >;
}

export const useDrawingCanvasViewportProps = ({
  styleOptions,
  cursorModelOptions,
  viewportOptions,
}: UseDrawingCanvasViewportPropsOptions): ViewportPropSubset => {
  const { canvasStyle, overlayCanvasStyle, viewportStyle } = useDrawingCanvasStyles(styleOptions);
  const { cursorDescriptor, brushCursorVisible } =
    useDrawingCanvasCursorModel(cursorModelOptions);

  return useMemo(
    () => ({
      ...viewportOptions,
      canvasStyle,
      overlayCanvasStyle,
      viewportStyle,
      cursorDescriptor,
      brushCursorVisible,
    }),
    [
      viewportOptions,
      canvasStyle,
      overlayCanvasStyle,
      viewportStyle,
      cursorDescriptor,
      brushCursorVisible,
    ]
  );
};
