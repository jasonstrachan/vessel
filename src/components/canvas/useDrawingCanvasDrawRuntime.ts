import { useDrawingCanvasDrawCallback } from './useDrawingCanvasDrawCallback';
import { useDrawingCanvasInitialDrawEffect } from './useDrawingCanvasInitialDrawEffect';

interface UseDrawingCanvasDrawRuntimeOptions {
  drawOptions: Parameters<typeof useDrawingCanvasDrawCallback>[0];
  initialDrawOptions: Omit<Parameters<typeof useDrawingCanvasInitialDrawEffect>[0], 'draw'>;
}

export const useDrawingCanvasDrawRuntime = ({
  drawOptions,
  initialDrawOptions,
}: UseDrawingCanvasDrawRuntimeOptions) => {
  const draw = useDrawingCanvasDrawCallback(drawOptions);

  useDrawingCanvasInitialDrawEffect({
    draw,
    ...initialDrawOptions,
  });

  return draw;
};
