import { useEffect, useState } from 'react';

interface UseDrawingCanvasCursorStyleStateOptions {
  defaultCursorStyle: string;
  currentTool: string;
  brushShape: unknown;
}

export const useDrawingCanvasCursorStyleState = ({
  defaultCursorStyle,
  currentTool,
  brushShape,
}: UseDrawingCanvasCursorStyleStateOptions) => {
  const [cursorStyle, setCursorStyle] = useState(defaultCursorStyle);

  useEffect(() => {
    setCursorStyle(defaultCursorStyle);
  }, [defaultCursorStyle]);

  useEffect(() => {
    // quiet
  }, [cursorStyle, currentTool, brushShape]);

  return {
    cursorStyle,
    setCursorStyle,
  };
};
