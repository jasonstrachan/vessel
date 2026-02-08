export const startUserBrushStroke = ({
  currentBrushId,
  userBrushEngine,
  drawCtx,
  worldPos,
  pressure,
}: {
  currentBrushId: string;
  userBrushEngine: {
    setActiveBrush: (id: string) => void;
    startStroke: (ctx: CanvasRenderingContext2D, x: number, y: number, pressure: number) => void;
  };
  drawCtx: CanvasRenderingContext2D;
  worldPos: { x: number; y: number };
  pressure: number;
}): void => {
  userBrushEngine.setActiveBrush(currentBrushId);
  userBrushEngine.startStroke(drawCtx, worldPos.x, worldPos.y, pressure);
};
